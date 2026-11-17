from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import date, datetime, time
from enum import Enum
from typing import Any

from sqlalchemy.orm import Session

from app.models import ActivityLog, User

SECRET_FIELDS = frozenset({"password", "password_hash"})


def _plain(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    return value


def snapshot(obj: object, fields: Iterable[str]) -> dict[str, Any]:
    return {f: _plain(getattr(obj, f)) for f in fields if f not in SECRET_FIELDS}


def diff(before: Mapping[str, Any], after: Mapping[str, Any]) -> dict[str, list[Any]]:
    return {
        k: [_plain(before.get(k)), _plain(after.get(k))]
        for k in after
        if k not in SECRET_FIELDS and _plain(before.get(k)) != _plain(after.get(k))
    }


def log_activity(
    db: Session,
    user: User | None,
    action: str,
    summary: str,
    *,
    entity_type: str | None = None,
    entity_id: object = None,
    changes: Mapping[str, Any] | None = None,
) -> ActivityLog:
    entry = ActivityLog(
        user_id=user.id if user else None,
        action=action,
        entity_type=entity_type or action.split(".", 1)[0],
        entity_id=None if entity_id is None else str(entity_id),
        summary=summary[:255],
        changes=dict(changes) if changes else None,
    )
    db.add(entry)
    return entry
