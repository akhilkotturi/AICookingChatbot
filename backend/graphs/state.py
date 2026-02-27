from typing import List, TypedDict, Optional

class State(TypedDict):
    '''
    State of the world at a given time, as represented by the graph.
    '''
    query: str
    scope: Optional[str]
    question_type: Optional[str]
    cookware_in_use: Optional[List[str]]
    result : Optional[str]
    debug: Optional[bool]
    debug_trace: Optional[List[str]]