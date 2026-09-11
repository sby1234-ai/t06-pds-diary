import assert from "node:assert/strict";
import {
  todayKST,
  isOverdue,
  diffMinutes,
  makeIdempotencyKey,
  computeRetroStats,
  buildExportBundle,
  queryTodos,
} from "./lib.mjs";

let passCount = 0;
let failCount = 0;
function check(id, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    console.log(`PASS  ${id}`);
    passCount++;
  } catch (e) {
    console.log(`FAIL  ${id}  -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failCount++;
  }
}

// L01: 지연 판정 - 오늘보다 이전 마감 + 열림 상태 => 지연
check("L01", isOverdue({ status: "open", is_deleted: false, due_date: "2026-09-01" }, "2026-09-11"), true);

// L02: 완료된 할일은 마감이 지나도 지연 아님
check("L02", isOverdue({ status: "done", is_deleted: false, due_date: "2026-09-01" }, "2026-09-11"), false);

// L03: 삭제된 할일은 지연 아님
check("L03", isOverdue({ status: "open", is_deleted: true, due_date: "2026-09-01" }, "2026-09-11"), false);

// L04: 마감일이 없으면 지연 아님
check("L04", isOverdue({ status: "open", is_deleted: false, due_date: null }, "2026-09-11"), false);

// L05: 마감일이 오늘이거나 미래면 지연 아님
check("L05", isOverdue({ status: "open", is_deleted: false, due_date: "2026-09-11" }, "2026-09-11"), false);

// L06: diffMinutes 정상 계산
check("L06", diffMinutes("2026-09-11T00:00:00Z", "2026-09-11T00:30:00Z"), 30);

// L07: diffMinutes 종료가 시작보다 이르면 0
check("L07", diffMinutes("2026-09-11T01:00:00Z", "2026-09-11T00:00:00Z"), 0);

// L08: idempotency key는 todoId+시각으로 결정적으로 생성
check("L08", makeIdempotencyKey("todo-1", "2026-09-11T00:00:00Z"), "todo-1:2026-09-11T00:00:00Z");

// L09~L12: computeRetroStats 집계
{
  const plans = [{ id: "p1", is_deleted: false, period_start: "2026-09-01" }];
  const todos = [
    { id: "t1", is_deleted: false, status: "done", created_at: "2026-09-05T00:00:00Z", expected_minutes: 30 },
    { id: "t2", is_deleted: false, status: "open", due_date: "2026-09-05", created_at: "2026-09-05T00:00:00Z", expected_minutes: 20 },
    { id: "t3", is_deleted: true, status: "done", created_at: "2026-09-05T00:00:00Z", expected_minutes: 10 }, // 삭제됨 -> 제외
  ];
  const doRecords = [
    { id: "d1", todo_id: "t1", completed: true, actual_minutes: 40, blocked_reason: null },
    { id: "d2", todo_id: "t2", completed: false, actual_minutes: null, blocked_reason: "다른 일 생김" },
  ];
  const stats = computeRetroStats({ plans, todos, doRecords }, "2026-09-01", "2026-09-30", "2026-09-11");
  check("L09-plan_count", stats.plan_count, 1);
  check("L10-done_count", stats.done_count, 1);
  check("L11-overdue_count", stats.overdue_count, 1);
  check("L12-blocked_count", stats.blocked_count, 1);
  check("L13-diff", stats.expected_actual_diff_minutes, 30 - 40);
  check("L14-drilldown-done", stats.drilldown.done_todos.map((t) => t.id), ["t1"]);
  check("L15-drilldown-overdue", stats.drilldown.overdue_todos.map((t) => t.id), ["t2"]);
}

// L16: buildExportBundle에 4개 컬렉션이 다 담긴다
{
  const bundle = buildExportBundle({ plans: [{ id: 1 }], todos: [{ id: 2 }], doRecords: [{ id: 3 }], retrospectives: [{ id: 4 }] });
  check("L16", [bundle.plans.length, bundle.todos.length, bundle.do_records.length, bundle.retrospectives.length], [1, 1, 1, 1]);
}

// L17~L20: queryTodos 검색/필터/정렬
{
  const todos = [
    { id: "a", title: "장보기", priority: "low", status: "open", tags: ["집안일"], created_at: "2026-09-01" },
    { id: "b", title: "보고서 작성", priority: "high", status: "open", tags: ["업무"], created_at: "2026-09-03" },
    { id: "c", title: "운동하기", priority: "high", status: "done", tags: ["건강"], is_deleted: true, created_at: "2026-09-02" },
  ];
  check("L17-search", queryTodos(todos, { search: "보고" }).map((t) => t.id), ["b"]);
  check("L18-filter-priority", queryTodos(todos, { priority: "high" }).map((t) => t.id), ["b"]); // c는 삭제됨이라 제외
  check("L19-soft-delete-excluded", queryTodos(todos).map((t) => t.id).includes("c"), false);
  check("L20-sort-asc", queryTodos(todos, { sortBy: "created_at", sortDir: "asc" }).map((t) => t.id), ["a", "b"]);
}

// L21: todayKST가 YYYY-MM-DD 형식을 반환하는지
check("L21-format", /^\d{4}-\d{2}-\d{2}$/.test(todayKST()), true);

console.log(`\n=== SUMMARY: ${passCount}/${passCount + failCount} passed ===`);
process.exit(failCount > 0 ? 1 : 0);
