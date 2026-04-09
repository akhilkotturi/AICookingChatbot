"""
Cohere embedding service for semantic recipe search.

Key concepts:
- embed-english-v3.0 produces 1024-dimensional vectors
- input_type matters: "search_document" for storing,
  "search_query" for querying. Cohere trains differently
  for each — using the wrong one hurts retrieval quality.
- Cosine similarity: measures the angle between two vectors.
  1.0 = identical meaning, 0.0 = unrelated.
  We filter results below 0.6 to avoid returning
  loosely related recipes.
"""
import os
import time
import cohere
from utils.logging import get_logger

logger = get_logger(__name__)

_client: cohere.AsyncClientV2 | None = None
_RAG_DB_COOLDOWN_UNTIL = 0.0


def _get_client() -> cohere.AsyncClientV2:
    global _client
    if _client is None:
        api_key = os.getenv("COHERE_API_KEY")
        if not api_key:
            raise RuntimeError("COHERE_API_KEY not set")
        _client = cohere.AsyncClientV2(api_key=api_key)
    return _client


async def embed_text(
    text: str,
    input_type: str = "search_document",
) -> list[float]:
    """
    Embed a single string. Returns 1024 floats.
    input_type: "search_document" when storing,
                "search_query" when searching.
    """
    client = _get_client()
    response = await client.embed(
        texts=[text],
        model="embed-english-v3.0",
        input_type=input_type,
        embedding_types=["float"],
    )
    return response.embeddings.float_[0]


async def embed_recipe_for_storage(
    title: str,
    content: str,
) -> list[float] | None:
    """
    Create an embedding for a recipe to store in MongoDB.

    We repeat the title because it's the most semantically
    dense part — "Pasta Carbonara" carries more meaning
    per token than the method steps.

    Returns None on failure so callers can save the recipe
    without an embedding rather than failing the whole save.
    """
    try:
        combined = f"Recipe: {title}\n\nTitle: {title}\n\n{content[:800]}"
        return await embed_text(combined, input_type="search_document")
    except Exception as e:
        logger.error(
            "embed_recipe_failed",
            extra={"error": str(e), "title": title},
        )
        return None


async def find_similar_recipes(
    query: str,
    user_id: str,
    limit: int = 3,
) -> list[dict]:
    """
    Find recipes semantically similar to the query.

    Uses MongoDB Atlas $vectorSearch — runs the search
    inside the database, not in Python. Only returns
    results above 0.6 cosine similarity to avoid injecting
    irrelevant context into the LLM.

    Returns empty list on any failure — RAG context is
    an enhancement, not a hard requirement.
    """
    from db import recipes_col

    global _RAG_DB_COOLDOWN_UNTIL

    cooldown_seconds = int(os.getenv("RAG_DB_FAILURE_COOLDOWN_SECONDS", "60"))
    now = time.monotonic()
    if now < _RAG_DB_COOLDOWN_UNTIL:
        return []

    try:
        query_vector = await embed_text(query, input_type="search_query")

        pipeline = [
            {
                "$vectorSearch": {
                    "index": "recipe_vector_index",
                    "path": "embedding",
                    "queryVector": query_vector,
                    # numCandidates should be ~15x limit for good recall
                    "numCandidates": limit * 15,
                    "limit": limit,
                    # Only search this user's recipes
                    "filter": {"user_id": user_id},
                }
            },
            {
                "$project": {
                    "title": 1,
                    "content": 1,
                    "_id": 0,
                    "score": {"$meta": "vectorSearchScore"},
                }
            },
        ]

        results = await recipes_col().aggregate(pipeline).to_list(length=limit)

        # Filter out low-similarity results
        filtered = [r for r in results if r.get("score", 0) > 0.6]

        logger.debug(
            "vector_search_complete",
            extra={
                "results_total": len(results),
                "results_above_threshold": len(filtered),
            },
        )
        return filtered

    except Exception as e:
        _RAG_DB_COOLDOWN_UNTIL = time.monotonic() + cooldown_seconds
        logger.warning("vector_search_failed", extra={"error": str(e)})
        return []