"""JSON file persistence for the roster data.

The whole dataset lives in a single ``data.json`` file next to the ``app``
package. Every mutation loads the file, applies the change and writes it back
atomically, guarded by a process-wide lock so concurrent requests cannot lose
updates.
"""

import json
import os
import threading
from contextlib import contextmanager
from datetime import date, time
from pathlib import Path
from typing import Any, Iterator

from . import models

DATA_FILE = Path(__file__).resolve().parent.parent / "data.json"

_LOCK = threading.RLock()


def _empty_store() -> dict[str, Any]:
    return {
        "employees": [],
        "shifts": [],
        "assignments": [],
        # Monotonic id counters, so ids are never reused after a deletion.
        "next_ids": {"employee": 1, "shift": 1, "assignment": 1},
    }


def _read() -> dict[str, Any]:
    if not DATA_FILE.exists():
        return _empty_store()
    with DATA_FILE.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    store = _empty_store()
    store.update(data)
    return store


def _write(store: dict[str, Any]) -> None:
    tmp = DATA_FILE.with_name(DATA_FILE.name + ".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(store, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, DATA_FILE)


def read() -> dict[str, Any]:
    """Return the current store (read-only use)."""
    with _LOCK:
        return _read()


@contextmanager
def transaction() -> Iterator[dict[str, Any]]:
    """Yield the store and persist it after a successful mutation.

    If the body raises, nothing is written.
    """
    with _LOCK:
        store = _read()
        yield store
        _write(store)


def next_id(store: dict[str, Any], kind: str) -> int:
    value = int(store["next_ids"].get(kind, 1))
    store["next_ids"][kind] = value + 1
    return value


# --------------------------------------------------------------------------
# Row (dict) <-> model conversion
# --------------------------------------------------------------------------
def employee_to_dict(employee: models.Employee) -> dict[str, Any]:
    return {
        "id": employee.id,
        "name": employee.name,
        "email": employee.email,
        "role": employee.role.value,
        "is_active": employee.is_active,
    }


def employee_from_dict(row: dict[str, Any]) -> models.Employee:
    return models.Employee(
        id=row["id"],
        name=row["name"],
        email=row["email"],
        role=models.RoleEnum(row["role"]),
        is_active=bool(row["is_active"]),
    )


def shift_to_dict(shift: models.Shift) -> dict[str, Any]:
    return {
        "id": shift.id,
        "name": shift.name,
        "start_time": shift.start_time.isoformat(),
        "end_time": shift.end_time.isoformat(),
        "required_staff": shift.required_staff,
    }


def shift_from_dict(row: dict[str, Any]) -> models.Shift:
    return models.Shift(
        id=row["id"],
        name=row["name"],
        start_time=time.fromisoformat(row["start_time"]),
        end_time=time.fromisoformat(row["end_time"]),
        required_staff=row["required_staff"],
    )


def assignment_to_dict(assignment: models.Assignment) -> dict[str, Any]:
    return {
        "id": assignment.id,
        "employee_id": assignment.employee_id,
        "shift_id": assignment.shift_id,
        "date": assignment.date.isoformat(),
    }


def assignment_from_dict(row: dict[str, Any]) -> models.Assignment:
    return models.Assignment(
        id=row["id"],
        employee_id=row["employee_id"],
        shift_id=row["shift_id"],
        date=date.fromisoformat(row["date"]),
    )
