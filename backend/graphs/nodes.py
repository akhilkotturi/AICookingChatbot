from langchain_core.messages import HumanMessage, ToolMessage

from .state import State
from .prompts import (
    classify_scope_prompt, classify_question_type_prompt, handle_ingredients_prompt, handle_recipe_prompt, handle_general_prompt, check_cookware_prompt
)
from langchain_groq import ChatGroq
from tools.cookware import missing_cookware
from tools.search import search
from utils.logging import get_logger

llm = ChatGroq(model="llama-3.3-70b-versatile")
llm_with_tools = llm.bind_tools([search])
logger = get_logger(__name__)


def _trace(state: State, message: str) -> State:
    trace = list(state.get("debug_trace") or [])
    trace.append(message)
    if state.get("debug"):
        logger.info(message)
    return {**state, "debug_trace": trace}

def classify_scope(state: State) -> State:
    '''
    Classify a query as in or out of scope
    '''

    chain = classify_scope_prompt | llm
    response = chain.invoke({"query": state["query"]})
    scope = response.content.strip()
    next_state = {**state, "scope": scope}
    return _trace(next_state, f"Node classify_scope -> {scope}")

def classify_question_type(state: State) -> State:
    '''
    Classify a query as a question about ingredients, recipe, or general cooking
    '''

    chain = classify_question_type_prompt | llm
    response = chain.invoke({"query": state["query"]})
    question_type = response.content.strip()
    next_state = {**state, "question_type": question_type}
    return _trace(next_state, f"Node classify_question_type -> {question_type}")


def handle_ingredients(state: State) -> State:
    '''
    Handle a question about ingredients.
    The LLM decides whether to invoke the search tool based on the query.
    '''
    state = _trace(state, "Node handle_ingredients -> LLM deciding whether to invoke search tool")
    prompt_text = handle_ingredients_prompt.format(query=state["query"])
    messages = [HumanMessage(content=prompt_text)]
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

    next_state = {**state, "result": final_response.content.strip()}
    return _trace(next_state, "Node handle_ingredients -> response generated")

def handle_recipe(state: State) -> State:
    '''
    Handle a question about a recipe.
    The LLM decides whether to invoke the search tool based on the query.
    '''
    state = _trace(state, "Node handle_recipe -> LLM deciding whether to invoke search tool")
    prompt_text = handle_recipe_prompt.format(query=state["query"])
    messages = [HumanMessage(content=prompt_text)]
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

    next_state = {**state, "result": final_response.content.strip()}
    return _trace(next_state, "Node handle_recipe -> response generated")

def handle_general(state: State) -> State:
    '''
    Handle general cooking questions/misc questions about cooking
    '''

    chain = handle_general_prompt | llm
    response = chain.invoke({"query": state["query"]})
    next_state = {**state, "result": response.content.strip()}
    return _trace(next_state, "Node handle_general -> response generated")

def check_cookware(state: State) -> State:
    '''
    Cross-check required cookware against the user's available cookware list
    '''

    state = _trace(state, "Node check_cookware -> cookware extraction started")
    chain = check_cookware_prompt | llm
    response = chain.invoke({"recipe": state["result"]})

    required = [item.strip() for item in response.content.strip().split(",")]
    missing = missing_cookware(required)

    result_note = f"\n\nYou have all the necessary cookware!" if not missing else f"\n\nOh, you are missing: {', '.join(missing)}"

    next_state = {**state, "cookware_in_use": required, "result": state["result"] + result_note}
    if missing:
        return _trace(next_state, f"Node check_cookware -> missing cookware: {', '.join(missing)}")
    return _trace(next_state, "Node check_cookware -> all cookware available")

def handle_reject(state: State) -> State:
    '''
    Handle rejecting a question as out of scope
    '''

    next_state = {**state, "result": "Sorry, that question is out of my scope."}
    return _trace(next_state, "Node handle_reject -> out_of_scope refusal returned")
