// Supabase 접근 계층. 여기 있는 키는 "공개용 anon/publishable 키"로, RLS 정책이
// 실제 접근 제어를 담당한다. service_role(진짜 비밀키)은 이 프로젝트 어디에도 없다.
// 버전 고정: @supabase/supabase-js 2.116.0 (jsdelivr @2 태그가 이 버전으로 풀렸음을 확인하고 고정함)
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";
import { makeIdempotencyKey, diffMinutes } from "./lib.mjs";

export const SUPABASE_URL = "https://kkdpprxsfhqhndwnibqp.supabase.co";
export const SUPABASE_PUBLIC_KEY = "sb_publishable_vrQWE1DygvBCMFyTsRM_zw_ivVIwtYN";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);

function unwrap({ data, error }) {
  if (error) throw new Error(error.message || String(error));
  return data;
}

// ───────────── 인증 (과제7) ─────────────
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

/** scope: 'local'(이 기기만) | 'global'(발급된 모든 세션) */
export async function signOut(scope = "local") {
  const { error } = await supabase.auth.signOut({ scope });
  if (error) throw new Error(error.message);
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthStateChange(cb) {
  return supabase.auth.onAuthStateChange((event, session) => cb(event, session));
}

export async function changePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

/** 회원 탈퇴: 내 모든 기록(plans/todos/do_records/retrospectives/plan_history)을 직접 삭제한다.
 *  주의: auth.users의 로그인 계정 자체(이메일/비밀번호)를 지우는 것은 service_role(관리자) 키가
 *  있어야 하는데, 그 키는 프론트엔드에 절대 넣을 수 없으므로 여기서는 하지 않는다 — 이건
 *  설명서 ⑥(아직 못 막은 것/못 한 것)에 그대로 밝힌다. */
export async function deleteAllMyData(userId) {
  await supabase.from("do_records").delete().eq("user_id", userId);
  await supabase.from("plan_history").delete().eq("user_id", userId);
  await supabase.from("todos").delete().eq("user_id", userId);
  await supabase.from("plans").delete().eq("user_id", userId);
  await supabase.from("retrospectives").delete().eq("user_id", userId);
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
