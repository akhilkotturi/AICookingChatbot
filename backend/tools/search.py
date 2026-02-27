from duckduckgo_search import DDGS

def search(query: str) -> str:
    '''
    Search the web for a given query using DuckDuckGo
    '''
    try:
        with DDGS(timeout=8) as ddgs:
            results = list(ddgs.text(query, max_results=2))
            if not results:
                return "No results found."
            return results[0].get("body", "No summary available.")
    except Exception:
        return "Search temporarily unavailable. Please answer using general cooking knowledge."