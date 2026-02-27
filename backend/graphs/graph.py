from langgraph.graph import StateGraph, END, START
from .state import State
from .nodes import (
    classify_scope,
    classify_question_type,
    handle_ingredients,
    handle_recipe,
    handle_general,
    check_cookware,
    handle_reject,
)

graph = StateGraph(State)

graph.add_node("classify_scope", classify_scope)
graph.add_node("classify_question_type", classify_question_type)
graph.add_node("handle_ingredients", handle_ingredients)
graph.add_node("handle_recipe", handle_recipe)
graph.add_node("handle_general", handle_general)
graph.add_node("check_cookware", check_cookware)
graph.add_node("handle_reject", handle_reject)

graph.set_entry_point("classify_scope")

graph.add_conditional_edges(
    "classify_scope",
    lambda state: state["scope"],
    {
        "in_scope": "classify_question_type",
        "out_of_scope": "handle_reject",
    }
)

graph.add_conditional_edges(
    "classify_question_type",
    lambda state: state["question_type"],
    {
        "ingredients_query": "handle_ingredients",
        "recipe_request": "handle_recipe",
        "general": "handle_general",
    }
)

graph.add_edge("handle_ingredients", END)
graph.add_edge("handle_recipe", "check_cookware")
graph.add_edge("handle_general", END)
graph.add_edge("check_cookware", END)
graph.add_edge("handle_reject", END)

app = graph.compile()