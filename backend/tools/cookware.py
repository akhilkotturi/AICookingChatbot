from typing import Set, List;

COOKWARE: Set[str] = {
  "Spatula",
  "Frying Pan",
  "Little Pot",
  "Stovetop",
  "Whisk",
  "Knife",
  "Ladle",
  "Spoon"
}

# Words similar to what's in COOKWARE, in case they are used in recipe
SYNONYMS = {
    "wooden spatula": "Spatula",

    "skillet": "Frying Pan",
    "pan": "Frying Pan",
    "frying pan": "Frying Pan",

    "saucepan": "Little Pot",
    "pot": "Little Pot",
    "little pot": "Little Pot",

    "stove": "Stovetop",
    "stovetop": "Stovetop",

    "big spoon": "Ladle",

    "wooden spoon": "Spoon",
    "spoon": "Spoon",
}

def normalize(tool: str) -> str:
    t = tool.strip()
    key = t.lower()
    return SYNONYMS.get(key, t)

def missing_cookware(required: List[str]) -> List[str]:
    '''
    Returns list of cookware not in COOKWARE
    '''
    seen = set()
    missing = []

    for tool in required:
        normalized = normalize(tool)
        if normalized not in seen:
            seen.add(normalized)
            if normalized not in COOKWARE:
                missing.append(normalized)

    return missing