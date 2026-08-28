from typing import Any


def object_id_to_str(v: Any) -> str:
    """Shared `id` coercion used by every model's `_id -> id` alias."""
    return str(v)
