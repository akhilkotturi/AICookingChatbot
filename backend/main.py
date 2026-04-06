from dotenv import load_dotenv
load_dotenv()

import json
import os
import re
from typing import AsyncGenerator

from jose import jwt as jose_jwt
import httpx

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from limiter import limiter
from sse_starlette.sse import EventSourceResponse

from schemas.chat import ChatRequest, ChatResponse, CookwareListResponse
from graphs.graph import app as graph
from tools.cookware import ALL_COOKWARE, missing_cookware
from utils.logging import get_logger
from db import recipes_col, profiles_col, plans_col, ping_db
from local_store import (
    get_profile as local_get_profile,
    set_profile_cookware as local_set_profile_cookware,
    list_recipes as local_list_recipes,
    save_recipe as local_save_recipe,
    delete_recipe as local_delete_recipe,
)

from routers.recipe import router as recipe_router

logger = get_logger(__name__)
USE_LOCAL_DB_FALLBACK = os.getenv("LOCAL_FALLBACK_ON_DB_ERROR", "false").lower() == "true"


def _db_unavailable_error(operation: str, exc: Exception) -> HTTPException:
    logger.exception("MongoDB operation failed (%s): %s", operation, exc)
    return HTTPException(
        status_code=503,
        detail=(
            "Database unavailable. MongoDB Atlas connection failed (TLS/network). "
            "Check Atlas IP allowlist, cluster status, and outbound access to port 27017."
        ),
    )

# App

app = FastAPI(title="Mise en Place API", version="2.0.0")
app.include_router(recipe_router, prefix="/recipe", tags=["recipe"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
ALLOWED_ORIGINS = [origin.strip().rstrip("/") for origin in raw_origins.split(",") if origin.strip()]

for local_origin in ("http://localhost:3000", "http://127.0.0.1:3000"):
    if local_origin not in ALLOWED_ORIGINS:
        ALLOWED_ORIGINS.append(local_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# Auth

_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")  # Set in .env — found in Supabase dashboard → Settings → API → JWT Secret


def _supabase_base_url() -> str | None:
    raw = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    if not raw:
        return None

    # Preferred format: https://<project-ref>.supabase.co
    if raw.startswith("https://") and ".supabase.co" in raw:
        parts = raw.split("/")
        if len(parts) >= 3 and parts[2].endswith(".supabase.co"):
            return f"https://{parts[2]}"

    # Also accept dashboard URL format and derive the project hostname.
    match = re.search(r"/project/([a-z0-9-]+)", raw)
    if match:
        return f"https://{match.group(1)}.supabase.co"

    return None


async def _verify_with_supabase(token: str) -> dict | None:
    base_url = _supabase_base_url()
    api_key = (os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_ANON_KEY") or "").strip()
    if not base_url or not api_key:
        return None

    try:
        async with httpx.AsyncClient(timeout=6) as client:
            resp = await client.get(
                f"{base_url}/auth/v1/user",
                headers={"Authorization": f"Bearer {token}", "apikey": api_key},
            )
        if resp.status_code != 200:
            logger.warning("_verify_with_supabase: status=%s body=%s", resp.status_code, resp.text[:200])
            return None
        data = resp.json()
        user_id = data.get("id")
        if not user_id:
            return None
        return {"user_id": user_id, "email": data.get("email")}
    except Exception:
        logger.exception("Supabase token verification network error")
        return None

async def get_current_user(request: Request) -> dict | None:
    require_auth = os.getenv("REQUIRE_AUTH", "false").lower() == "true"
    auth = request.headers.get("Authorization", "")

    logger.info("get_current_user: auth header present=%s, starts_with_bearer=%s", bool(auth), auth.startswith("Bearer "))

    if not auth.startswith("Bearer "):
        logger.info("get_current_user: no bearer token → require_auth=%s", require_auth)
        if require_auth:
            raise HTTPException(status_code=401, detail="Authentication required")
        return None

    token = auth.split(" ", 1)[1]
    # Try fast local JWT verification first; fall back to Supabase API on any failure.
    if _JWT_SECRET:
        try:
            payload = jose_jwt.decode(token, _JWT_SECRET, algorithms=["HS256"], options={"verify_aud": False})
            logger.info("get_current_user: JWT OK sub=%s", payload.get("sub"))
            return {"user_id": payload.get("sub"), "email": payload.get("email")}
        except Exception as exc:
            logger.info("get_current_user: JWT decode failed (%s), falling back to Supabase API", exc)

    verified = await _verify_with_supabase(token)
    if verified:
        logger.info("get_current_user: Supabase API OK user_id=%s", verified.get("user_id"))
        return verified

    logger.warning("get_current_user: all auth methods failed, require_auth=%s", require_auth)
    if require_auth:
        raise HTTPException(status_code=401, detail="Invalid token")
    return None


async def get_optional_user(request: Request) -> dict | None:
    """Best-effort auth for public routes: never raises, returns None on any auth issue."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None

    token = auth.split(" ", 1)[1]
    try:
        if _JWT_SECRET:
            payload = jose_jwt.decode(token, _JWT_SECRET, algorithms=["HS256"], options={"verify_aud": False})
            return {"user_id": payload.get("sub"), "email": payload.get("email")}
        else:
            import base64
            payload_b64 = token.split(".")[1]
            payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
            payload = json.loads(base64.b64decode(payload_b64))
            return {"user_id": payload.get("sub"), "email": payload.get("email")}
    except Exception:
        verified = await _verify_with_supabase(token)
        if verified:
            return verified
        logger.warning("Optional auth failed for /query/stream; continuing as anonymous")
        return None

# Health

@app.get("/health")
def health():
    return {"status": "ok", "version": "2.0.0"}


@app.get("/health/db")
async def health_db():
    try:
        await ping_db()
        return {"status": "ok", "db": "mongo"}
    except Exception as exc:
        raise _db_unavailable_error("health_db", exc)

# Cookware catalog

@app.get("/cookware", response_model=CookwareListResponse)
def get_cookware_catalog():
    return CookwareListResponse(cookware=ALL_COOKWARE)

# Chat streaming

@app.post("/query/stream")
@limiter.limit("20/minute;100/day")
async def query_stream(request: Request, body: ChatRequest, user: dict | None = Depends(get_optional_user)):
    from langchain_groq import ChatGroq
    from langchain_core.messages import ToolMessage
    from graphs.prompts import (
        classify_scope_prompt,
        classify_question_type_prompt,
        check_cookware_prompt,
        build_general_messages,
        build_recipe_messages,
        build_ingredients_messages,
        build_food_safety_messages,
        build_religious_messages,
    )
    from tools.search import search

    llm = ChatGroq(model="llama-3.3-70b-versatile", temperature=0.7)
    llm_with_tools = llm.bind_tools([search])
    history = [t.model_dump() for t in (body.conversation_history or [])]
    user_cookware = body.user_cookware

    async def event_generator() -> AsyncGenerator[dict[str, str], None]:
        try:
            # Step 1: classify scope
            scope_resp = (classify_scope_prompt | llm).invoke({"query": body.query})
            scope = scope_resp.content.strip().lower()
            if scope not in ("in_scope", "out_of_scope"):
                scope = "in_scope"

            if scope == "out_of_scope":
                yield {"event": "chunk", "data": "I'm specialized in cooking and food! Ask me about recipes, ingredients, techniques, or meal planning. 🍳"}
                yield {"event": "done", "data": json.dumps({"scope": scope, "question_type": None, "cookware_in_use": None, "missing_cookware": None, "is_recipe": False})}
                return

            # Step 2: classify question type
            type_resp = (classify_question_type_prompt | llm).invoke({"query": body.query})
            question_type = type_resp.content.strip().lower()
            if question_type == "dietary_restriction":
                # Backward compatibility if model emits the old label.
                question_type = "religious"
            if question_type not in ("ingredients_query", "recipe_request", "food_safety", "religious", "general"):
                question_type = "general"

            is_recipe = question_type == "recipe_request"

            # Step 3: build messages
            if question_type == "recipe_request":
                messages = build_recipe_messages(body.query, history, user_cookware)
            elif question_type == "ingredients_query":
                messages = build_ingredients_messages(body.query, history)
            elif question_type == "food_safety":
                messages = build_food_safety_messages(body.query, history)
            elif question_type == "religious":
                messages = build_religious_messages(body.query, history)
            else:
                messages = build_general_messages(body.query, history)

            # Step 4: check for tool use (can't stream tool calls)
            if question_type in ("recipe_request", "ingredients_query", "food_safety", "religious"):
                try:
                    probe = llm_with_tools.invoke(messages)
                    if probe.tool_calls:
                        tool_call = probe.tool_calls[0]
                        tool_result = search.invoke(tool_call["args"])
                        messages.append(probe)
                        messages.append(ToolMessage(content=str(tool_result), tool_call_id=tool_call["id"]))
                except Exception as exc:
                    # Groq can occasionally return malformed tool-call output (tool_use_failed).
                    # Fall back to plain generation instead of failing the whole request.
                    logger.warning("Tool invocation failed; continuing without tools: %s", exc)

            # Step 5: stream generation
            full_text = ""
            async for chunk in llm.astream(messages):
                if chunk.content:
                    full_text += chunk.content
                    yield {"event": "chunk", "data": chunk.content}

            # Step 6: cookware check for recipes
            cookware_in_use = None
            missing = None
            if is_recipe and full_text:
                cw_resp = (check_cookware_prompt | llm).invoke({"recipe": full_text})
                cookware_in_use = [i.strip() for i in cw_resp.content.strip().split(",") if i.strip()]
                missing = missing_cookware(cookware_in_use, user_cookware)
                note = "\n\n✅ You have all the cookware needed!" if not missing else f"\n\n⚠️ **Missing cookware:** {', '.join(missing)}"
                yield {"event": "chunk", "data": note}

            yield {"event": "done", "data": json.dumps({
                "scope": scope,
                "question_type": question_type,
                "cookware_in_use": cookware_in_use,
                "missing_cookware": missing or None,
                "is_recipe": is_recipe,
            })}

        except Exception as exc:
            logger.exception("Streaming error: %s", exc)
            yield {"event": "error", "data": "An error occurred. Please try again."}

    return EventSourceResponse(event_generator())

# Cookware profile 

@app.get("/profile/cookware")
async def get_cookware_profile(user: dict = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Auth required")
    try:
        doc = await profiles_col().find_one({"user_id": user["user_id"]})
    except Exception as exc:
        if not USE_LOCAL_DB_FALLBACK:
            raise _db_unavailable_error("get_cookware_profile", exc)
        logger.warning("Mongo unavailable for get_cookware_profile; using local fallback")
        doc = await local_get_profile(user["user_id"])
    return {"cookware": doc.get("cookware", []) if doc else []}


@app.post("/profile/cookware")
async def save_cookware_profile(request: Request, user: dict = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Auth required")
    body = await request.json()
    try:
        await profiles_col().update_one(
            {"user_id": user["user_id"]},
            {"$set": {"cookware": body.get("cookware", [])}},
            upsert=True,
        )
    except Exception as exc:
        if not USE_LOCAL_DB_FALLBACK:
            raise _db_unavailable_error("save_cookware_profile", exc)
        logger.warning("Mongo unavailable for save_cookware_profile; using local fallback")
        await local_set_profile_cookware(user["user_id"], body.get("cookware", []))
    return {"ok": True}

# Saved recipes

@app.get("/recipes")
async def get_recipes(user: dict = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Auth required")
    try:
        cursor = recipes_col().find({"user_id": user["user_id"]}).sort("created_at", -1).limit(100)
        docs = await cursor.to_list(length=100)
        for d in docs:
            d["id"] = str(d.pop("_id"))
    except Exception as exc:
        if not USE_LOCAL_DB_FALLBACK:
            raise _db_unavailable_error("get_recipes", exc)
        logger.warning("Mongo unavailable for get_recipes; using local fallback")
        docs = await local_list_recipes(user["user_id"], limit=100)
    return {"recipes": docs}


@app.post("/recipes")
async def save_recipe(request: Request, user: dict = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Auth required")
    body = await request.json()
    from datetime import datetime, timezone
    doc = {**body, "user_id": user["user_id"], "created_at": datetime.now(timezone.utc)}
    try:
        result = await recipes_col().insert_one(doc)
        return {"id": str(result.inserted_id)}
    except Exception as exc:
        if not USE_LOCAL_DB_FALLBACK:
            raise _db_unavailable_error("save_recipe", exc)
        logger.warning("Mongo unavailable for save_recipe; using local fallback")
        fallback_doc = {**body}
        rid = await local_save_recipe(user["user_id"], fallback_doc)
        return {"id": rid}


@app.delete("/recipes/{recipe_id}")
async def delete_recipe(recipe_id: str, user: dict = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Auth required")
    from bson import ObjectId
    from bson.errors import InvalidId
    try:
        oid = ObjectId(recipe_id)
        await recipes_col().delete_one({"_id": oid, "user_id": user["user_id"]})
    except InvalidId:
        deleted = await local_delete_recipe(user["user_id"], recipe_id)
        if not deleted:
            raise HTTPException(status_code=400, detail="Invalid recipe ID")
    except Exception as exc:
        if not USE_LOCAL_DB_FALLBACK:
            raise _db_unavailable_error("delete_recipe", exc)
        logger.warning("Mongo unavailable for delete_recipe; using local fallback")
        await local_delete_recipe(user["user_id"], recipe_id)
    return {"ok": True}