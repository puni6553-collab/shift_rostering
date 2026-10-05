from datetime import date as date_type
from typing import Any, Optional

from . import models, storage, schemas


# ---------- Employee ----------
def create_employee(employee: schemas.EmployeeCreate) -> models.Employee:
    with storage.transaction() as store:
        if _email_taken(store, employee.email):
            raise ValueError(f"Email '{employee.email}' is already registered")
        row = employee.model_dump()
        new = models.Employee(
            id=storage.next_id(store, "employee"),
            name=row["name"],
            email=row["email"],
            role=row["role"],
            is_active=row["is_active"],
        )
        store["employees"].append(storage.employee_to_dict(new))
        return new


def get_employee(employee_id: int) -> Optional[models.Employee]:
    row = _find_employee_row(storage.read(), employee_id)
    return storage.employee_from_dict(row) if row else None


def list_employees(skip: int = 0, limit: int = 100) -> list[models.Employee]:
    rows = sorted(storage.read()["employees"], key=lambda r: r["id"])
    return [storage.employee_from_dict(r) for r in rows[skip : skip + limit]]


def update_employee(
    employee_id: int, updates: schemas.EmployeeUpdate
) -> Optional[models.Employee]:
    with storage.transaction() as store:
        row = _find_employee_row(store, employee_id)
        if not row:
            return None
        changes = updates.model_dump(exclude_unset=True)
        if "email" in changes and _email_taken(store, changes["email"], exclude_id=employee_id):
            raise ValueError(f"Email '{changes['email']}' is already registered")
        row.update(changes)
        return storage.employee_from_dict(row)


def delete_employee(employee_id: int) -> bool:
    with storage.transaction() as store:
        row = _find_employee_row(store, employee_id)
        if not row:
            return False
        store["employees"].remove(row)
        # Cascade: an employee's assignments go with them.
        store["assignments"] = [
            a for a in store["assignments"] if a["employee_id"] != employee_id
        ]
        return True


def _email_taken(
    store: dict[str, Any], email: str, exclude_id: Optional[int] = None
) -> bool:
    email = email.lower()
    return any(
        r["email"].lower() == email and r["id"] != exclude_id
        for r in store["employees"]
    )


def _find_employee_row(store: dict[str, Any], employee_id: int) -> Optional[dict[str, Any]]:
    return next((r for r in store["employees"] if r["id"] == employee_id), None)


# ---------- Shift ----------
def create_shift(shift: schemas.ShiftCreate) -> models.Shift:
    with storage.transaction() as store:
        row = shift.model_dump()
        new = models.Shift(
            id=storage.next_id(store, "shift"),
            name=row["name"],
            start_time=row["start_time"],
            end_time=row["end_time"],
            required_staff=row["required_staff"],
        )
        store["shifts"].append(storage.shift_to_dict(new))
        return new


def get_shift(shift_id: int) -> Optional[models.Shift]:
    row = _find_shift_row(storage.read(), shift_id)
    return storage.shift_from_dict(row) if row else None


def list_shifts(skip: int = 0, limit: int = 100) -> list[models.Shift]:
    rows = sorted(storage.read()["shifts"], key=lambda r: r["id"])
    return [storage.shift_from_dict(r) for r in rows[skip : skip + limit]]


def update_shift(
    shift_id: int, updates: schemas.ShiftUpdate
) -> Optional[models.Shift]:
    with storage.transaction() as store:
        row = _find_shift_row(store, shift_id)
        if not row:
            return None
        changes = updates.model_dump(exclude_unset=True)
        if "start_time" in changes:
            changes["start_time"] = changes["start_time"].isoformat()
        if "end_time" in changes:
            changes["end_time"] = changes["end_time"].isoformat()
        row.update(changes)
        return storage.shift_from_dict(row)


def delete_shift(shift_id: int) -> bool:
    with storage.transaction() as store:
        row = _find_shift_row(store, shift_id)
        if not row:
            return False
        store["shifts"].remove(row)
        # Cascade: assignments to this shift go with it.
        store["assignments"] = [
            a for a in store["assignments"] if a["shift_id"] != shift_id
        ]
        return True


def _find_shift_row(store: dict[str, Any], shift_id: int) -> Optional[dict[str, Any]]:
    return next((r for r in store["shifts"] if r["id"] == shift_id), None)


# ---------- Assignment / Roster ----------
class RosterConflictError(Exception):
    """Raised when an assignment would double-book an employee."""


def _shifts_overlap(a: models.Shift, b: models.Shift) -> bool:
    return a.start_time < b.end_time and b.start_time < a.end_time


def create_assignment(assignment: schemas.AssignmentCreate) -> models.Assignment:
    with storage.transaction() as store:
        employee_row = _find_employee_row(store, assignment.employee_id)
        if not employee_row:
            raise ValueError("Employee not found")
        shift_row = _find_shift_row(store, assignment.shift_id)
        if not shift_row:
            raise ValueError("Shift not found")

        employee = storage.employee_from_dict(employee_row)
        shift = storage.shift_from_dict(shift_row)
        day = assignment.date.isoformat()

        # Check for overlapping shifts already assigned to this employee on this date
        for existing_row in store["assignments"]:
            if (
                existing_row["employee_id"] != assignment.employee_id
                or existing_row["date"] != day
            ):
                continue
            existing_shift = _find_shift_row(store, existing_row["shift_id"])
            if existing_shift and _shifts_overlap(
                storage.shift_from_dict(existing_shift), shift
            ):
                raise RosterConflictError(
                    f"{employee.name} is already assigned to "
                    f"'{existing_shift['name']}' on {assignment.date}, "
                    f"which overlaps with '{shift.name}'."
                )

        new = models.Assignment(
            id=storage.next_id(store, "assignment"),
            employee_id=assignment.employee_id,
            shift_id=assignment.shift_id,
            date=assignment.date,
            employee=employee,
            shift=shift,
        )
        store["assignments"].append(storage.assignment_to_dict(new))
        return new


def get_assignment(assignment_id: int) -> Optional[models.Assignment]:
    store = storage.read()
    row = next((r for r in store["assignments"] if r["id"] == assignment_id), None)
    return _hydrate(store, row) if row else None


def delete_assignment(assignment_id: int) -> bool:
    with storage.transaction() as store:
        row = next((r for r in store["assignments"] if r["id"] == assignment_id), None)
        if not row:
            return False
        store["assignments"].remove(row)
        return True


def get_roster(
    start_date: date_type,
    end_date: date_type,
    employee_id: Optional[int] = None,
) -> list[models.Assignment]:
    store = storage.read()
    rows = [
        r
        for r in store["assignments"]
        if start_date.isoformat() <= r["date"] <= end_date.isoformat()
        and (employee_id is None or r["employee_id"] == employee_id)
    ]
    rows.sort(key=lambda r: (r["date"], r["id"]))
    return [_hydrate(store, r) for r in rows]


def get_shift_coverage(shift_id: int, on_date: date_type) -> int:
    """Number of employees currently assigned to a shift on a date."""
    day = on_date.isoformat()
    return sum(
        1
        for r in storage.read()["assignments"]
        if r["shift_id"] == shift_id and r["date"] == day
    )


def _hydrate(store: dict[str, Any], row: dict[str, Any]) -> models.Assignment:
    assignment = storage.assignment_from_dict(row)
    employee_row = _find_employee_row(store, row["employee_id"])
    shift_row = _find_shift_row(store, row["shift_id"])
    if employee_row:
        assignment.employee = storage.employee_from_dict(employee_row)
    if shift_row:
        assignment.shift = storage.shift_from_dict(shift_row)
    return assignment


# ---------- Dashboard ----------
def _shift_hours(shift: models.Shift) -> float:
    """Shift length in hours, handling overnight shifts."""
    start = shift.start_time.hour * 60 + shift.start_time.minute
    end = shift.end_time.hour * 60 + shift.end_time.minute
    minutes = end - start
    if minutes <= 0:
        minutes += 24 * 60
    return minutes / 60


def get_dashboard_progress(
    start_date: date_type,
    end_date: date_type,
    today: Optional[date_type] = None,
) -> schemas.DashboardProgress:
    """Per-employee roster progress for a date range, for a manager review.

    Progress is the share of the employee's scheduled hours in the range that
    fall on dates up to and including ``today``. Status compares that with how
    much of the range has elapsed: everyone should be around ``expected``.
    An employee is only 'complete' once nothing is left today or later.
    """
    store = storage.read()
    today = today or date_type.today()
    start_iso, end_iso, today_iso = (
        start_date.isoformat(),
        end_date.isoformat(),
        today.isoformat(),
    )

    rows = [
        r for r in store["assignments"] if start_iso <= r["date"] <= end_iso
    ]
    shift_rows = {s["id"]: s for s in store["shifts"]}

    employees = [
        storage.employee_from_dict(r)
        for r in sorted(store["employees"], key=lambda r: r["id"])
    ]

    days = (end_date - start_date).days + 1
    elapsed = min(max((today - start_date).days + 1, 0), days)
    expected = (elapsed / days) * 100 if days else 100

    progress: list[schemas.EmployeeProgress] = []
    for employee in employees:
        past = on_today = future = 0
        total_hours = progress_hours = 0.0

        for row in rows:
            if row["employee_id"] != employee.id:
                continue
            shift_row = shift_rows.get(row["shift_id"])
            if not shift_row:
                continue  # shift deleted (assignments cascade, but stay safe)
            hours = _shift_hours(storage.shift_from_dict(shift_row))
            total_hours += hours
            if row["date"] < today_iso:
                past += 1
            elif row["date"] == today_iso:
                on_today += 1
            else:
                future += 1
            if row["date"] <= today_iso:
                progress_hours += hours

        total = past + on_today + future
        pct = (
            min(round(progress_hours / total_hours * 100), 100)
            if total_hours
            else 0
        )
        if total == 0:
            status: str = "no-shifts"
        elif pct >= 100 and on_today == 0 and future == 0:
            # only truly finished when nothing is left today or later
            status = "complete"
        else:
            status = "on-track" if pct >= expected - 10 else "behind"

        progress.append(
            schemas.EmployeeProgress(
                employee=schemas.EmployeeOut.model_validate(employee),
                total_shifts=total,
                past_shifts=past,
                today_shifts=on_today,
                future_shifts=future,
                total_hours=round(total_hours, 2),
                progress_pct=pct,
                status=status,  # type: ignore[arg-type]
            )
        )

    rostered = [p for p in progress if p.total_shifts]
    totals = schemas.DashboardTotals(
        employees=len(employees),
        active_employees=sum(1 for e in employees if e.is_active),
        shifts=sum(p.total_shifts for p in progress),
        hours=round(sum(p.total_hours for p in progress), 2),
        avg_progress_pct=(
            round(sum(p.progress_pct for p in rostered) / len(rostered))
            if rostered
            else 0
        ),
    )

    return schemas.DashboardProgress(
        start_date=start_date,
        end_date=end_date,
        today=today,
        totals=totals,
        employees=progress,
    )
