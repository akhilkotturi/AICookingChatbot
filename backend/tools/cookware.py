from typing import List

DEFAULT_COOKWARE = {
    "Spatula", "Frying Pan", "Little Pot", "Stovetop",
    "Whisk", "Knife", "Ladle", "Spoon", "Cutting Board",
    "Mixing Bowl", "Baking Sheet", "Oven",
}

SYNONYMS: dict[str, str] = {
    "wooden spatula": "Spatula", "rubber spatula": "Spatula",
    "skillet": "Frying Pan", "pan": "Frying Pan", "nonstick pan": "Frying Pan",
    "sauté pan": "Frying Pan", "saute pan": "Frying Pan",
    "saucepan": "Little Pot", "pot": "Little Pot", "small pot": "Little Pot",
    "stockpot": "Large Pot", "large pot": "Large Pot",
    "dutch oven": "Dutch Oven",
    "stove": "Stovetop", "range": "Stovetop", "burner": "Stovetop",
    "big spoon": "Ladle", "soup ladle": "Ladle",
    "wooden spoon": "Spoon",
    "chopping board": "Cutting Board", "chef's knife": "Knife",
    "chef knife": "Knife", "paring knife": "Knife",
    "baking tray": "Baking Sheet", "sheet pan": "Baking Sheet",
    "cookie sheet": "Baking Sheet",
    "bowl": "Mixing Bowl",
    "measuring cup": "Measuring Cup", "measuring cups": "Measuring Cup",
    "measuring spoons": "Measuring Spoon",
    "instant pot": "Instant Pot", "pressure cooker": "Pressure Cooker",
    "slow cooker": "Slow Cooker", "air fryer": "Air Fryer",
    "toaster oven": "Toaster Oven",
}

ALL_COOKWARE = sorted([
    "Air Fryer", "Baking Sheet", "Blender", "Cast Iron Skillet",
    "Cutting Board", "Dutch Oven", "Food Processor", "Frying Pan",
    "Grill", "Hand Mixer", "Instant Pot", "Knife", "Ladle",
    "Large Pot", "Little Pot", "Measuring Cup", "Measuring Spoon",
    "Microwave", "Mixing Bowl", "Oven", "Pressure Cooker",
    "Rice Cooker", "Rolling Pin", "Slow Cooker", "Spatula",
    "Spoon", "Stand Mixer", "Stovetop", "Toaster Oven",
    "Tongs", "Vegetable Peeler", "Whisk", "Wok",
])


def normalize(tool: str) -> str:
    key = tool.strip().lower()
    return SYNONYMS.get(key, tool.strip().title())


def missing_cookware(required: List[str], user_cookware: List[str] | None = None) -> List[str]:
    available = {normalize(i) for i in user_cookware} if user_cookware else DEFAULT_COOKWARE
    seen: set[str] = set()
    missing: list[str] = []
    for tool in required:
        n = normalize(tool)
        if n not in seen:
            seen.add(n)
            if n not in available:
                missing.append(n)
    return missing