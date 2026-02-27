from dotenv import load_dotenv
load_dotenv()

import json
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from schemas.chat import ChatRequest, ChatResponse
from graphs.graph import app as graph

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/query", response_model=ChatResponse)
def query(request: ChatRequest):
    result = graph.invoke({"query": request.query})
    return ChatResponse(
        result=result["result"],
        cookware_in_use=result.get("cookware_in_use"),
        scope=result["scope"],
        question_type=result.get("question_type"),
    )


@app.post("/query/stream")
async def query_stream(request: ChatRequest):
    async def event_generator() -> AsyncGenerator[dict[str, str], None]:
        try:
            result = graph.invoke({"query": request.query})
            text = result.get("result", "") or ""

            chunk_size = 24
            for i in range(0, len(text), chunk_size):
                yield {"event": "chunk", "data": text[i : i + chunk_size]}

            meta = {
                "scope": result.get("scope"),
                "question_type": result.get("question_type"),
                "cookware_in_use": result.get("cookware_in_use"),
            }
            yield {"event": "done", "data": json.dumps(meta)}
        except Exception as exc:
            yield {"event": "error", "data": str(exc)}

    return EventSourceResponse(event_generator())