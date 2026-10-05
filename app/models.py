import enum
from dataclasses import dataclass, field
from datetime import date, time
from typing import Optional


class RoleEnum(str, enum.Enum):
    manager = "manager"
    staff = "staff"
    supervisor = "supervisor"


@dataclass
class Employee:
    id: int
    name: str
    email: str
    role: RoleEnum = RoleEnum.staff
    is_active: bool = True


@dataclass
class Shift:
    """A shift template, e.g. 'Morning' 09:00-17:00."""

    id: int
    name: str
    start_time: time
    end_time: time
    required_staff: int = 1


@dataclass
class Assignment:
    """An employee assigned to a specific shift on a specific date."""

    id: int
    employee_id: int
    shift_id: int
    date: date
    employee: Optional[Employee] = field(default=None, repr=False)
    shift: Optional[Shift] = field(default=None, repr=False)
