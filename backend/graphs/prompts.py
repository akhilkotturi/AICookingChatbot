from langchain_core.prompts import PromptTemplate

classify_scope_prompt = PromptTemplate(
    input_variables=["query"],
    template="""
    You are a cooking assistant. Decide if the following query is related to cooking or recipes or not.
    Reply with only "in_scope" or "out_of_scope".

    Query: {query}
    """
)

classify_question_type_prompt = PromptTemplate(
    input_variables=["query"],
    template="""
    Classify the following cooking query into one of these categories:
    - "general" for general cooking or miscellaneous questions about cooking
    - "recipe_request" for requests for a specific recipe or about how to cook a specific dish
    - "ingredients_query" for questions about what to cook with certain ingredients, about ingredient substitutions, or where to find certain ingredients
    
    Reply with only the category name.

    Query: {query}
    """
)

handle_general_prompt = PromptTemplate(
    input_variables=["query"],
    template="""
    You are a cooking assistant. Answer the following general cooking question or miscellaneous question about cooking. Try to be as inclusive and helpful as possible in your response. Provide detailed explanations and suggestions when relevant.

    Question: {query}

    Answer:
    """
)

handle_recipe_prompt = PromptTemplate(
    input_variables=["query"],
    template="""
    You are a cooking assistant. Answer the following question about a recipe or how to cook a specific dish. Try to be as inclusive and helpful as possible in your response. Provide detailed explanations and suggestions when relevant.
    You have access to a web search tool — use it if you need current, specific, or detailed recipe information.

    Question: {query}

    Answer:
    """
)

handle_ingredients_prompt = PromptTemplate(
    input_variables=["query"],
    template="""
    You are a cooking assistant. Answer the following question about ingredients, which could be about what to cook with certain ingredients, about ingredient substitutions, or where to find certain ingredients. Try to be as inclusive and helpful as possible in your response. Provide detailed explanations and suggestions when relevant.
    You have access to a web search tool — use it if you need specific or current information.

    Question: {query}

    Answer:
    """
)

check_cookware_prompt = PromptTemplate(
    input_variables=["recipe"],
    template="""
    You are a cooking assistant. Given the following recipe, extract all the cookware and kitchen tools required to make it.
    Reply with only a comma-separated list of cookware items, nothing else.
    Example: "Frying Pan, Spatula, Knife"

    Recipe: {recipe}

    Cookware:
    """
)