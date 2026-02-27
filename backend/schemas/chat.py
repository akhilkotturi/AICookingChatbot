from typing import List, Optional

from pydantic import BaseModel


class ChatRequest(BaseModel):
    query: str


class ChatResponse(BaseModel):
    result: str
    cookware_in_use: Optional[List[str]] = None
    scope: str
    question_type: Optional[str] = None
