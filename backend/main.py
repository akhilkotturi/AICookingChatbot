from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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