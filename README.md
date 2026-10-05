# Shift Rostering API

A FastAPI backend for managing employees, shift templates, and daily roster assignments — with built-in conflict detection so no one gets double-booked into overlapping shifts. Ships with a vanilla HTML/CSS/JS web UI served straight from the app.

## Setup

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Then open:

- **http://127.0.0.1:8000/** — the web UI (dashboard, roster, employees, shifts)
- **http://127.0.0.1:8000/docs** — interactive Swagger docs
- **http://127.0.0.1:8000/health** — API health check

Data is stored in a local JSON file (`data.json`) next to the `app/` package, created automatically on first run. All reads and writes go through `app/storage.py`, which serializes access with a lock and writes the file atomically.

## Web UI

Static files live in `static/` and are mounted at `/` in `app/main.py`:

| File | Purpose |
|---|---|
| `static/index.html` | Page structure: tabs, roster grid, modals, forms |
| `static/styles.css` | All styling (design tokens, grid, cards, modals, toasts, responsive rules) |
| `static/app.js` | Talks to the API: loads data, renders the roster, handles CRUD + toasts |

Features:

- **Dashboard tab** (default view) — the manager's overview of employee progress: KPI cards (active employees, shifts/hours scheduled, average progress) and a per-employee table with a progress bar, past/today/upcoming shift counts, and a status badge (Complete / On track / Behind / No shifts). Navigate by week or month with the prev/today/next controls. Progress is derived from the roster — it's the share of each employee's scheduled hours that falls on dates up to and including today, compared against how much of the period has elapsed.
- **Roster tab** — a Monday–Sunday grid of employees × days, with prev/next/Today navigation, an employee filter, clickable cells to assign a shift, click a chip to remove it, plus a per-day coverage panel (assigned vs. required staff).
- **Employees tab** — table with add / edit (including active toggle) / delete.
- **Shifts tab** — shift template cards with duration, required staff, add / edit / delete.
- API errors (e.g. the 409 overlap conflict) are surfaced as toast messages.

## Data model

- **Employee** — name, email, role (`manager` / `supervisor` / `staff`), active flag.
- **Shift** — a reusable template, e.g. "Morning" 09:00–17:00, with `required_staff`.
- **Assignment** — links one employee to one shift on one date.

## Key endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/employees` | Add an employee |
| GET | `/employees` | List employees |
| POST | `/shifts` | Define a shift template |
| GET | `/shifts` | List shift templates |
| POST | `/assignments` | Assign an employee to a shift on a date (409 if it overlaps an existing assignment for that employee) |
| DELETE | `/assignments/{id}` | Remove an assignment |
| GET | `/roster?start_date=...&end_date=...&employee_id=...` | View the roster for a date range, optionally filtered by employee |
| GET | `/dashboard/progress?start_date=...&end_date=...` | Manager dashboard: per-employee progress, shift/hour totals and status for a date range |
| GET | `/shifts/{id}/coverage?on_date=...` | Check how many staff are assigned vs. required for a shift on a date |

## Example flow

```bash
# 1. Add an employee
curl -X POST localhost:8000/employees -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","role":"staff"}'

# 2. Define a shift
curl -X POST localhost:8000/shifts -H "Content-Type: application/json" \
  -d '{"name":"Morning","start_time":"09:00:00","end_time":"17:00:00","required_staff":2}'

# 3. Assign Alice to it on a date
curl -X POST localhost:8000/assignments -H "Content-Type: application/json" \
  -d '{"employee_id":1,"shift_id":1,"date":"2026-09-24"}'

# 4. View the roster
curl "localhost:8000/roster?start_date=2026-09-24&end_date=2026-09-30"
```

## Notes / where to extend

- Conflict detection currently blocks **overlapping shift times** for the same employee on the same day — it doesn't yet enforce things like max hours/week, minimum rest between shifts, or skill/role matching. Those are natural next additions in `crud.py`.
- Storage is a single JSON file, which suits a single-process local deployment. For production (multiple workers, concurrent writers), swap `app/storage.py` for a real database such as Postgres/MySQL.
- Add authentication (e.g. `fastapi-users` or OAuth2) before exposing this beyond local use.
