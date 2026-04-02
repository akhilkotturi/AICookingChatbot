import os
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.server_api import ServerApi

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        uri = os.getenv("MONGODB_URI")
        if not uri:
            raise RuntimeError("MONGODB_URI not set")
        _client = AsyncIOMotorClient(uri, server_api=ServerApi("1"))
    return _client


def get_db():
    return get_client()["mise"]


# ── Collection helpers ───────────────────────────────────────────────────────

def recipes_col():
    return get_db()["saved_recipes"]


def profiles_col():
    return get_db()["user_profiles"]


def plans_col():
    return get_db()["meal_plans"]