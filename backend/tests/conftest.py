import pytest
import os

# Set dummy env vars before any app imports happen
# This prevents "GROQ_API_KEY not set" errors during testing
os.environ.setdefault("GROQ_API_KEY", "test-key-not-real")
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017")
os.environ.setdefault("COHERE_API_KEY", "test-key-not-real")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-real")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-secret")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")


@pytest.fixture
def base_state():
    """
    A minimal valid LangGraph state dict.
    Used by node tests that need a starting state.
    """
    return {
        "query": "How do I make pasta carbonara?",
        "conversation_history": [],
        "user_cookware": ["Frying Pan", "Spatula", "Knife", "Cutting Board"],
        "scope": None,
        "question_type": None,
        "result": None,
        "is_recipe": None,
        "debug": False,
        "debug_trace": [],
        "cookware_in_use": None,
    }