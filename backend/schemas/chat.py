from typing import List, Optional

from pydantic import BaseModel


class ChatRequest(BaseModel):
    query: str
    debug: bool = False


class ChatResponse(BaseModel):
    result: str
    cookware_in_use: Optional[List[str]] = None
    scope: str
    question_type: Optional[str] = None
    debug_trace: Optional[List[str]] = None
