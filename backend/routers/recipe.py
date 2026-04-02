import ipaddress
import os
import re
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from recipe_scrapers import scrape_me
from limiter import limiter
from tools.cookware import normalize

router = APIRouter()

SPOONACULAR_KEY = os.getenv("SPOONACULAR_API_KEY")
SPOONACULAR_BASE = "https://api.spoonacular.com"

_PRIVATE_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local / cloud metadata
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
]


def _validate_url(url: str) -> None:
    """Raise HTTPException if the URL targets a private/internal resource."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only http/https URLs are allowed")
    hostname = parsed.hostname or ""
    if not hostname:
        raise HTTPException(status_code=400, detail="Invalid URL")
    try:
        addr = ipaddress.ip_address(hostname)
        if any(addr in net for net in _PRIVATE_NETWORKS):
            raise HTTPException(status_code=400, detail="URL points to a private network")
    except ValueError:
        pass  # hostname is a domain name, not an IP — allow it


def _spoonacular_headers() -> dict:
    return {"x-api-key": SPOONACULAR_KEY} if SPOONACULAR_KEY else {}


# Schemas

class ImportRequest(BaseModel):
    url: str

class ScaleRequest(BaseModel):
    ingredients: list[dict]
    original_servings: int = Field(..., ge=1, le=1000)
    target_servings: int = Field(..., ge=1, le=1000)

class SearchRequest(BaseModel):
    query: str
    number: int = 8


# Helpers

def parse_ingredients(raw: list[str]) -> list[dict]:
    return [{"raw": i, "name": i} for i in raw]


def extract_cookware(instructions: list[str]) -> list[str]:
    keywords = [
        "pan", "pot", "skillet", "oven", "bowl", "wok", "baking sheet",
        "whisk", "spatula", "knife", "cutting board", "blender", "strainer",
        "colander", "tongs", "ladle", "dutch oven", "cast iron", "air fryer",
        "instant pot", "slow cooker", "food processor", "stand mixer",
    ]
    found = set()
    text = " ".join(instructions).lower()
    for kw in keywords:
        if kw in text:
            found.add(normalize(kw))
    return sorted(found)


# Import from URL

@router.post("/import")
@limiter.limit("10/minute")
async def import_recipe(request: Request, body: ImportRequest):
    _validate_url(body.url)
    try:
        scraper = scrape_me(body.url, wild_mode=True)

        title        = scraper.title() or "Untitled Recipe"
        ingredients  = scraper.ingredients() or []
        instructions = scraper.instructions_list() or [scraper.instructions() or ""]
        servings_raw = scraper.yields() or ""
        total_time   = scraper.total_time() or None
        image        = scraper.image() or None

        servings_match = re.search(r"(\d+)", str(servings_raw))
        servings = int(servings_match.group(1)) if servings_match else 4

        cookware = extract_cookware(instructions)

        return {
            "title":        title,
            "source_url":   body.url,
            "servings":     servings,
            "total_time":   total_time,
            "image":        image,
            "ingredients":  parse_ingredients(ingredients),
            "instructions": instructions,
            "cookware":     cookware,
        }

    except HTTPException:
        raise
    except Exception as e:
        if SPOONACULAR_KEY:
            return await _spoonacular_extract(body.url)
        raise HTTPException(status_code=422, detail=f"Could not scrape recipe: {str(e)}")


async def _spoonacular_extract(url: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SPOONACULAR_BASE}/recipes/extract",
            params={"url": url},
            headers=_spoonacular_headers(),
            timeout=10,
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=422, detail="Could not extract recipe from URL")
        data = resp.json()
        instructions = [
            step["step"]
            for block in (data.get("analyzedInstructions") or [])
            for step in block.get("steps", [])
        ]
        return {
            "title":        data.get("title", "Untitled"),
            "source_url":   url,
            "servings":     data.get("servings", 4),
            "total_time":   data.get("readyInMinutes"),
            "image":        data.get("image"),
            "ingredients":  [{"raw": i["original"], "name": i["name"]} for i in data.get("extendedIngredients", [])],
            "instructions": instructions,
            "cookware":     extract_cookware(instructions),
        }


# Scale ingredients

@router.post("/scale")
@limiter.limit("30/minute")
def scale_recipe(request: Request, body: ScaleRequest):
    factor = body.target_servings / body.original_servings

    scaled = []
    for ing in body.ingredients:
        result = dict(ing)
        result["scale_factor"] = round(factor, 3)

        def scale_number(m):
            val = float(m.group())
            scaled_val = val * factor
            if scaled_val == int(scaled_val):
                return str(int(scaled_val))
            return f"{scaled_val:.2f}".rstrip("0").rstrip(".")

        if ing.get("raw"):
            result["scaled_raw"] = re.sub(r"\d+\.?\d*", scale_number, ing["raw"], count=2)
        scaled.append(result)

    return {
        "scale_factor": round(factor, 3),
        "original_servings": body.original_servings,
        "target_servings": body.target_servings,
        "ingredients": scaled,
    }


# Search via Spoonacular

@router.get("/search")
@limiter.limit("20/minute")
async def search_recipes(request: Request, q: str, number: int = Query(8, ge=1, le=50)):
    if not SPOONACULAR_KEY:
        raise HTTPException(status_code=503, detail="Search unavailable")

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SPOONACULAR_BASE}/recipes/complexSearch",
            params={
                "query": q,
                "number": number,
                "addRecipeInformation": True,
            },
            headers=_spoonacular_headers(),
            timeout=10,
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Search failed")

        data = resp.json()
        results = []
        for r in data.get("results", []):
            results.append({
                "id":         r["id"],
                "title":      r["title"],
                "image":      r.get("image"),
                "source_url": r.get("sourceUrl"),
                "servings":   r.get("servings"),
                "total_time": r.get("readyInMinutes"),
                "summary":    r.get("summary", ""),
            })
        return {"results": results}


# Get recipe detail from Spoonacular by ID

@router.get("/detail/{recipe_id}")
@limiter.limit("20/minute")
async def get_recipe_detail(request: Request, recipe_id: int):
    if not SPOONACULAR_KEY:
        raise HTTPException(status_code=503, detail="Recipe detail unavailable")

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SPOONACULAR_BASE}/recipes/{recipe_id}/information",
            headers=_spoonacular_headers(),
            timeout=10,
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="Recipe not found")

        data = resp.json()
        instructions = [
            step["step"]
            for block in (data.get("analyzedInstructions") or [])
            for step in block.get("steps", [])
        ]
        return {
            "title":        data.get("title"),
            "source_url":   data.get("sourceUrl"),
            "servings":     data.get("servings", 4),
            "total_time":   data.get("readyInMinutes"),
            "image":        data.get("image"),
            "ingredients":  [{"raw": i["original"], "name": i["name"]} for i in data.get("extendedIngredients", [])],
            "instructions": instructions,
            "cookware":     extract_cookware(instructions),
        }
