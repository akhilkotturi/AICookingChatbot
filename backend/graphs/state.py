from typing import List, TypedDict, Optional

class State(TypedDict):
    query: str
    conversation_history: Optional[List[dict]]
    user_cookware: Optional[List[str]]
    scope: Optional[str]
    question_type: Optional[str]
    cookware_in_use: Optional[List[str]]
    result: Optional[str]
    is_recipe: Optional[bool]
    debug: Optional[bool]
    debug_trace: Optional[List[str]]