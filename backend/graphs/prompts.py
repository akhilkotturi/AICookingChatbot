from langchain_core.prompts import PromptTemplate
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage


classify_scope_prompt = PromptTemplate(
    input_variables=["query"],
    template="""You are a cooking assistant. Decide if the following query is related to cooking, recipes, food, ingredients, kitchen tools, meal planning, or nutrition.
        Reply with only "in_scope" or "out_of_scope".

        Query: {query}
        """
)

classify_question_type_prompt = PromptTemplate(
    input_variables=["query"],
    template="""Classify the following cooking query into one of these categories:
        - "general" for general cooking technique, tips, or miscellaneous cooking questions
        - "recipe_request" for requests for a specific recipe or how to cook a specific dish
        - "ingredients_query" for questions about what to cook with certain ingredients or substitutions

        Reply with only the category name.

        Query: {query}
        """
)

check_cookware_prompt = PromptTemplate(
    input_variables=["recipe"],
    template="""Given the following recipe, extract all cookware and kitchen tools required.
        Reply with only a comma-separated list of cookware items, nothing else.
        Example: "Frying Pan, Spatula, Knife, Cutting Board"

        Recipe: {recipe}

        Cookware:
        """
)


def _build_history(history: list[dict]) -> list:
    messages = []
    for turn in history[-6:]:
        if turn["role"] == "user":
            messages.append(HumanMessage(content=turn["content"]))
        else:
            messages.append(AIMessage(content=turn["content"]))
    return messages


def build_general_messages(query: str, history: list[dict]) -> list:
    system = SystemMessage(content="""You are an expert cooking assistant with deep knowledge of global cuisines, techniques, and food science.
        Be helpful, detailed, and encouraging. When explaining techniques, be specific and practical.
        Format your responses using markdown: use ## for section headings, - for bullet lists, 1. for numbered steps, and > for tips or notes. Never use **bold** as a substitute for headings.""")
    return [system, *_build_history(history), HumanMessage(content=query)]


def build_recipe_messages(query: str, history: list[dict], user_cookware: list[str] | None) -> list:
    cookware_ctx = ""
    if user_cookware:
        cookware_ctx = f"\n\nThe user has these tools available: {', '.join(user_cookware)}. Tailor the recipe accordingly."

    system = SystemMessage(content=f"""You are an expert cooking assistant specializing in recipes.
        When providing a recipe, use this exact markdown structure:

        # Recipe Name

        One or two sentence intro.

        ## Ingredients

        - ingredient with precise measurement
        - ingredient with precise measurement

        ## Method

        1. First step.
        2. Second step.

        ## Tips

        > Optional tip as a blockquote.

        Rules:
        - Always use # for the recipe title, ## for section headings, - for ingredient bullets, and numbered steps for method.
        - Never use **bold** for section headings — always use ## headings.
        - Use both metric and imperial measurements.
        - Omit the Tips section if there is nothing notable to add.
        - You have access to a web search tool — use it for specific or less common recipes.{cookware_ctx}""")
    return [system, *_build_history(history), HumanMessage(content=query)]


def build_ingredients_messages(query: str, history: list[dict]) -> list:
    system = SystemMessage(content="""You are an expert cooking assistant specializing in ingredients.
        Help users figure out what to cook with what they have, suggest substitutions, and explain flavor profiles.
        Be creative and give multiple options when possible.
        Format your responses using markdown: use ## for section headings, - for bullet lists, 1. for numbered steps, and > for tips or notes. Never use **bold** as a substitute for headings.
        You have access to a web search tool — use it for specific sourcing or seasonal questions.""")
    return [system, *_build_history(history), HumanMessage(content=query)]