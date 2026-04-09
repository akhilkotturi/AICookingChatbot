from dotenv import load_dotenv
load_dotenv()

import asyncio
import json
import os
import re
from typing import AsyncGenerator

from jose import jwt as jose_jwt
import httpx

import time
from utils.logging import log_query_event

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

from services.embeddings import find_similar_recipes

from routers.recipe import router as recipe_router

from routers.vision import router as vision_router


logger = get_logger(__name__)
USE_LOCAL_DB_FALLBACK = os.getenv("LOCAL_FALLBACK_ON_DB_ERROR", "true").lower() == "true"


def _is_mongo_transport_outage(exc: Exception) -> bool:
    text = str(exc).lower()
    return (
        "serverselectiontimeouterror" in text
        or "ssl handshake failed" in text
        or "tlsv1_alert_internal_error" in text
        or "replicasetnoprimary" in text
    )


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

app = FastAPI(
    title="Mise en Place — AI Cooking Chatbot API",
    description="""
        ## AI Cooking Assistant

        A conversational AI chatbot with LangGraph-based agentic orchestration,
        semantic recipe search, and cookware-aware recipe generation.

        ### Architecture
        - **LangGraph StateGraph** routes queries through classify → handle → validate nodes
        - **RAG pipeline** uses Cohere embeddings + MongoDB Atlas Vector Search
        - **Agentic tools** — web search, USDA nutrition lookup, ingredient substitution
        - **Streaming** via Server-Sent Events (SSE) for real-time token delivery
        - **Auth** via Supabase JWT (OAuth2 compatible)

        ### Quick Start
        1. Authenticate via Supabase to get a JWT
        2. Pass it as `Authorization: Bearer <token>`
        3. POST to `/query/stream` with your cooking question
    """,
    version="2.0.0",
    openapi_tags=[
        {
            "name": "chat",
            "description": "Streaming chat and query endpoints",
        },
        {
            "name": "recipe",
            "description": "Recipe import, search, scaling, and management",
        },
        {
            "name": "vision",
            "description": "Image analysis for ingredient detection",
        },
        {
            "name": "profile",
            "description": "User cookware profile management",
        },
    ],
    
    docs_url=None if os.getenv("ENV") == "production" else "/docs",
    redoc_url=None if os.getenv("ENV") == "production" else "/redoc",
    openapi_url=None if os.getenv("ENV") == "production" else "/openapi.json",
)

app.include_router(recipe_router, prefix="/recipe", tags=["recipe"])
app.include_router(vision_router, prefix="/vision", tags=["vision"])
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
    except Exception:
        pass

    # Fall back to Supabase API — never decode without signature verification
    verified = await _verify_with_supabase(token)
    if verified:
        return verified

    logger.warning("Optional auth failed for /query/stream; continuing as anonymous")
    return None

# Health

@app.get("/health", tags=["chat"])
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

@app.get("/cookware", response_model=CookwareListResponse, tags=["profile"])
def get_cookware_catalog():
    return CookwareListResponse(cookware=ALL_COOKWARE)

# Chat streaming

@app.post("/query/stream", tags=["chat"])
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
        start_time = time.monotonic()

        try:
            # Step 1+2: classify scope and question type in parallel
            scope_resp, type_resp = await asyncio.gather(
                (classify_scope_prompt | llm).ainvoke({"query": body.query}),
                (classify_question_type_prompt | llm).ainvoke({"query": body.query}),
            )

            scope = scope_resp.content.strip().lower()
            if scope not in ("in_scope", "out_of_scope"):
                scope = "in_scope"

            if scope == "out_of_scope":
                yield {"event": "chunk", "data": "I'm specialized in cooking and food! Ask me about recipes, ingredients, techniques, or meal planning. 🍳"}
                yield {"event": "done", "data": json.dumps({"scope": scope, "question_type": None, "cookware_in_use": None, "missing_cookware": None, "is_recipe": False})}
                return

            question_type = type_resp.content.strip().lower()
            if question_type == "dietary_restriction":
                # Backward compatibility if model emits the old label.
                question_type = "religious"
            if question_type not in ("ingredients_query", "recipe_request", "food_safety", "religious", "general"):
                question_type = "general"

            is_recipe = question_type == "recipe_request"

            # Step 2.5: fetch RAG context for authenticated users
            rag_context = []
            if user and question_type in ("recipe_request", "ingredients_query"):
                try:
                    rag_context = await find_similar_recipes(
                        query=body.query,
                        user_id=user["user_id"],
                        limit=3,
                    )
                    if rag_context:
                        logger.info(
                            "rag_context_loaded",
                            extra={"recipes_found": len(rag_context)},
                        )
                except Exception as e:
                    logger.warning("rag_fetch_failed", extra={"error": str(e)})

            # Step 3: build messages for all question types
            if question_type == "recipe_request":
                messages = build_recipe_messages(
                    body.query, history, user_cookware, rag_context=rag_context
                )
            elif question_type == "ingredients_query":
                messages = build_ingredients_messages(
                    body.query, history, rag_context=rag_context
                )
            elif question_type == "food_safety":
                messages = build_food_safety_messages(body.query, history)
            elif question_type == "religious":
                messages = build_religious_messages(body.query, history)
            else:
                messages = build_general_messages(body.query, history)

            # Step 4: check for tool use (can't stream tool calls)
            if question_type in ("recipe_request", "ingredients_query", "food_safety", "religious"):
                try:
                    probe = await llm_with_tools.ainvoke(messages)
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
                cw_resp = await (check_cookware_prompt | llm).ainvoke({"recipe": full_text})
                cookware_in_use = [i.strip() for i in cw_resp.content.strip().split(",") if i.strip()]
                missing = missing_cookware(cookware_in_use, user_cookware)
                note = "\n\n✅ You have all the cookware needed!" if not missing else f"\n\n⚠️ **Missing cookware:** {', '.join(missing)}"
                yield {"event": "chunk", "data": note}

            latency = round((time.monotonic() - start_time) * 1000, 2)
            log_query_event(
                logger=logger,
                query=body.query,
                question_type=question_type,
                scope=scope,
                cookware_in_use=cookware_in_use,
                missing_cookware=missing,
                user_id=user["user_id"] if user else None,
                latency_ms=latency,
            )

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
        if not USE_LOCAL_DB_FALLBACK and not _is_mongo_transport_outage(exc):
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
        if not USE_LOCAL_DB_FALLBACK and not _is_mongo_transport_outage(exc):
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
        if not USE_LOCAL_DB_FALLBACK and not _is_mongo_transport_outage(exc):
            raise _db_unavailable_error("get_recipes", exc)
        logger.warning("Mongo unavailable for get_recipes; using local fallback")
        docs = await local_list_recipes(user["user_id"], limit=100)
    return {"recipes": docs}


_MAX_RECIPE_TITLE_LEN = 200
_MAX_RECIPE_CONTENT_LEN = 50_000  # ~50 KB


@app.post("/recipes")
async def save_recipe(request: Request, user: dict = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Auth required")
    body = await request.json()

    title = str(body.get("title", ""))[:_MAX_RECIPE_TITLE_LEN]
    content = str(body.get("content", ""))
    if len(content) > _MAX_RECIPE_CONTENT_LEN:
        raise HTTPException(status_code=400, detail="Recipe content exceeds maximum allowed size.")

    from datetime import datetime, timezone
    from services.embeddings import embed_recipe_for_storage

    # Generate embedding — if this fails we still save the recipe
    # The recipe just won't appear in semantic search results
    embedding = await embed_recipe_for_storage(
        title=title,
        content=content,
    )

    doc = {
        **body,
        "title": title,
        "content": content,
        "user_id": user["user_id"],
        "created_at": datetime.now(timezone.utc),
    }

    if embedding:
        doc["embedding"] = embedding
        logger.info(
            "recipe_saved_with_embedding",
            extra={"title": title},
        )
    else:
        logger.warning(
            "recipe_saved_without_embedding",
            extra={"title": title},
        )

    try:
        result = await recipes_col().insert_one(doc)
        return {"id": str(result.inserted_id)}
    except Exception as exc:
        if not USE_LOCAL_DB_FALLBACK and not _is_mongo_transport_outage(exc):
            raise _db_unavailable_error("save_recipe", exc)

        logger.warning("Mongo unavailable for save_recipe; using local fallback")
        fallback_id = await local_save_recipe(user["user_id"], body)
        return {"id": fallback_id}


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
        if not USE_LOCAL_DB_FALLBACK and not _is_mongo_transport_outage(exc):
            raise _db_unavailable_error("delete_recipe", exc)
        logger.warning("Mongo unavailable for delete_recipe; using local fallback")
        await local_delete_recipe(user["user_id"], recipe_id)
    return {"ok": True}