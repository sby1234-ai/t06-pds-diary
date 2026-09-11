import {
  todayKST,
  isOverdue,
  computeRetroStats,
  buildExportBundle,
  queryTodos,
} from "./lib.mjs";
import {
  fetchPlans,
  createPlan,
  updatePlanWithHistory,
  softDeletePlan,
  fetchTodos,
  createTodo,
  updateTodo,
  softDeleteTodo,
  fetchDoRecords,
  startDoRecord,
  completeDoRecord,
  blockDoRecord,
  fetchRetrospectives,
  createRetrospective,
} from "./db.mjs";

// ───────────── 작은 DOM 헬퍼 (항상 textContent만 사용 — innerHTML에 사용자 입력을 절대 넣지 않는다) ─────────────
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "onClick") node.addEventListener("click", v);
    else if (k.startsWith("data-")) node.setAttribute(k, v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}
function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const state = {
  plans: [],
  todos: [],
  doRecords: [],
  retrospectives: [],
  editingPlanId: null,
  editingTodoId: null,
};

const PRIORITY_LABEL = { high: "높음", medium: "보통", low: "낮음" };

// ───────────── 탭 전환 ─────────────
document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll("main > section").forEach((s) => (s.hidden = true));
    document.getElementById("tab-" + btn.dataset.tab).hidden = false;
  });
});

// ───────────── 전체 데이터 로드 ─────────────
async function loadAll() {
  const [plans, todos, doRecords, retrospectives] = await Promise.all([
    fetchPlans(),
    fetchTodos(),
    fetchDoRecords(),
    fetchRetrospectives(),
  ]);
  state.plans = plans;
  state.todos = todos;
  state.doRecords = doRecords;
  state.retrospectives = retrospectives;
  renderPlans();
  renderTodoPlanOptions();
  renderPlanRetroOptions();
  renderTodos();
  renderDoList();
  renderRetroList();
  renderSee();
}

// ═════════════════════════ 계획 (Plan) ═════════════════════════
function renderPlans() {
  const list = document.getElementById("planList");
  clear(list);
  if (state.plans.length === 0) {
    list.appendChild(el("p", { class: "empty" }, "아직 계획이 없습니다."));
    return;
  }
  for (const plan of state.plans) {
    const item = el("div", { class: "list-item" }, [
      el("div", { class: "title" }, plan.title),
      el("div", { class: "meta" }, `${plan.period_start} ~ ${plan.period_end}`),
      el("div", { class: "meta" }, [el("span", { class: "badge " + plan.priority }, PRIORITY_LABEL[plan.priority] || plan.priority)]),
      el("div", { class: "meta" }, "성공 기준: " + plan.success_criteria),
      plan.source_insight ? el("div", { class: "meta" }, "이전 회고에서 이어받음: " + plan.source_insight) : null,
      el("div", { class: "row", style: "margin-top:6px;" }, [
        el("button", { class: "ghost", onClick: () => startEditPlan(plan) }, "수정"),
        el("button", { class: "ghost danger", onClick: () => onDeletePlan(plan.id) }, "삭제"),
      ]),
    ]);
    list.appendChild(item);
  }
}

function renderPlanRetroOptions() {
  const sel = document.getElementById("planRetroLink");
  const prev = sel.value;
  clear(sel);
  sel.appendChild(el("option", { value: "" }, "(연결 안 함)"));
  for (const r of state.retrospectives) {
    const label = `${r.period_start}~${r.period_end}: ${r.insight.slice(0, 30)}`;
    sel.appendChild(el("option", { value: r.id }, label));
  }
  sel.value = prev || "";
}

function startEditPlan(plan) {
  state.editingPlanId = plan.id;
  document.getElementById("planFormTitle").textContent = "계획 수정";
  document.getElementById("planId").value = plan.id;
  document.getElementById("planTitle").value = plan.title;
  document.getElementById("planStart").value = plan.period_start;
  document.getElementById("planEnd").value = plan.period_end;
  document.getElementById("planPriority").value = plan.priority;
  document.getElementById("planExpected").value = plan.expected_minutes;
  document.getElementById("planCriteria").value = plan.success_criteria;
  document.getElementById("planSubmitBtn").textContent = "수정 저장";
  document.getElementById("planCancelEditBtn").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetPlanForm() {
  state.editingPlanId = null;
  document.getElementById("planForm").reset();
  document.getElementById("planId").value = "";
  document.getElementById("planFormTitle").textContent = "새 계획 만들기";
  document.getElementById("planSubmitBtn").textContent = "계획 만들기";
  document.getElementById("planCancelEditBtn").hidden = true;
}

document.getElementById("planCancelEditBtn").addEventListener("click", resetPlanForm);

document.getElementById("planForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("planFormStatus");
  const retroId = document.getElementById("planRetroLink").value || null;
  const retro = retroId ? state.retrospectives.find((r) => r.id === retroId) : null;
  const fields = {
    title: document.getElementById("planTitle").value.trim(),
    period_start: document.getElementById("planStart").value,
    period_end: document.getElementById("planEnd").value,
    priority: document.getElementById("planPriority").value,
    expected_minutes: Number(document.getElementById("planExpected").value) || 0,
    success_criteria: document.getElementById("planCriteria").value.trim(),
    source_retro_id: retroId,
    source_insight: retro ? retro.insight : null,
  };
  try {
    statusEl.textContent = "저장 중...";
    statusEl.className = "status-line";
    if (state.editingPlanId) {
      await updatePlanWithHistory(state.editingPlanId, fields, "화면에서 수정");
    } else {
      await createPlan(fields);
    }
    resetPlanForm();
    statusEl.textContent = "저장되었습니다.";
    await loadAll();
  } catch (err) {
    statusEl.textContent = "오류: " + err.message;
    statusEl.className = "status-line error";
  }
});

async function onDeletePlan(id) {
  if (!confirm("이 계획을 삭제할까요? (목록에서만 숨겨지고 기록은 남습니다)")) return;
  await softDeletePlan(id);
  await loadAll();
}

// ═════════════════════════ 할 일 (Todo) ═════════════════════════
function renderTodoPlanOptions() {
  const sel = document.getElementById("todoPlan");
  const prev = sel.value;
  clear(sel);
  sel.appendChild(el("option", { value: "" }, "(연결 안 함)"));
  for (const p of state.plans) {
    sel.appendChild(el("option", { value: p.id }, p.title));
  }
  sel.value = prev || "";
}

function currentTodoFilters() {
  return {
    search: document.getElementById("todoSearch").value,
    priority: document.getElementById("todoFilterPriority").value,
    status: document.getElementById("todoFilterStatus").value,
    sortBy: document.getElementById("todoSortBy").value,
    sortDir: "desc",
  };
}

["todoSearch", "todoFilterPriority", "todoFilterStatus", "todoSortBy"].forEach((id) => {
  document.getElementById(id).addEventListener("input", renderTodos);
  document.getElementById(id).addEventListener("change", renderTodos);
});

function renderTodos() {
  const list = document.getElementById("todoList");
  clear(list);
  const today = todayKST();
  const filtered = queryTodos(state.todos, currentTodoFilters());
  if (filtered.length === 0) {
    list.appendChild(el("p", { class: "empty" }, "조건에 맞는 할 일이 없습니다."));
    return;
  }
  for (const todo of filtered) {
    const badges = [el("span", { class: "badge " + todo.priority }, PRIORITY_LABEL[todo.priority] || todo.priority)];
    if (todo.status === "done") badges.push(el("span", { class: "badge done" }, "완료"));
    if (isOverdue(todo, today)) badges.push(el("span", { class: "badge overdue" }, "지연"));
    for (const tag of todo.tags || []) badges.push(el("span", { class: "badge" }, tag));

    const item = el("div", { class: "list-item" }, [
      el("div", { class: "title" }, todo.title),
      el("div", { class: "meta" }, todo.due_date ? "마감: " + todo.due_date : "마감일 없음"),
      el("div", { class: "meta" }, badges),
      el("div", { class: "row", style: "margin-top:6px;" }, [
        el("button", { class: "ghost", onClick: () => startEditTodo(todo) }, "수정"),
        el("button", { class: "ghost danger", onClick: () => onDeleteTodo(todo.id) }, "삭제"),
      ]),
    ]);
    list.appendChild(item);
  }
}

function startEditTodo(todo) {
  state.editingTodoId = todo.id;
  document.getElementById("todoFormTitle").textContent = "할 일 수정";
  document.getElementById("todoId").value = todo.id;
  document.getElementById("todoTitle").value = todo.title;
  document.getElementById("todoPlan").value = todo.plan_id || "";
  document.getElementById("todoDue").value = todo.due_date || "";
  document.getElementById("todoPriority").value = todo.priority;
  document.getElementById("todoExpected").value = todo.expected_minutes;
  document.getElementById("todoTags").value = (todo.tags || []).join(", ");
  document.getElementById("todoSubmitBtn").textContent = "수정 저장";
  document.getElementById("todoCancelEditBtn").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetTodoForm() {
  state.editingTodoId = null;
  document.getElementById("todoForm").reset();
  document.getElementById("todoId").value = "";
  document.getElementById("todoFormTitle").textContent = "새 할 일 추가";
  document.getElementById("todoSubmitBtn").textContent = "할 일 추가";
  document.getElementById("todoCancelEditBtn").hidden = true;
}

document.getElementById("todoCancelEditBtn").addEventListener("click", resetTodoForm);

document.getElementById("todoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("todoFormStatus");
  const tags = document
    .getElementById("todoTags")
    .value.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const fields = {
    title: document.getElementById("todoTitle").value.trim(),
    plan_id: document.getElementById("todoPlan").value || null,
    due_date: document.getElementById("todoDue").value || null,
    priority: document.getElementById("todoPriority").value,
    expected_minutes: Number(document.getElementById("todoExpected").value) || 0,
    tags,
  };
  try {
    statusEl.textContent = "저장 중...";
    statusEl.className = "status-line";
    if (state.editingTodoId) {
      await updateTodo(state.editingTodoId, fields);
    } else {
      await createTodo(fields);
    }
    resetTodoForm();
    statusEl.textContent = "저장되었습니다.";
    await loadAll();
  } catch (err) {
    statusEl.textContent = "오류: " + err.message;
    statusEl.className = "status-line error";
  }
});

async function onDeleteTodo(id) {
  if (!confirm("이 할 일을 삭제할까요? (목록에서만 숨겨지고 실행 기록은 남습니다)")) return;
  await softDeleteTodo(id);
  await loadAll();
}

// ═════════════════════════ 실행 (Do) ═════════════════════════
function renderDoList() {
  const list = document.getElementById("doList");
  clear(list);
  const openTodos = state.todos.filter((t) => !t.is_deleted && t.status === "open");
  if (openTodos.length === 0) {
    list.appendChild(el("p", { class: "empty" }, "진행중인 할 일이 없습니다."));
    return;
  }
  for (const todo of openTodos) {
    const records = state.doRecords.filter((d) => d.todo_id === todo.id);
    const activeRecord = records.find((d) => !d.completed);

    const historyLines = records.map((r) => {
      let text = "시작 " + new Date(r.started_at).toLocaleString("ko-KR");
      if (r.completed) text += ` → 완료 (${r.actual_minutes}분 소요)`;
      else if (r.blocked_reason) text += ` → 막힘: ${r.blocked_reason}`;
      else text += " → 진행중";
      return el("div", { class: "meta" }, text);
    });

    const actions = [];
    if (!activeRecord) {
      actions.push(el("button", { class: "ghost", onClick: () => onStart(todo.id) }, "시작"));
    } else {
      actions.push(el("button", { class: "ghost", onClick: () => onComplete(activeRecord.id, activeRecord.started_at, todo.id) }, "완료"));
      actions.push(el("button", { class: "ghost", onClick: () => onBlocked(activeRecord.id) }, "막힘 표시"));
    }

    const item = el("div", { class: "list-item" }, [
      el("div", { class: "title" }, todo.title),
      el("div", { class: "meta" }, "예상 " + todo.expected_minutes + "분"),
      ...historyLines,
      el("div", { class: "row", style: "margin-top:6px;" }, actions),
    ]);
    list.appendChild(item);
  }
}

async function onStart(todoId) {
  await startDoRecord(todoId);
  await loadAll();
}

async function onComplete(recordId, startedAt, todoId) {
  await completeDoRecord(recordId, startedAt);
  await updateTodo(todoId, { status: "done" });
  await loadAll();
}

async function onBlocked(recordId) {
  const reason = prompt("막힌 이유를 적어주세요");
  if (reason == null) return;
  await blockDoRecord(recordId, reason);
  await loadAll();
}

// ═════════════════════════ 회고 (See) ═════════════════════════
function defaultSeeRange() {
  const today = todayKST();
  const monthStart = today.slice(0, 8) + "01";
  return { start: monthStart, end: today };
}
{
  const { start, end } = defaultSeeRange();
  document.getElementById("seeStart").value = start;
  document.getElementById("seeEnd").value = end;
}

document.getElementById("seeRefreshBtn").addEventListener("click", renderSee);

function renderSee() {
  const start = document.getElementById("seeStart").value || defaultSeeRange().start;
  const end = document.getElementById("seeEnd").value || defaultSeeRange().end;
  const stats = computeRetroStats(
    { plans: state.plans, todos: state.todos, doRecords: state.doRecords },
    start,
    end
  );

  const grid = document.getElementById("seeStatGrid");
  clear(grid);
  const boxes = [
    { key: "plan_count", label: "계획 수", value: stats.plan_count, drill: "plans" },
    { key: "done_count", label: "완료 수", value: stats.done_count, drill: "done_todos" },
    { key: "overdue_count", label: "지연 수", value: stats.overdue_count, drill: "overdue_todos" },
    { key: "blocked_count", label: "막힘 수", value: stats.blocked_count, drill: "blocked_records" },
    { key: "diff", label: "예상-실제(분)", value: stats.expected_actual_diff_minutes, drill: null },
  ];
  for (const box of boxes) {
    const node = el(
      "div",
      { class: "stat-box", onClick: box.drill ? () => renderDrilldown(box.label, stats.drilldown[box.drill]) : () => {} },
      [el("div", { class: "stat-num" }, String(box.value)), el("div", { class: "stat-label" }, box.label)]
    );
    grid.appendChild(node);
  }
}

function renderDrilldown(label, records) {
  const wrap = document.getElementById("seeDrilldown");
  clear(wrap);
  wrap.hidden = false;
  wrap.appendChild(el("h3", {}, label + " — 근거 기록 " + records.length + "건"));
  if (records.length === 0) {
    wrap.appendChild(el("p", { class: "empty" }, "해당하는 기록이 없습니다."));
    return;
  }
  for (const r of records) {
    const title = r.title || r.insight || r.blocked_reason || r.id;
    wrap.appendChild(el("div", { class: "list-item" }, [el("div", { class: "title" }, String(title))]));
  }
}

document.getElementById("retroForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("retroFormStatus");
  const start = document.getElementById("seeStart").value || defaultSeeRange().start;
  const end = document.getElementById("seeEnd").value || defaultSeeRange().end;
  const stats = computeRetroStats({ plans: state.plans, todos: state.todos, doRecords: state.doRecords }, start, end);
  const fields = {
    period_start: start,
    period_end: end,
    plan_count: stats.plan_count,
    done_count: stats.done_count,
    overdue_count: stats.overdue_count,
    blocked_count: stats.blocked_count,
    expected_actual_diff_minutes: stats.expected_actual_diff_minutes,
    insight: document.getElementById("retroInsight").value.trim(),
  };
  try {
    statusEl.textContent = "저장 중...";
    statusEl.className = "status-line";
    await createRetrospective(fields);
    document.getElementById("retroForm").reset();
    statusEl.textContent = "회고가 저장되었습니다. '계획' 탭에서 이 회고를 이어받을 수 있습니다.";
    await loadAll();
  } catch (err) {
    statusEl.textContent = "오류: " + err.message;
    statusEl.className = "status-line error";
  }
});

function renderRetroList() {
  const list = document.getElementById("retroList");
  clear(list);
  if (state.retrospectives.length === 0) {
    list.appendChild(el("p", { class: "empty" }, "아직 회고가 없습니다."));
    return;
  }
  for (const r of state.retrospectives) {
    list.appendChild(
      el("div", { class: "list-item" }, [
        el("div", { class: "title" }, `${r.period_start} ~ ${r.period_end}`),
        el("div", { class: "meta" }, `계획 ${r.plan_count} · 완료 ${r.done_count} · 지연 ${r.overdue_count} · 막힘 ${r.blocked_count}`),
        el("div", { class: "meta" }, "통찰: " + r.insight),
      ])
    );
  }
}

// ═════════════════════════ 내보내기 (Export) ═════════════════════════
document.getElementById("exportBtn").addEventListener("click", () => {
  const statusEl = document.getElementById("exportStatus");
  try {
    const bundle = buildExportBundle({
      plans: state.plans,
      todos: state.todos,
      doRecords: state.doRecords,
      retrospectives: state.retrospectives,
    });
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pds-diary-export-${todayKST()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    statusEl.textContent = "내보내기 완료.";
    statusEl.className = "status-line";
  } catch (err) {
    statusEl.textContent = "오류: " + err.message;
    statusEl.className = "status-line error";
  }
});

// ───────────── 시작 ─────────────
loadAll().catch((err) => {
  console.error(err);
  document.getElementById("planFormStatus").textContent = "초기 로딩 오류: " + err.message;
  document.getElementById("planFormStatus").className = "status-line error";
});
