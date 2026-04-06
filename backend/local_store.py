import asyncio
import json
import os
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

_STORE_LOCK = asyncio.Lock()


def _store_path() -> Path:
    raw = os.getenv("LOCAL_STORE_PATH", "")
    if raw.strip():
        return Path(raw).expanduser().resolve()
    return (Path(__file__).resolve().parent / "data" / "local_store.json")


def _ensure_store() -> Path:
    path = _store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(json.dumps({"profiles": {}, "recipes": {}}, ensure_ascii=True, indent=2), encoding="utf-8")
    return path


def _read_store_sync() -> dict[str, Any]:
    path = _ensure_store()
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        data = {"profiles": {}, "recipes": {}}
        path.write_text(json.dumps(data, ensure_ascii=True, indent=2), encoding="utf-8")
        return data


def _write_store_sync(data: dict[str, Any]) -> None:
    path = _ensure_store()
    path.write_text(json.dumps(data, ensure_ascii=True, indent=2), encoding="utf-8")


async def get_profile(user_id: str) -> dict[str, Any] | None:
    async with _STORE_LOCK:
        data = _read_store_sync()
        profile = data.get("profiles", {}).get(user_id)
        return deepcopy(profile) if profile else None


async def set_profile_cookware(user_id: str, cookware: list[str]) -> None:
    async with _STORE_LOCK:
        data = _read_store_sync()
        profiles = data.setdefault("profiles", {})
        existing = profiles.get(user_id, {})
        existing["cookware"] = list(cookware)
        profiles[user_id] = existing
        _write_store_sync(data)


async def list_recipes(user_id: str, limit: int = 100) -> list[dict[str, Any]]:
    async with _STORE_LOCK:
        data = _read_store_sync()
        items = data.get("recipes", {}).get(user_id, [])
        sorted_items = sorted(items, key=lambda x: x.get("created_at", ""), reverse=True)
        return deepcopy(sorted_items[:limit])


async def save_recipe(user_id: str, doc: dict[str, Any]) -> str:
    async with _STORE_LOCK:
        data = _read_store_sync()
        recipes = data.setdefault("recipes", {})
        user_items = recipes.setdefault(user_id, [])

        recipe_id = str(uuid4())
        created_at = datetime.now(timezone.utc).isoformat()
        record = {**doc, "id": recipe_id, "user_id": user_id, "created_at": created_at}
        user_items.insert(0, record)

        _write_store_sync(data)
        return recipe_id


async def delete_recipe(user_id: str, recipe_id: str) -> bool:
    async with _STORE_LOCK:
        data = _read_store_sync()
        recipes = data.setdefault("recipes", {})
        user_items = recipes.get(user_id, [])
        next_items = [item for item in user_items if str(item.get("id")) != recipe_id]
        deleted = len(next_items) != len(user_items)
        recipes[user_id] = next_items
        _write_store_sync(data)
        return deleted
