from dotenv import load_dotenv
load_dotenv()

import json
import os
from typing import AsyncGenerator

from jose import jwt as jose_jwt

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
from db import recipes_col, profiles_col, plans_col

from routers.recipe import router as recipe_router

logger = get_logger(__name__)

# App

app = FastAPI(title="Mise en Place API", version="2.0.0")
app.include_router(recipe_router, prefix="/recipe", tags=["recipe"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    allow_credentials=True,
)

# Auth

_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")  # Set in .env — found in Supabase dashboard → Settings → API → JWT Secret

async def get_current_user(request: Request) -> dict | None:
    require_auth = os.getenv("REQUIRE_AUTH", "false").lower() == "true"
    auth = request.headers.get("Authorization", "")

    if not auth.startswith("Bearer "):
        if require_auth:
            raise HTTPException(status_code=401, detail="Authentication required")
        return None

    token = auth.split(" ", 1)[1]
    try:
        if _JWT_SECRET:
            payload = jose_jwt.decode(token, _JWT_SECRET, algorithms=["HS256"], options={"verify_aud": False})
        else:
            # Fallback for local dev without JWT secret — logs a warning
            logger.warning("SUPABASE_JWT_SECRET not set — JWT signature is NOT verified. Set it in .env.")
            import base64
            payload_b64 = token.split(".")[1]
            payload_b64 += "=" * (4 - len(payload_b64) % 4)
            payload = json.loads(base64.b64decode(payload_b64))
        return {"user_id": payload.get("sub"), "email": payload.get("email")}
    except Exception:
        if require_auth:
            raise HTTPException(status_code=401, detail="Invalid token")
        return None

# Health

@app.get("/health")
def health():
    return {"status": "ok", "version": "2.0.0"}

# Cookware catalog

@app.get("/cookware", response_model=CookwareListResponse)
def get_cookware_catalog():
    return CookwareListResponse(cookware=ALL_COOKWARE)

# Chat streaming

@app.post("/query/stream")
@limiter.limit("20/minute;100/day")
async def query_stream(request: Request, body: ChatRequest, user: dict | None = Depends(get_current_user)):
    from langchain_groq import ChatGroq
    from langchain_core.messages import ToolMessage
    from graphs.prompts import (
        classify_scope_prompt,
        classify_question_type_prompt,
        check_cookware_prompt,
        build_general_messages,
        build_recipe_messages,
        build_ingredients_messages,
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
            if question_type not in ("ingredients_query", "recipe_request", "general"):
                question_type = "general"

            is_recipe = question_type == "recipe_request"

            # Step 3: build messages
            if question_type == "recipe_request":
                messages = build_recipe_messages(body.query, history, user_cookware)
            elif question_type == "ingredients_query":
                messages = build_ingredients_messages(body.query, history)
            else:
                messages = build_general_messages(body.query, history)

            # Step 4: check for tool use (can't stream tool calls)
            if question_type in ("recipe_request", "ingredients_query"):
                probe = llm_with_tools.invoke(messages)
                if probe.tool_calls:
                    tool_call = probe.tool_calls[0]
                    tool_result = search.invoke(tool_call["args"])
                    messages.append(probe)
                    messages.append(ToolMessage(content=str(tool_result), tool_call_id=tool_call["id"]))

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
    doc = await profiles_col().find_one({"user_id": user["user_id"]})
    return {"cookware": doc.get("cookware", []) if doc else []}


@app.post("/profile/cookware")
async def save_cookware_profile(request: Request, user: dict = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Auth required")
    body = await request.json()
    await profiles_col().update_one(
        {"user_id": user["user_id"]},
        {"$set": {"cookware": body.get("cookware", [])}},
        upsert=True,
    )
    return {"ok": True}

# Saved recipes

@app.get("/recipes")
async def get_recipes(user: dict = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Auth required")
    cursor = recipes_col().find({"user_id": user["user_id"]}).sort("created_at", -1).limit(100)
    docs = await cursor.to_list(length=100)
    for d in docs:
        d["id"] = str(d.pop("_id"))
    return {"recipes": docs}


@app.post("/recipes")
async def save_recipe(request: Request, user: dict = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Auth required")
    body = await request.json()
    from datetime import datetime, timezone
    doc = {**body, "user_id": user["user_id"], "created_at": datetime.now(timezone.utc)}
    result = await recipes_col().insert_one(doc)
    return {"id": str(result.inserted_id)}


@app.delete("/recipes/{recipe_id}")
async def delete_recipe(recipe_id: str, user: dict = Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Auth required")
    from bson import ObjectId
    from bson.errors import InvalidId
    try:
        oid = ObjectId(recipe_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Invalid recipe ID")
    await recipes_col().delete_one({"_id": oid, "user_id": user["user_id"]})
    return {"ok": True}