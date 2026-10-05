# AGENTS.md

FastAPI shift-rostering API with a vanilla JS UI. Single package (`app/`), no test suite, no linter/typecheck config, no CI. The README is accurate and detailed — read it first; this file only covers what it doesn't.

## Running

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

A `venv/` already exists in the repo (includes `watchfiles`, so `--reload` works). On Windows use `venv\Scripts\python.exe -m uvicorn app.main:app --reload`.

## Verifying changes

There is no automated test/lint/typecheck step. Verify by starting the server and exercising the API via `/docs` (Swagger), the UI at `/`, or `curl`. When changing logic in `crud.py`, re-check the affected endpoints manually.

## Architecture

- `app/main.py` — FastAPI routes; `app/crud.py` — all business logic; `app/storage.py` — JSON persistence; `app/models.py` / `app/schemas.py` — dataclasses and Pydantic schemas.
- `static/` (index.html, styles.css, app.js) is mounted at `/` **last** so it never shadows API routes. CORS is intentionally `allow_origins=["*"]` because the UI can be opened via `file://` — don't tighten this without a replacement story.
- `data.json` at the repo root is the live database, created automatically on first run. All access goes through `app/storage.py` (process-wide lock + atomic write). It is single-process only — do not point multiple workers at it.

## Non-obvious behaviors

- **Cascade deletes**: `DELETE /employees/{id}` and `DELETE /shifts/{id}` also remove all their assignments. Not mentioned in the README.
- **409 conflicts**: duplicate email (case-insensitive) on employee create/update, and overlapping shift times for the same employee on the same day (`RosterConflictError` in `crud.py`).
- **Overnight shifts**: a shift with `end_time <= start_time` crosses midnight; hour math in `crud._shift_hours` (and the UI's `durationHours`) adds 24h. Overlap detection uses raw times, so it is same-day only.
- **Monotonic ids**: `next_ids` counters in `data.json` are never reset, so ids are not reused after deletion. Don't hand-edit `data.json` while the server is running — the lock is per-process.
- **Dashboard status thresholds** (`crud.get_dashboard_progress`): `complete` requires 100% progress *and* nothing left today or later; `on-track` if progress ≥ expected − 10pp; otherwise `behind`. The function takes an optional `today` arg for testing, but the API endpoint does not expose it.
- **Weeks start Monday** in the UI roster grid and navigation.

## Constraints

- No authentication — local/single-user use only. Do not expose beyond localhost without adding auth.
- Storage is a single JSON file by design; swapping in a real DB means replacing `app/storage.py` (see README "Notes / where to extend").
