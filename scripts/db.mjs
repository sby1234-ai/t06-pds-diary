// Supabase 접근 계층. 여기 있는 키는 "공개용 anon/publishable 키"로, RLS 정책이
// 실제 접근 제어를 담당한다. service_role(진짜 비밀키)은 이 프로젝트 어디에도 없다.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { makeIdempotencyKey, diffMinutes } from "./lib.mjs";

export const SUPABASE_URL = "https://kkdpprxsfhqhndwnibqp.supabase.co";
export const SUPABASE_PUBLIC_KEY = "sb_publishable_vrQWE1DygvBCMFyTsRM_zw_ivVIwtYN";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);

function unwrap({ data, error }) {
  if (error) throw new Error(error.message || String(error));
  return data;
}

// ───────────── plans ─────────────
export async function fetchPlans() {
  return unwrap(await supabase.from("plans").select("*").eq("is_deleted", false).order("created_at", { ascending: false }));
}

export async function createPlan(fields) {
  return unwrap(await supabase.from("plans").insert(fields).select().single());
}

/** 수정 전 상태를 plan_history에 스냅샷으로 남긴 뒤 실제 수정을 적용한다. */
export async function updatePlanWithHistory(id, changes, changeNote) {
  const current = unwrap(await supabase.from("plans").select("*").eq("id", id).single());
  unwrap(await supabase.from("plan_history").insert({ plan_id: id, snapshot: current, change_note: changeNote || "" }));
  return unwrap(
    await supabase
      .from("plans")
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()
  );
}

export async function softDeletePlan(id) {
  return unwrap(await supabase.from("plans").update({ is_deleted: true, updated_at: new Date().toISOString() }).eq("id", id).select().single());
}

export async function fetchPlanHistory(planId) {
  return unwrap(await supabase.from("plan_history").select("*").eq("plan_id", planId).order("edited_at", { ascending: false }));
}

// ───────────── todos ─────────────
export async function fetchTodos() {
  return unwrap(await supabase.from("todos").select("*").eq("is_deleted", false).order("created_at", { ascending: false }));
}

export async function createTodo(fields) {
  return unwrap(await supabase.from("todos").insert(fields).select().single());
}

export async function updateTodo(id, changes) {
  return unwrap(
    await supabase
      .from("todos")
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()
  );
}

export async function softDeleteTodo(id) {
  return unwrap(await supabase.from("todos").update({ is_deleted: true, updated_at: new Date().toISOString() }).eq("id", id).select().single());
}

// ───────────── do_records (실행) ─────────────
export async function fetchDoRecords() {
  return unwrap(await supabase.from("do_records").select("*").order("started_at", { ascending: false }));
}

/**
 * 실행 시작. idempotency_key에 unique 제약이 있고, upsert(onConflict)로 처리하므로
 * 네트워크 재시도로 같은 클릭이 두 번 가더라도 행이 하나만 생긴다.
 */
export async function startDoRecord(todoId) {
  const startedAt = new Date().toISOString();
  const idempotencyKey = makeIdempotencyKey(todoId, startedAt);
  return unwrap(
    await supabase
      .from("do_records")
      .upsert({ todo_id: todoId, started_at: startedAt, idempotency_key: idempotencyKey }, { onConflict: "idempotency_key" })
      .select()
      .single()
  );
}

/** 완료 처리. 같은 recordId로 다시 호출해도 update라 중복 집계되지 않는다. */
export async function completeDoRecord(recordId, startedAt) {
  const endedAt = new Date().toISOString();
  const actualMinutes = diffMinutes(startedAt, endedAt);
  const changes = { ended_at: endedAt, actual_minutes: actualMinutes, completed: true };
  return unwrap(await supabase.from("do_records").update(changes).eq("id", recordId).select().single());
}

export async function blockDoRecord(recordId, reason) {
  return unwrap(await supabase.from("do_records").update({ blocked_reason: reason }).eq("id", recordId).select().single());
}

// ───────────── retrospectives (회고) ─────────────
export async function fetchRetrospectives() {
  return unwrap(await supabase.from("retrospectives").select("*").order("created_at", { ascending: false }));
}

export async function createRetrospective(fields) {
  return unwrap(await supabase.from("retrospectives").insert(fields).select().single());
}
