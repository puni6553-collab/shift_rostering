from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import crud, models, schemas

app = FastAPI(
    title="Shift Rostering API",
    description="Manage employees, shift templates, and daily roster assignments.",
    version="1.0.0",
)

# The web UI can be opened directly from disk (file://) during development,
# so allow cross-origin calls to the local API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------
# Employees
# ---------------------------------------------------------------------
@app.post("/employees", response_model=schemas.EmployeeOut, tags=["Employees"])
def create_employee(employee: schemas.EmployeeCreate):
    try:
        return crud.create_employee(employee)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@app.get("/employees", response_model=list[schemas.EmployeeOut], tags=["Employees"])
def list_employees(skip: int = 0, limit: int = 100):
    return crud.list_employees(skip, limit)


@app.get("/employees/{employee_id}", response_model=schemas.EmployeeOut, tags=["Employees"])
def get_employee(employee_id: int):
    employee = crud.get_employee(employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    return employee


@app.patch("/employees/{employee_id}", response_model=schemas.EmployeeOut, tags=["Employees"])
def update_employee(employee_id: int, updates: schemas.EmployeeUpdate):
    try:
        employee = crud.update_employee(employee_id, updates)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    return employee


@app.delete("/employees/{employee_id}", status_code=204, tags=["Employees"])
def delete_employee(employee_id: int):
    if not crud.delete_employee(employee_id):
        raise HTTPException(status_code=404, detail="Employee not found")


# ---------------------------------------------------------------------
# Shifts
# ---------------------------------------------------------------------
@app.post("/shifts", response_model=schemas.ShiftOut, tags=["Shifts"])
def create_shift(shift: schemas.ShiftCreate):
    return crud.create_shift(shift)


@app.get("/shifts", response_model=list[schemas.ShiftOut], tags=["Shifts"])
def list_shifts(skip: int = 0, limit: int = 100):
    return crud.list_shifts(skip, limit)


@app.get("/shifts/{shift_id}", response_model=schemas.ShiftOut, tags=["Shifts"])
def get_shift(shift_id: int):
    shift = crud.get_shift(shift_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    return shift


@app.patch("/shifts/{shift_id}", response_model=schemas.ShiftOut, tags=["Shifts"])
def update_shift(shift_id: int, updates: schemas.ShiftUpdate):
    shift = crud.update_shift(shift_id, updates)
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    return shift


@app.delete("/shifts/{shift_id}", status_code=204, tags=["Shifts"])
def delete_shift(shift_id: int):
    if not crud.delete_shift(shift_id):
        raise HTTPException(status_code=404, detail="Shift not found")


# ---------------------------------------------------------------------
# Assignments / Roster
# ---------------------------------------------------------------------
@app.post("/assignments", response_model=schemas.AssignmentOut, tags=["Roster"])
def create_assignment(assignment: schemas.AssignmentCreate):
    try:
        return crud.create_assignment(assignment)
    except crud.RosterConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.delete("/assignments/{assignment_id}", status_code=204, tags=["Roster"])
def delete_assignment(assignment_id: int):
    if not crud.delete_assignment(assignment_id):
        raise HTTPException(status_code=404, detail="Assignment not found")


@app.get("/roster", response_model=list[schemas.AssignmentOut], tags=["Roster"])
def get_roster(
    start_date: date = Query(..., description="Roster range start (YYYY-MM-DD)"),
    end_date: date = Query(..., description="Roster range end (YYYY-MM-DD)"),
    employee_id: Optional[int] = Query(None, description="Filter by employee"),
):
    if end_date < start_date:
        raise HTTPException(status_code=400, detail="end_date must be >= start_date")
    return crud.get_roster(start_date, end_date, employee_id)


@app.get("/shifts/{shift_id}/coverage", tags=["Roster"])
def shift_coverage(shift_id: int, on_date: date):
    shift = crud.get_shift(shift_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    assigned = crud.get_shift_coverage(shift_id, on_date)
    return {
        "shift": shift.name,
        "date": on_date,
        "required_staff": shift.required_staff,
        "assigned_staff": assigned,
        "fully_staffed": assigned >= shift.required_staff,
    }


@app.get("/dashboard/progress", response_model=schemas.DashboardProgress, tags=["Dashboard"])
def get_dashboard_progress(
    start_date: date = Query(..., description="Range start (YYYY-MM-DD)"),
    end_date: date = Query(..., description="Range end (YYYY-MM-DD)"),
):
    """Manager view: how each employee is progressing through the rostered shifts."""
    if end_date < start_date:
        raise HTTPException(status_code=400, detail="end_date must be >= start_date")
    return crud.get_dashboard_progress(start_date, end_date)


@app.get("/health", tags=["Health"])
def root():
    return {"status": "ok", "docs": "/docs"}


# ---------------------------------------------------------------------------
# Web UI (static files). Mounted last so it never shadows the API routes.
# ---------------------------------------------------------------------------
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="ui")
