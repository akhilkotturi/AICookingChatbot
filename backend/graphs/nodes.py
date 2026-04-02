import os

from langchain_core.messages import ToolMessage

from .state import State
from .prompts import (
    classify_scope_prompt,
    classify_question_type_prompt,
    check_cookware_prompt,
    build_general_messages,
    build_recipe_messages,
    build_ingredients_messages,
)
from langchain_groq import ChatGroq
from tools.cookware import missing_cookware
from tools.search import search
from utils.logging import get_logger

logger = get_logger(__name__)


def _get_llm() -> ChatGroq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set. Add it to your environment or .env file.")
    return ChatGroq(model="llama-3.3-70b-versatile", api_key=api_key)


def _get_llm_with_tools():
    return _get_llm().bind_tools([search])


def _trace(state: State, message: str) -> State:
    trace = list(state.get("debug_trace") or [])
    trace.append(message)
    if state.get("debug"):
        logger.info(message)
    return {**state, "debug_trace": trace}


def classify_scope(state: State) -> State:
    llm = _get_llm()
    chain = classify_scope_prompt | llm
    response = chain.invoke({"query": state["query"]})
    scope = response.content.strip().lower()
    if scope not in ("in_scope", "out_of_scope"):
        scope = "in_scope"
    next_state = {**state, "scope": scope}
    return _trace(next_state, f"Node classify_scope -> {scope}")


def classify_question_type(state: State) -> State:
    llm = _get_llm()
    chain = classify_question_type_prompt | llm
    response = chain.invoke({"query": state["query"]})
    question_type = response.content.strip().lower()
    if question_type not in ("ingredients_query", "recipe_request", "general"):
        question_type = "general"
    next_state = {**state, "question_type": question_type}
    return _trace(next_state, f"Node classify_question_type -> {question_type}")


def handle_ingredients(state: State) -> State:
    state = _trace(state, "Node handle_ingredients -> LLM deciding whether to invoke search tool")
    llm = _get_llm()
    llm_with_tools = _get_llm_with_tools()
    history = state.get("conversation_history") or []
    messages = build_ingredients_messages(state["query"], history)
    response = llm_with_tools.invoke(messages)

    if response.tool_calls:
        tool_call = response.tool_calls[0]
        state = _trace(state, f"Node handle_ingredients -> LLM invoked search with: {tool_call['args']}")
        tool_result = search.invoke(tool_call["args"])
        messages.append(response)
        messages.append(ToolMessage(content=str(tool_result), tool_call_id=tool_call["id"]))
        final_response = llm.invoke(messages)
    else:
        state = _trace(state, "Node handle_ingredients -> LLM chose not to invoke search tool")
        final_response = response

    next_state = {**state, "result": final_response.content.strip(), "is_recipe": False}
    return _trace(next_state, "Node handle_ingredients -> response generated")


def handle_recipe(state: State) -> State:
    state = _trace(state, "Node handle_recipe -> LLM deciding whether to invoke search tool")
    llm = _get_llm()
    llm_with_tools = _get_llm_with_tools()
    history = state.get("conversation_history") or []
    user_cookware = state.get("user_cookware")
    messages = build_recipe_messages(state["query"], history, user_cookware)
    response = llm_with_tools.invoke(messages)

    if response.tool_calls:
        tool_call = response.tool_calls[0]
        state = _trace(state, f"Node handle_recipe -> LLM invoked search with: {tool_call['args']}")
        tool_result = search.invoke(tool_call["args"])
        messages.append(response)
        messages.append(ToolMessage(content=str(tool_result), tool_call_id=tool_call["id"]))
        final_response = llm.invoke(messages)
    else:
        state = _trace(state, "Node handle_recipe -> LLM chose not to invoke search tool")
        final_response = response

    next_state = {**state, "result": final_response.content.strip(), "is_recipe": True}
    return _trace(next_state, "Node handle_recipe -> response generated")


def handle_general(state: State) -> State:
    llm = _get_llm()
    history = state.get("conversation_history") or []
    messages = build_general_messages(state["query"], history)
    response = llm.invoke(messages)
    next_state = {**state, "result": response.content.strip(), "is_recipe": False}
    return _trace(next_state, "Node handle_general -> response generated")


def check_cookware(state: State) -> State:
    state = _trace(state, "Node check_cookware -> cookware extraction started")
    llm = _get_llm()
    chain = check_cookware_prompt | llm
    response = chain.invoke({"recipe": state["result"]})

    required = [item.strip() for item in response.content.strip().split(",") if item.strip()]
    missing = missing_cookware(required, state.get("user_cookware"))

    if not missing:
        result_note = "\n\nYou have all the necessary cookware."
    else:
        result_note = f"\n\nMissing cookware: {', '.join(missing)}"

    next_state = {**state, "cookware_in_use": required, "result": state["result"] + result_note}
    if missing:
        return _trace(next_state, f"Node check_cookware -> missing cookware: {', '.join(missing)}")
    return _trace(next_state, "Node check_cookware -> all cookware available")


def handle_reject(state: State) -> State:
    next_state = {**state, "result": "Sorry, that question is out of my scope.", "is_recipe": False}
    return _trace(next_state, "Node handle_reject -> out_of_scope refusal returned")


def polish_response(state: State) -> State:
    # Keep this node side-effect free so graph assembly never depends on model/tool availability.
    return _trace(state, "Node polish_response -> passthrough")