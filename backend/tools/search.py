from duckduckgo_search import DDGS
from langchain_core.tools import tool
from utils.logging import get_logger

logger = get_logger(__name__)


@tool
def search(query: str) -> str:
    """Search the web for cooking-related information using DuckDuckGo.

    Use this tool when you need current, specific, or detailed recipe or
    ingredient information that you may not have in your training data.
    """
    try:
        logger.info("Search tool invoked for query: %s", query)
        with DDGS(timeout=8) as ddgs:
            results = list(ddgs.text(query, max_results=2))
            if not results:
                logger.info("Search tool returned no results")
                return "No results found."
            logger.info("Search tool returned %s result(s)", len(results))
            return results[0].get("body", "No summary available.")
    except Exception as exc:
        logger.exception("Search tool failed: %s", exc)
        return "Search temporarily unavailable. Please answer using general cooking knowledge."