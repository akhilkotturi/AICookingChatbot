from .state import State
from .prompts import (
    classify_scope_prompt, classify_question_type_prompt, handle_ingredients_prompt, handle_recipe_prompt, handle_general_prompt, check_cookware_prompt
)
from langchain_groq import ChatGroq
from tools.cookware import missing_cookware
from tools.search import search

llm = ChatGroq(model="llama-3.3-70b-versatile")

def classify_scope(state: State) -> State:
    '''
    Classify a query as in or out of scope
    '''

    chain = classify_scope_prompt | llm
    response = chain.invoke({"query": state["query"]})
    scope = response.content.strip()
    return {**state, "scope": scope}

def classify_question_type(state: State) -> State:
    '''
    Classify a query as a question about ingredients, recipe, or general cooking
    '''

    chain = classify_question_type_prompt | llm
    response = chain.invoke({"query": state["query"]})
    question_type = response.content.strip()
    return {**state, "question_type": question_type}


def handle_ingredients(state: State) -> State:
    '''
    Handle a question about ingredients
    '''
    search_result = search(state["query"])
    chain = handle_ingredients_prompt | llm
    response = chain.invoke({
        "query": state["query"], 
        "search_result": search_result
        })
    return {**state, "result": response.content.strip()}

def handle_recipe(state: State) -> State:
    '''
    Handle a question about recipe
    '''
    search_result = search(state["query"])
    chain = handle_recipe_prompt | llm
    response = chain.invoke({
        "query": state["query"], 
        "search_result": search_result
        })
    return {**state, "result": response.content.strip()}

def handle_general(state: State) -> State:
    '''
    Handle general cooking questions/misc questions about cooking
    '''

    chain = handle_general_prompt | llm
    response = chain.invoke({"query": state["query"]})
    return {**state, "result": response.content.strip()}

def check_cookware(state: State) -> State:
    '''
    Cross-check required cookware against the user's available cookware list
    '''

    chain = check_cookware_prompt | llm
    response = chain.invoke({"recipe": state["result"]})

    required = [item.strip() for item in response.content.strip().split(",")]
    missing = missing_cookware(required)
    
    result_note = f"\n\nYou have all the necessary cookware!" if not missing else f"\n\nOh, you are missing: {', '.join(missing)}"

    return {**state, "cookware_in_use": required, "result": state["result"] + result_note}

def handle_reject(state: State) -> State:
    '''
    Handle rejecting a question as out of scope
    '''

    return {**state, "result": "Sorry, that question is out of my scope."}