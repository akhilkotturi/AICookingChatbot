from typing import List, Optional
from pydantic import BaseModel, Field


class ConversationTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000)
    conversation_history: Optional[List[ConversationTurn]] = None
    user_cookware: Optional[List[str]] = None
    debug: bool = False


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