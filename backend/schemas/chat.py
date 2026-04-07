from typing import List, Optional
from pydantic import BaseModel, Field


class ConversationTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    query: str = Field(
        ...,
        min_length=1,
        max_length=1000,
        description="The user's cooking question",
        examples=["How do I make pasta carbonara?"],
    )
    conversation_history: Optional[List[ConversationTurn]] = Field(
        None,
        description="Previous turns in this conversation for context",
    )
    user_cookware: Optional[List[str]] = Field(
        None,
        description="Cookware the user owns. Recipe responses will be tailored to this list.",
        examples=[["Frying Pan", "Knife", "Oven"]],
    )
    session_id: str = Field(
        default="default",
        max_length=64,
        description="Session identifier for Redis-backed conversation memory",
    )
    debug: bool = Field(
        default=False,
        description="If true, includes LangGraph node trace in response metadata",
    )


class ChatResponse(BaseModel):
    result: str
    cookware_in_use: Optional[List[str]] = None
    missing_cookware: Optional[List[str]] = None
    scope: str
    question_type: Optional[str] = None
    is_recipe: Optional[bool] = None
    debug_trace: Optional[List[str]] = None


class CookwareListResponse(BaseModel):
    cookware: List[str]