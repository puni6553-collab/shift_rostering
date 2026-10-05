from datetime import date, time
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, ConfigDict

from .models import RoleEnum


# ---------- Employee ----------
class EmployeeBase(BaseModel):
    name: str
    email: EmailStr
    role: RoleEnum = RoleEnum.staff
    is_active: bool = True


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[RoleEnum] = None
    is_active: Optional[bool] = None


class EmployeeOut(EmployeeBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Shift ----------
class ShiftBase(BaseModel):
    name: str
    start_time: time
    end_time: time
    required_staff: int = 1


class ShiftCreate(ShiftBase):
    pass


class ShiftUpdate(BaseModel):
    name: Optional[str] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    required_staff: Optional[int] = None


class ShiftOut(ShiftBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Assignment ----------
class AssignmentCreate(BaseModel):
    employee_id: int
    shift_id: int
    date: date


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    date: date
    employee: EmployeeOut
    shift: ShiftOut


class RosterDay(BaseModel):
    date: date
    assignments: list[AssignmentOut]


# ---------- Dashboard ----------
class EmployeeProgress(BaseModel):
    """How far one employee has progressed through the rostered shifts in a range."""

    model_config = ConfigDict(from_attributes=True)
    employee: EmployeeOut
    total_shifts: int
    past_shifts: int  # dates before today
    today_shifts: int
    future_shifts: int  # dates after today
    total_hours: float
    progress_pct: int  # share of scheduled hours already behind us
    status: Literal["complete", "on-track", "behind", "no-shifts"]


class DashboardTotals(BaseModel):
    employees: int
    active_employees: int
    shifts: int
    hours: float
    avg_progress_pct: int


class DashboardProgress(BaseModel):
    start_date: date
    end_date: date
    today: date
    totals: DashboardTotals
    employees: list[EmployeeProgress]
