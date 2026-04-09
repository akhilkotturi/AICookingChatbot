"""
Fridge/pantry image analysis using Groq Vision.

Flow:
1. Receive image file from frontend
2. Encode to base64
3. Send to Groq Vision with a prompt asking for ingredient list
4. Parse the response into a clean list
5. Return ingredients + a suggested query string

The suggested query feeds directly into the existing chat pipeline.
"""
import base64
import os
import re
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from pydantic import BaseModel
from groq import Groq
from limiter import limiter
from utils.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()

# Use the Groq vision model for food image analysis
# Note: llama-3.2-11b-vision-preview was decommissioned; using 90b variant instead
VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"

# Maximum file size: 4MB
MAX_FILE_SIZE = 4 * 1024 * 1024

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}

def _detect_mime_from_bytes(data: bytes) -> str | None:
    """Return MIME type from file magic bytes, or None if unrecognised."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


class ImageAnalysisResponse(BaseModel):
    ingredients: list[str]
    suggested_query: str


def _get_groq_client() -> Groq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not set")
    return Groq(api_key=api_key)


def _parse_ingredients(text: str) -> list[str]:
    """
    Parse the model's response into a clean list of ingredients.
    
    The model returns a newline-separated list like:
    "chicken breast
    cherry tomatoes
    cheddar cheese"
    
    We strip list markers (-, •, 1., etc.) and empty lines.
    """
    ingredients = []
    for line in text.strip().split("\n"):
        # Strip whitespace
        line = line.strip()
        # Remove list markers like "- ", "• ", "1. ", "* "
        line = re.sub(r"^[-•*\d\.]+\s*", "", line).strip()
        # Skip empty lines and lines that are too short
        if line and len(line) > 1:
            ingredients.append(line)
    # Cap at 20 ingredients
    return ingredients[:20]


@router.post("/analyze", response_model=ImageAnalysisResponse)
@limiter.limit("10/minute")
async def analyze_fridge_image(
    request: Request,
    file: UploadFile = File(...),
):
    """
    Analyze a fridge or pantry photo and return identified ingredients.
    
    The returned suggested_query can be sent directly to /query/stream
    to get recipe suggestions based on what's visible.
    """
    # Read file first so we can validate by magic bytes, not client-supplied headers
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail="Image must be under 4MB.",
        )

    # Validate file type from actual bytes — ignore client Content-Type and filename
    mime_type = _detect_mime_from_bytes(contents)
    if not mime_type:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Upload a JPEG, PNG, or WebP image.",
        )

    # Encode to base64
    b64_image = base64.standard_b64encode(contents).decode("utf-8")
    media_type = mime_type

    logger.info(
        "vision_analyze_started",
        extra={
            "file_size_kb": round(len(contents) / 1024, 1),
            "media_type": media_type,
        },
    )

    client = _get_groq_client()

    try:
        response = client.chat.completions.create(
            model=VISION_MODEL,
            max_tokens=512,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                # Data URL format: embeds the image directly
                                # rather than linking to a hosted URL
                                "url": f"data:{media_type};base64,{b64_image}",
                            },
                        },
                        {
                            "type": "text",
                            "text": (
                                "Look at this image carefully. "
                                "List every food ingredient, produce item, protein, "
                                "dairy product, condiment, or pantry staple you can see.\n\n"
                                "Rules:\n"
                                "- One ingredient per line\n"
                                "- Be specific (e.g. 'cherry tomatoes' not just 'tomatoes')\n"
                                "- Only include things that are clearly visible\n"
                                "- No commentary, no preamble, just the list\n"
                                "- If this is not a food/fridge/pantry image, "
                                "respond with exactly: NOT_FOOD_IMAGE"
                            ),
                        },
                    ],
                }
            ],
        )

        response_text = response.choices[0].message.content.strip()

        # Handle non-food images
        if response_text == "NOT_FOOD_IMAGE":
            raise HTTPException(
                status_code=422,
                detail="This doesn't look like a fridge or pantry photo. Please upload a food image.",
            )

        ingredients = _parse_ingredients(response_text)

        if not ingredients:
            raise HTTPException(
                status_code=422,
                detail="Could not identify any ingredients. Try a clearer photo with better lighting.",
            )

        # Build a natural query to feed into the chat pipeline
        ingredient_list = ", ".join(ingredients)
        suggested_query = (
            f"What can I make with these ingredients I have: {ingredient_list}? "
            f"Suggest 2-3 recipes that use most of these."
        )

        logger.info(
            "vision_analyze_complete",
            extra={"ingredients_found": len(ingredients)},
        )

        return ImageAnalysisResponse(
            ingredients=ingredients,
            suggested_query=suggested_query,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("vision_analyze_failed", extra={"error": str(e)})
        raise HTTPException(
            status_code=500,
            detail="Image analysis failed. Please try again.",
        )