import os
from langchain_cohere import CohereEmbeddings

_embeddings = None


def get_embeddings() -> CohereEmbeddings:
    global _embeddings
    if _embeddings is None:
        _embeddings = CohereEmbeddings(
            model="embed-english-v3.0",
            cohere_api_key=os.getenv("COHERE_API_KEY"),
        )
    return _embeddings


def embed_text(text: str) -> list[float]:
    return get_embeddings().embed_query(text)


def embed_recipe(title: str, content: str) -> list[float]:
    text = f"{title}\n\n{content[:500]}"
    return embed_text(text)