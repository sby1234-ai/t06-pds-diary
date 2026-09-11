// 플랜두씨 다이어리 1 — 순수 로직 (DB/DOM에 의존하지 않음, 테스트 가능)

export const TIMEZONE = "Asia/Seoul";

/** 서울(KST) 기준 오늘 날짜를 YYYY-MM-DD 문자열로 반환 */
export function todayKST(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(now);
}

/**
 * 할 일이 "지연"인지 판정한다.
 * 조건: 아직 열려있고(status='open'), 삭제되지 않았고(is_deleted=false),
 *       마감일이 서울 기준 오늘보다 이전인 경우.
 */
export function isOverdue(todo, todayStr = todayKST()) {
  if (!todo || todo.is_deleted) return false;
  if (todo.status !== "open") return false;
  if (!todo.due_date) return false;
  return todo.due_date < todayStr;
}

/** 두 시각(ISO 문자열 또는 Date) 사이의 경과 분을 정수로 반환 */
export function diffMinutes(startedAt, endedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 60000);
}

/**
 * 실행 시작 시 사용할 idempotency_key 생성.
 * 같은 todo에 대해 같은 시각에 중복 클릭이 나가도 같은 키가 되어
 * DB unique 제약(+ upsert onConflict)이 중복 삽입을 막아준다.
 */
export function makeIdempotencyKey(todoId, startedAtIso) {
  return `${todoId}:${startedAtIso}`;
}

/**
 * 회고(See) 집계. plans/todos/doRecords 원본 배열을 받아 그 자리에서 다시 계산한다
 * (캐시된 값을 신뢰하지 않음). 기간은 [periodStart, periodEnd] (YYYY-MM-DD, 포함).
 * 반환값의 각 항목에는 집계에 쓰인 원본 레코드 목록(drill-down용)도 함께 담는다.
 */
export function computeRetroStats({ plans, todos, doRecords }, periodStart, periodEnd, todayStr = todayKST()) {
  const inPeriod = (dateStr) => !!dateStr && dateStr >= periodStart && dateStr <= periodEnd;

  const periodPlans = (plans || []).filter((p) => !p.is_deleted && inPeriod(p.period_start));
  const periodTodos = (todos || []).filter((t) => !t.is_deleted && inPeriod(t.created_at ? t.created_at.slice(0, 10) : t.due_date));
  const doneTodos = periodTodos.filter((t) => t.status === "done");
  const overdueTodos = periodTodos.filter((t) => isOverdue(t, todayStr));

  const periodTodoIds = new Set(periodTodos.map((t) => t.id));
  const periodDoRecords = (doRecords || []).filter((d) => periodTodoIds.has(d.todo_id));
  const blockedRecords = periodDoRecords.filter((d) => !!d.blocked_reason);

  // 완료 건 기준으로만 예상-실제 시간차를 계산 (완료되지 않은 건 실제시간이 확정 안 됨)
  const completedRecords = periodDoRecords.filter((d) => d.completed);
  const todoById = new Map(periodTodos.map((t) => [t.id, t]));
  let expectedSum = 0;
  let actualSum = 0;
  const seenTodoForExpected = new Set();
  for (const rec of completedRecords) {
    actualSum += rec.actual_minutes || 0;
    const todo = todoById.get(rec.todo_id);
    // 예상시간은 todo당 1회만 합산 (여러 번 실행돼도 예상시간은 todo 고유값)
    if (todo && !seenTodoForExpected.has(todo.id)) {
      expectedSum += todo.expected_minutes || 0;
      seenTodoForExpected.add(todo.id);
    }
  }

  return {
    period_start: periodStart,
    period_end: periodEnd,
    plan_count: periodPlans.length,
    done_count: doneTodos.length,
    overdue_count: overdueTodos.length,
    blocked_count: blockedRecords.length,
    expected_actual_diff_minutes: expectedSum - actualSum,
    drilldown: {
      plans: periodPlans,
      done_todos: doneTodos,
      overdue_todos: overdueTodos,
      blocked_records: blockedRecords,
    },
  };
}

/** plans/todos/do_records/retrospectives 전체를 하나의 내보내기 번들로 묶는다 */
export function buildExportBundle({ plans, todos, doRecords, retrospectives }) {
  return {
    exported_at: new Date().toISOString(),
    exported_at_kst_date: todayKST(),
    contract: "pds-schema-v2",
    plans: plans || [],
    todos: todos || [],
    do_records: doRecords || [],
    retrospectives: retrospectives || [],
  };
}

/** 검색/필터/정렬을 todos 배열에 순수 함수로 적용 (화면 로직과 분리해서 테스트 가능) */
export function queryTodos(todos, { search = "", priority = "", status = "", tag = "", sortBy = "created_at", sortDir = "desc" } = {}) {
  let out = (todos || []).filter((t) => !t.is_deleted);
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    out = out.filter((t) => (t.title || "").toLowerCase().includes(q));
  }
  if (priority) out = out.filter((t) => t.priority === priority);
  if (status) out = out.filter((t) => t.status === status);
  if (tag) out = out.filter((t) => Array.isArray(t.tags) && t.tags.includes(tag));

  const dir = sortDir === "asc" ? 1 : -1;
  out = [...out].sort((a, b) => {
    const av = a[sortBy] ?? "";
    const bv = b[sortBy] ?? "";
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  return out;
}
