/* Shift Roster — front-end logic (vanilla JS, talks to the FastAPI backend) */

"use strict";

/* ------------------------------- helpers ------------------------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

const parseISO = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const startOfWeek = (d) => {
  const x = new Date(d);
  const offset = (x.getDay() + 6) % 7; // weeks start on Monday
  x.setDate(x.getDate() - offset);
  x.setHours(0, 0, 0, 0);
  return x;
};

const sameDay = (a, b) => iso(a) === iso(b);

/** "09:00:00" -> "09:00" */
const hhmm = (t) => String(t).slice(0, 5);

const minutesOf = (t) => {
  const [h, m] = String(t).slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};

/** Shift length in hours, handling overnight shifts. */
const durationHours = (start, end) => {
  let mins = minutesOf(end) - minutesOf(start);
  if (mins <= 0) mins += 24 * 60;
  return mins / 60;
};

const initials = (name) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || "")
    .join("")
    .toUpperCase();

const TODAY = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const shiftHue = (shiftId) => `chip-h${shiftId % 6}`;

/* -------------------------------- state -------------------------------- */

const state = {
  employees: [],
  shifts: [],
  roster: [],
  rangeStart: startOfWeek(TODAY),
  days: 7,
  employeeFilter: "",
  // Dashboard (manager view)
  dashPeriod: "week",
  dashStart: startOfWeek(TODAY),
  dashboard: null,
};

/* ------------------------------- transport ----------------------------- */

async function api(path, options = {}) {
  const opts = { ...options };
  opts.headers = { ...(options.headers || {}) };
  if (opts.body) opts.headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    setStatus(false);
    throw new Error("Cannot reach the API — is uvicorn running on :8000?");
  }
  setStatus(true);

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      /* keep raw */
    }
  }

  if (!res.ok) {
    const detail = data && data.detail;
    throw new Error(
      typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : `Request failed (${res.status})`
    );
  }
  return data;
}

function setStatus(online) {
  $("#status-dot").className = `status-dot ${online ? "is-online" : "is-offline"}`;
  $("#status-text").textContent = online ? "API connected" : "API offline";
}

/* -------------------------------- toasts ------------------------------- */

function toast(message, kind = "error") {
  const el = document.createElement("div");
  el.className = `toast is-${kind}`;
  el.innerHTML = `<span class="toast-icon">${kind === "success" ? "✓" : "!"}</span><span>${esc(message)}</span>`;
  $("#toasts").appendChild(el);
  setTimeout(() => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 300);
  }, 4200);
}

/* -------------------------------- modals ------------------------------- */

let lastFocused = null;

function openModal(id, onOpen) {
  const backdrop = $(`#${id}`);
  lastFocused = document.activeElement;
  backdrop.hidden = false;
  if (onOpen) onOpen(backdrop);
  const first = backdrop.querySelector("input:not([type=hidden]), select");
  if (first) first.focus();
}

function closeModal(backdrop) {
  backdrop.hidden = true;
  if (lastFocused) lastFocused.focus();
}

document.addEventListener("click", (e) => {
  const closeBtn = e.target.closest("[data-close]");
  if (closeBtn) {
    const backdrop = closeBtn.closest(".backdrop");
    if (backdrop) closeModal(backdrop);
    return;
  }
  if (e.target.classList.contains("backdrop")) closeModal(e.target);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const open = $$(".backdrop").find((b) => !b.hidden);
    if (open) closeModal(open);
  }
});

/* -------------------------------- views -------------------------------- */

function activateView(name) {
  const target = $(`#view-${name}`) ? name : "roster";
  $$(".tab").forEach((t) => {
    const on = t.dataset.view === target;
    t.classList.toggle("is-active", on);
    t.setAttribute("aria-selected", String(on));
  });
  $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === `view-${target}`));
  if (target === "dashboard") loadDashboard().catch((err) => toast(err.message));
}

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    history.replaceState(null, "", `#${tab.dataset.view}`);
    activateView(tab.dataset.view);
  });
});

window.addEventListener("hashchange", () => activateView(location.hash.slice(1)));
if (location.hash) activateView(location.hash.slice(1));

/* ------------------------------- loading ------------------------------- */

async function loadEmployees() {
  state.employees = await api("/employees");
  renderEmployees();
  renderRoster();
}

async function loadShifts() {
  state.shifts = await api("/shifts");
  renderShifts();
  renderAssignOptions();
}

async function loadRoster() {
  const start = iso(state.rangeStart);
  const end = iso(addDays(state.rangeStart, state.days - 1));
  const qs = new URLSearchParams({ start_date: start, end_date: end });
  if (state.employeeFilter) qs.set("employee_id", state.employeeFilter);
  state.roster = await api(`/roster?${qs}`);
  renderRoster();
}

async function refresh() {
  try {
    await Promise.all([loadEmployees(), loadShifts(), loadRoster(), loadDashboard()]);
  } catch (err) {
    toast(err.message);
  }
}

/* ----------------------------- dashboard view -------------------------- */

/** The selected dashboard period as a {start, end} date range. */
function dashRange() {
  const anchor = state.dashStart;
  if (state.dashPeriod === "month") {
    return {
      start: new Date(anchor.getFullYear(), anchor.getMonth(), 1),
      end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0),
    };
  }
  const start = startOfWeek(anchor);
  return { start, end: addDays(start, 6) };
}

function moveDash(dir) {
  const a = state.dashStart;
  state.dashStart =
    state.dashPeriod === "month"
      ? new Date(a.getFullYear(), a.getMonth() + dir, 1)
      : addDays(a, dir * 7);
  loadDashboard().catch((e) => toast(e.message));
}

$("#dash-prev").addEventListener("click", () => moveDash(-1));
$("#dash-next").addEventListener("click", () => moveDash(1));

$("#dash-today").addEventListener("click", () => {
  state.dashStart = state.dashPeriod === "month" ? TODAY : startOfWeek(TODAY);
  loadDashboard().catch((e) => toast(e.message));
});

$("#dash-period").addEventListener("change", (e) => {
  state.dashPeriod = e.target.value;
  state.dashStart =
    state.dashPeriod === "month" ? TODAY : startOfWeek(TODAY);
  loadDashboard().catch((e) => toast(e.message));
});

async function loadDashboard() {
  const { start, end } = dashRange();
  const qs = new URLSearchParams({ start_date: iso(start), end_date: iso(end) });
  state.dashboard = await api(`/dashboard/progress?${qs}`);
  renderDashboard();
}

const fmtHours = (h) => (h % 1 === 0 ? h : h.toFixed(1));

const DASH_STATUS = {
  complete: { label: "Complete", cls: "badge--complete" },
  "on-track": { label: "On track", cls: "badge--on-track" },
  behind: { label: "Behind", cls: "badge--behind" },
  "no-shifts": { label: "No shifts", cls: "badge--no-shifts" },
};

function renderDashboard() {
  const data = state.dashboard;
  if (!data) return;

  const { start, end } = dashRange();
  $("#dash-range-label").textContent = formatRange(start, end);

  // --- KPI cards
  const t = data.totals;
  const list = data.employees;
  const past = list.reduce((n, p) => n + p.past_shifts, 0);
  const onToday = list.reduce((n, p) => n + p.today_shifts, 0);
  const future = list.reduce((n, p) => n + p.future_shifts, 0);
  const rostered = list.filter((p) => p.total_shifts > 0).length;

  $("#kpi-employees").textContent = t.active_employees;
  $("#kpi-employees-sub").textContent = `${t.active_employees} active / ${t.employees} total`;
  $("#kpi-shifts").textContent = t.shifts;
  $("#kpi-shifts-sub").textContent = `${past} done · ${onToday} today · ${future} upcoming`;
  $("#kpi-hours").textContent = fmtHours(t.hours);
  $("#kpi-hours-sub").textContent = `${rostered} employee${rostered === 1 ? "" : "s"} rostered`;
  $("#kpi-progress").textContent = `${t.avg_progress_pct}%`;
  $("#kpi-progress-bar").style.width = `${t.avg_progress_pct}%`;
  $("#kpi-progress-sub").textContent = rostered
    ? `average across ${rostered} rostered employee${rostered === 1 ? "" : "s"}`
    : "nobody rostered in this period";

  // --- progress table (most progressed first, unrostered last)
  const rank = (p) => (p.status === "no-shifts" ? 1 : 0);
  const rows = [...list].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      b.progress_pct - a.progress_pct ||
      a.employee.name.localeCompare(b.employee.name)
  );

  $("#progress-empty").hidden = rows.length > 0;
  $("#progress-table").style.display = rows.length ? "" : "none";

  $("#progress-body").innerHTML = rows
    .map((p) => {
      const emp = p.employee;
      const status = DASH_STATUS[p.status];
      const fill =
        p.status === "complete" ? "" : p.status === "behind" ? "is-short" : "bar-fill--accent";
      return `
      <tr class="${emp.is_active ? "" : "is-inactive"}">
        <td>
          <div class="cell-person">
            <span class="avatar ${emp.is_active ? "" : "is-inactive"}">${esc(initials(emp.name))}</span>
            <span class="emp-meta">
              <span class="emp-name">${esc(emp.name)}</span>
              <span class="emp-sub">${esc(emp.role)}${emp.is_active ? "" : " · inactive"}</span>
            </span>
          </div>
        </td>
        <td>
          <div class="progress-cell">
            <div class="progress-top">
              <span class="progress-pct">${p.progress_pct}%</span>
              <span class="progress-hours">${fmtHours(p.total_hours)}h scheduled</span>
            </div>
            <div class="bar bar--lg"><div class="bar-fill ${fill}" style="width:${p.progress_pct}%"></div></div>
          </div>
        </td>
        <td class="col-email">
          <div class="shift-counts">
            <span class="count-pill is-done">${p.past_shifts} done</span>
            <span class="count-pill is-today">${p.today_shifts} today</span>
            <span class="count-pill">${p.future_shifts} upcoming</span>
          </div>
        </td>
        <td><span class="badge ${status.cls}">${status.label}</span></td>
      </tr>`;
    })
    .join("");
}

/* ------------------------------ roster view ---------------------------- */

$("#prev-range").addEventListener("click", () => {
  state.rangeStart = addDays(state.rangeStart, -state.days);
  loadRoster().catch((e) => toast(e.message));
});

$("#next-range").addEventListener("click", () => {
  state.rangeStart = addDays(state.rangeStart, state.days);
  loadRoster().catch((e) => toast(e.message));
});

$("#today-btn").addEventListener("click", () => {
  state.rangeStart = startOfWeek(TODAY);
  loadRoster().catch((e) => toast(e.message));
});

$("#employee-filter").addEventListener("change", (e) => {
  state.employeeFilter = e.target.value;
  loadRoster().catch((err) => toast(err.message));
});

function rangeDays() {
  return Array.from({ length: state.days }, (_, i) => addDays(state.rangeStart, i));
}

/** "23 – 29 Sep 2026", folding month/year in only when the range crosses them. */
function formatRange(first, last) {
  return first.getMonth() === last.getMonth()
    ? `${first.getDate()} – ${last.getDate()} ${MONTH_NAMES[last.getMonth()]} ${last.getFullYear()}`
    : `${first.getDate()} ${MONTH_NAMES[first.getMonth()]} – ${last.getDate()} ${MONTH_NAMES[last.getMonth()]} ${last.getFullYear()}`;
}

function renderRangeLabel() {
  const days = rangeDays();
  $("#range-label").textContent = formatRange(days[0], days[days.length - 1]);
}

function renderEmployees() {
  const list = state.employees;
  $("#employees-count").textContent = list.length;

  // filter dropdown
  const filter = $("#employee-filter");
  const current = state.employeeFilter;
  filter.innerHTML =
    `<option value="">All employees</option>` +
    list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("");
  filter.value = current;
  if (filter.value !== current) {
    state.employeeFilter = "";
    filter.value = "";
  }

  // table
  const body = $("#employees-body");
  $("#employees-empty").hidden = list.length > 0;
  $("#employees-table").style.display = list.length ? "" : "none";

  body.innerHTML = list
    .map(
      (e) => `
      <tr class="${e.is_active ? "" : "is-inactive"}">
        <td>
          <div class="cell-person">
            <span class="avatar ${e.is_active ? "" : "is-inactive"}">${esc(initials(e.name))}</span>
            <span class="emp-name">${esc(e.name)}</span>
          </div>
        </td>
        <td class="col-email"><span style="color:var(--text-soft)">${esc(e.email)}</span></td>
        <td><span class="badge badge--${e.role}">${esc(e.role)}</span></td>
        <td><span class="badge ${e.is_active ? "badge--on" : "badge--off"}">${e.is_active ? "Active" : "Inactive"}</span></td>
        <td class="col-actions">
          <div class="row-actions">
            <button class="btn btn-ghost is-inactive-btn" data-edit-employee="${e.id}">Edit</button>
            <button class="btn btn-danger-ghost is-inactive-btn" data-delete-employee="${e.id}">Delete</button>
          </div>
        </td>
      </tr>`
    )
    .join("");

  renderAssignOptions();
}

function renderRoster() {
  renderRangeLabel();

  const days = rangeDays();
  const todayISO = iso(TODAY);

  // --- header row
  $("#roster-head").innerHTML = `
    <tr>
      <th class="col-emp">Employee</th>
      ${days
        .map((d) => {
          const isToday = iso(d) === todayISO;
          const dow = DAY_NAMES[(d.getDay() + 6) % 7];
          return `<th class="${isToday ? "is-today" : ""}">
            <span class="day-head"><span class="dow">${dow}</span><span class="dnum">${d.getDate()}</span></span>
          </th>`;
        })
        .join("")}
    </tr>`;

  // --- assignments keyed by employee|date
  const byKey = {};
  state.roster.forEach((a) => {
    const key = `${a.employee.id}|${a.date}`;
    (byKey[key] = byKey[key] || []).push(a);
  });

  // --- body rows (respect the employee filter)
  const employees = state.employees.filter(
    (e) => !state.employeeFilter || String(e.id) === state.employeeFilter
  );

  if (!employees.length) {
    const colspan = state.days + 1;
    $("#roster-body").innerHTML = `
      <tr><td class="roster-empty" colspan="${colspan}">
        ${
          state.employees.length
            ? "No employee matches the current filter."
            : `No employees yet — add your first one to start rostering.<br>
               <button class="btn btn-primary" id="roster-add-employee">+ Add employee</button>`
        }
      </td></tr>`;
    renderCoverage();
    return;
  }

  $("#roster-body").innerHTML = employees
    .map((emp) => {
      const cells = days
        .map((d) => {
          const key = `${emp.id}|${iso(d)}`;
          const items = byKey[key] || [];
          const isToday = iso(d) === todayISO;
          const chips = items
            .map(
              (a) => `
              <button class="chip ${shiftHue(a.shift.id)}" data-assignment="${a.id}"
                      title="Remove ${esc(a.shift.name)} for ${esc(emp.name)} on ${esc(a.date)}">
                <span class="chip-name">${esc(a.shift.name)}</span>
                <span class="chip-time">${hhmm(a.shift.start_time)}–${hhmm(a.shift.end_time)}</span>
              </button>`
            )
            .join("");
          return `<td class="cell ${isToday ? "is-today" : ""}" data-employee="${emp.id}" data-date="${iso(d)}">
            <div class="cell-stack">${chips}<div class="cell-plus">+</div></div>
          </td>`;
        })
        .join("");

      return `<tr class="${emp.is_active ? "" : "is-inactive"}">
        <td class="col-emp">
          <div class="emp-cell">
            <span class="avatar ${emp.is_active ? "" : "is-inactive"}">${esc(initials(emp.name))}</span>
            <span class="emp-meta">
              <span class="emp-name">${esc(emp.name)}</span>
              <span class="emp-sub">${esc(emp.role)}${emp.is_active ? "" : " · inactive"}</span>
            </span>
          </div>
        </td>
        ${cells}
      </tr>`;
    })
    .join("");

  renderCoverage();
}

function renderCoverage() {
  const days = rangeDays();
  const container = $("#coverage");

  if (!state.shifts.length) {
    container.innerHTML = `<div class="coverage-day"><p class="coverage-empty">Add a shift template to see coverage.</p></div>`;
    return;
  }

  container.innerHTML = days
    .map((d) => {
      const dISO = iso(d);
      const rows = state.shifts
        .map((shift) => {
          const assigned = state.roster.filter(
            (a) => a.date === dISO && a.shift.id === shift.id
          ).length;
          const required = Math.max(shift.required_staff, 1);
          const full = assigned >= required;
          const pct = Math.min(100, Math.round((assigned / required) * 100));
          return `
            <div class="coverage-row">
              <div class="coverage-row-top">
                <span class="coverage-name">${esc(shift.name)}</span>
                <span class="coverage-count ${full ? "is-full" : "is-short"}">${assigned}/${required}</span>
              </div>
              <div class="bar"><div class="bar-fill ${full ? "" : "is-short"}" style="width:${assigned ? pct : 0}%"></div></div>
            </div>`;
        })
        .join("");

      const dow = DAY_NAMES[(d.getDay() + 6) % 7];
      const isToday = dISO === iso(TODAY);
      return `
        <div class="coverage-day ${isToday ? "is-today" : ""}">
          <div class="coverage-date">
            <span>${dow} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}</span>
            ${isToday ? '<span class="today-tag">Today</span>' : ""}
          </div>
          ${rows || '<p class="coverage-empty">No shifts defined.</p>'}
        </div>`;
    })
    .join("");
}

/* --------------------------- roster interaction ------------------------ */

$("#roster-body").addEventListener("click", (e) => {
  if (e.target.id === "roster-add-employee") {
    history.replaceState(null, "", "#employees");
    activateView("employees");
    openEmployeeModal();
    return;
  }
  const chip = e.target.closest("[data-assignment]");
  if (chip) {
    removeAssignment(Number(chip.dataset.assignment));
    return;
  }
  const cell = e.target.closest("td.cell");
  if (cell) {
    openAssignModal({
      employeeId: cell.dataset.employee,
      date: cell.dataset.date,
    });
  }
});

async function removeAssignment(id) {
  if (!confirm("Remove this shift assignment?")) return;
  try {
    await api(`/assignments/${id}`, { method: "DELETE" });
    toast("Assignment removed", "success");
    await loadRoster();
  } catch (err) {
    toast(err.message);
  }
}

/* ---------------------------- employees view --------------------------- */

$("#open-employee").addEventListener("click", () => openEmployeeModal());
$$("[data-empty-action='employee']").forEach((b) =>
  b.addEventListener("click", () => openEmployeeModal())
);

function openEmployeeModal(employee) {
  const form = $("#employee-form");
  form.reset();
  form.id.value = employee ? employee.id : "";
  $("#employee-modal-title").textContent = employee ? "Edit employee" : "Add employee";
  if (employee) {
    form.name.value = employee.name;
    form.email.value = employee.email;
    form.role.value = employee.role;
    form.is_active.checked = employee.is_active;
  }
  openModal("employee-modal");
}

$("#employee-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = {
    name: form.name.value.trim(),
    email: form.email.value.trim(),
    role: form.role.value,
    is_active: form.is_active.checked,
  };
  const id = form.id.value;
  try {
    if (id) {
      await api(`/employees/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      toast("Employee updated", "success");
    } else {
      await api("/employees", { method: "POST", body: JSON.stringify(payload) });
      toast("Employee added", "success");
    }
    closeModal($("#employee-modal"));
    await refresh();
  } catch (err) {
    toast(err.message);
  }
});

$("#employees-body").addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-edit-employee]");
  if (editBtn) {
    const emp = state.employees.find((x) => x.id === Number(editBtn.dataset.editEmployee));
    if (emp) openEmployeeModal(emp);
    return;
  }
  const delBtn = e.target.closest("[data-delete-employee]");
  if (delBtn) {
    const id = Number(delBtn.dataset.deleteEmployee);
    const emp = state.employees.find((x) => x.id === id);
    if (!confirm(`Delete ${emp ? emp.name : "employee"}? Their assignments go too.`)) return;
    try {
      await api(`/employees/${id}`, { method: "DELETE" });
      toast("Employee deleted", "success");
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  }
});

/* ------------------------------ shifts view ---------------------------- */

$("#open-shift").addEventListener("click", () => openShiftModal());
$$("[data-empty-action='shift']").forEach((b) =>
  b.addEventListener("click", () => openShiftModal())
);

function renderShifts() {
  const list = state.shifts;
  $("#shifts-count").textContent = list.length;
  $("#shifts-empty").hidden = list.length > 0;
  $("#shifts-empty-panel").hidden = list.length > 0;

  $("#shift-cards").innerHTML = list
    .map((s) => {
      const hours = durationHours(s.start_time, s.end_time);
      const overnight = minutesOf(s.end_time) <= minutesOf(s.start_time);
      return `
        <article class="shift-card ${shiftHue(s.id)}">
          <div class="shift-card-head">
            <span class="shift-name">${esc(s.name)}</span>
          </div>
          <div class="shift-time">${hhmm(s.start_time)} – ${hhmm(s.end_time)}${overnight ? " (+1d)" : ""}</div>
          <div class="shift-facts">
            <span class="fact">${hours % 1 === 0 ? hours : hours.toFixed(1)}h long</span>
            <span class="fact">${s.required_staff} required</span>
          </div>
          <div class="shift-card-actions">
            <button class="btn btn-ghost" data-edit-shift="${s.id}">Edit</button>
            <button class="btn btn-danger-ghost" data-delete-shift="${s.id}">Delete</button>
          </div>
        </article>`;
    })
    .join("");
}

function openShiftModal(shift) {
  const form = $("#shift-form");
  form.reset();
  form.id.value = shift ? shift.id : "";
  $("#shift-modal-title").textContent = shift ? "Edit shift" : "Add shift";
  if (shift) {
    form.name.value = shift.name;
    form.start_time.value = hhmm(shift.start_time);
    form.end_time.value = hhmm(shift.end_time);
    form.required_staff.value = shift.required_staff;
  } else {
    form.start_time.value = "09:00";
    form.end_time.value = "17:00";
    form.required_staff.value = 1;
  }
  openModal("shift-modal");
}

$("#shift-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = {
    name: form.name.value.trim(),
    start_time: form.start_time.value,
    end_time: form.end_time.value,
    required_staff: Number(form.required_staff.value),
  };
  const id = form.id.value;
  try {
    if (id) {
      await api(`/shifts/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      toast("Shift updated", "success");
    } else {
      await api("/shifts", { method: "POST", body: JSON.stringify(payload) });
      toast("Shift created", "success");
    }
    closeModal($("#shift-modal"));
    await refresh();
  } catch (err) {
    toast(err.message);
  }
});

$("#shift-cards").addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-edit-shift]");
  if (editBtn) {
    const shift = state.shifts.find((s) => s.id === Number(editBtn.dataset.editShift));
    if (shift) openShiftModal(shift);
    return;
  }
  const delBtn = e.target.closest("[data-delete-shift]");
  if (delBtn) {
    const id = Number(delBtn.dataset.deleteShift);
    const shift = state.shifts.find((s) => s.id === id);
    if (!confirm(`Delete "${shift ? shift.name : "shift"}"? Its assignments go too.`)) return;
    try {
      await api(`/shifts/${id}`, { method: "DELETE" });
      toast("Shift deleted", "success");
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  }
});

/* ---------------------------- assign dialog ---------------------------- */

function renderAssignOptions() {
  const form = $("#assign-form");
  const activeEmployees = state.employees.filter((e) => e.is_active);
  const employees = activeEmployees.length ? activeEmployees : state.employees;

  form.employee_id.innerHTML = employees.length
    ? employees
        .map((e) => `<option value="${e.id}">${esc(e.name)} — ${esc(e.role)}</option>`)
        .join("")
    : '<option value="" disabled selected>No employees yet</option>';

  form.shift_id.innerHTML = state.shifts.length
    ? state.shifts
        .map(
          (s) =>
            `<option value="${s.id}">${esc(s.name)} · ${hhmm(s.start_time)}–${hhmm(s.end_time)}</option>`
        )
        .join("")
    : '<option value="" disabled selected>No shifts yet</option>';
}

function openAssignModal({ employeeId, date, shiftId } = {}) {
  const form = $("#assign-form");
  renderAssignOptions();
  if (employeeId) form.employee_id.value = String(employeeId);
  if (shiftId) form.shift_id.value = String(shiftId);
  form.date.value = date || iso(TODAY);

  if (!state.employees.length) {
    toast("Add an employee first.");
    return;
  }
  if (!state.shifts.length) {
    toast("Add a shift template first.");
    return;
  }
  openModal("assign-modal");
}

$("#open-assign").addEventListener("click", () => openAssignModal({ date: iso(TODAY) }));

$("#assign-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = {
    employee_id: Number(form.employee_id.value),
    shift_id: Number(form.shift_id.value),
    date: form.date.value,
  };
  if (!payload.employee_id || !payload.shift_id || !payload.date) return;
  try {
    await api("/assignments", { method: "POST", body: JSON.stringify(payload) });
    closeModal($("#assign-modal"));
    toast("Shift assigned", "success");
    await loadRoster();
  } catch (err) {
    toast(err.message); // surfaces the API's 409 conflict explanation
  }
});

/* --------------------------------- boot -------------------------------- */

refresh();
