import os
import certifi
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.server_api import ServerApi

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        uri = os.getenv("MONGODB_URI")
        if not uri:
            raise RuntimeError("MONGODB_URI not set")
        server_selection_timeout_ms = int(os.getenv("MONGO_SERVER_SELECTION_TIMEOUT_MS", "4000"))
        connect_timeout_ms = int(os.getenv("MONGO_CONNECT_TIMEOUT_MS", "3000"))
        socket_timeout_ms = int(os.getenv("MONGO_SOCKET_TIMEOUT_MS", "5000"))

        _client = AsyncIOMotorClient(
            uri,
            server_api=ServerApi("1"),
            tlsCAFile=certifi.where(),
            serverSelectionTimeoutMS=server_selection_timeout_ms,
            connectTimeoutMS=connect_timeout_ms,
            socketTimeoutMS=socket_timeout_ms,
        )
    return _client


def get_db():
    return get_client()["mise"]


async def ping_db() -> bool:
    await get_client().admin.command("ping")
    return True


# ── Collection helpers ───────────────────────────────────────────────────────

def recipes_col():
    return get_db()["saved_recipes"]


def profiles_col():
    return get_db()["user_profiles"]


def plans_col():
    return get_db()["meal_plans"]