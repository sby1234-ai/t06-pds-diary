-- 과제7 — 인증 적용 마이그레이션. Supabase SQL Editor에 그대로 붙여넣고 Run.
-- (1단계) 지금 바로 실행 — 기존 열린 정책을 걷어내고, 로그인한 사람 것만 보이게 바꾼다.

alter table plans          add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table plan_history   add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table todos          add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table do_records     add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table retrospectives add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table plans          alter column user_id set default auth.uid();
alter table plan_history   alter column user_id set default auth.uid();
alter table todos          alter column user_id set default auth.uid();
alter table do_records     alter column user_id set default auth.uid();
alter table retrospectives alter column user_id set default auth.uid();

-- 로그아웃/비밀번호 변경 시 "이미 발급된 값"을 즉시 무효화하기 위한 검사 함수.
-- Supabase 접근 토큰(JWT)에는 session_id가 들어있는데, 로그아웃하면 auth.sessions에서
-- 그 세션 행이 사라진다(또는 만료 처리된다) — 그래서 토큰 서명 자체는 아직 유효 기간이
-- 남아있어도, 이 함수가 auth.sessions에 그 세션이 "아직 살아있는지"를 매 요청마다 다시 확인한다.
create or replace function public.current_session_valid()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.sessions s
    where s.id = (auth.jwt() ->> 'session_id')::uuid
  );
$$;

grant execute on function public.current_session_valid() to authenticated, anon;

drop policy if exists "anon_all_plans"          on plans;
drop policy if exists "anon_all_plan_history"   on plan_history;
drop policy if exists "anon_all_todos"          on todos;
drop policy if exists "anon_all_do_records"     on do_records;
drop policy if exists "anon_all_retrospectives" on retrospectives;

create policy "owner_select_plans" on plans for select using (auth.uid() = user_id and public.current_session_valid());
create policy "owner_insert_plans" on plans for insert with check (auth.uid() = user_id and public.current_session_valid());
create policy "owner_update_plans" on plans for update using (auth.uid() = user_id and public.current_session_valid()) with check (auth.uid() = user_id and public.current_session_valid());
create policy "owner_delete_plans" on plans for delete using (auth.uid() = user_id and public.current_session_valid());

create policy "owner_select_plan_history" on plan_history for select using (auth.uid() = user_id and public.current_session_valid());
create policy "owner_insert_plan_history" on plan_history for insert with check (auth.uid() = user_id and public.current_session_valid());

create policy "owner_select_todos" on todos for select using (auth.uid() = user_id and public.current_session_valid());
create policy "owner_insert_todos" on todos for insert with check (auth.uid() = user_id and public.current_session_valid());
create policy "owner_update_todos" on todos for update using (auth.uid() = user_id and public.current_session_valid()) with check (auth.uid() = user_id and public.current_session_valid());
create policy "owner_delete_todos" on todos for delete using (auth.uid() = user_id and public.current_session_valid());

create policy "owner_select_do_records" on do_records for select using (auth.uid() = user_id and public.current_session_valid());
create policy "owner_insert_do_records" on do_records for insert with check (auth.uid() = user_id and public.current_session_valid());
create policy "owner_update_do_records" on do_records for update using (auth.uid() = user_id and public.current_session_valid()) with check (auth.uid() = user_id and public.current_session_valid());
create policy "owner_delete_do_records" on do_records for delete using (auth.uid() = user_id and public.current_session_valid());

create policy "owner_select_retrospectives" on retrospectives for select using (auth.uid() = user_id and public.current_session_valid());
create policy "owner_insert_retrospectives" on retrospectives for insert with check (auth.uid() = user_id and public.current_session_valid());

-- (2단계는 별도 파일: schema-v2-backfill.sql — 본인 계정 만든 뒤에 실행)
