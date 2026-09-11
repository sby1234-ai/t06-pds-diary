-- 플랜두씨 다이어리 1 — Supabase 스키마 (과제 6)
-- Supabase 대시보드 > SQL Editor 에 전체를 그대로 붙여넣고 "Run" 하면 됩니다.
-- 로그인이 없는 앱이므로, anon(공개) 역할에 전체 CRUD 권한을 여는 정책을 명시적으로 둡니다.
-- (RLS는 켜두되 "누구나 가능" 정책을 넣는 방식 — 실수로 열린 게 아니라 의도적으로
--  열었다는 걸 스키마 자체가 보여주기 위함입니다.)

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────
-- 1) retrospectives — 회고 (See). plans보다 먼저 만들어야 plans에서
--    "이 회고의 통찰이 다음 계획으로 이어졌다"는 참조를 걸 수 있음.
-- ─────────────────────────────────────────────────────────
create table if not exists retrospectives (
  id                    uuid primary key default gen_random_uuid(),
  period_start          date not null,
  period_end            date not null,
  plan_count            integer not null default 0,
  done_count            integer not null default 0,
  overdue_count         integer not null default 0,
  blocked_count         integer not null default 0,
  expected_actual_diff_minutes integer not null default 0,
  insight               text not null default '',
  created_at            timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- 2) plans — 계획 (Plan)
-- ─────────────────────────────────────────────────────────
create table if not exists plans (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  period_start      date not null,
  period_end        date not null,
  priority          text not null default 'medium' check (priority in ('high','medium','low')),
  success_criteria  text not null default '',
  expected_minutes  integer not null default 0 check (expected_minutes >= 0),
  source_retro_id   uuid references retrospectives(id) on delete set null,
  source_insight    text,
  is_deleted        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 계획 수정 이력 보존용 — plans를 UPDATE하기 전에 이전 상태를 여기 스냅샷으로 남긴다.
create table if not exists plan_history (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references plans(id) on delete cascade,
  snapshot      jsonb not null,       -- 수정 직전 plans 행 전체
  change_note   text not null default '',
  edited_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- 3) todos — 할 일
-- ─────────────────────────────────────────────────────────
create table if not exists todos (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid references plans(id) on delete set null,
  title             text not null,
  due_date          date,
  priority          text not null default 'medium' check (priority in ('high','medium','low')),
  tags              text[] not null default '{}',
  expected_minutes  integer not null default 0 check (expected_minutes >= 0),
  status            text not null default 'open' check (status in ('open','done')),
  is_deleted        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- 4) do_records — 실행 기록 (Do). todos 1건에 여러 번의 실행 시도가 남을 수 있음.
--    idempotency_key로 "완료 처리"가 중복 집계되는 것을 막는다.
-- ─────────────────────────────────────────────────────────
create table if not exists do_records (
  id                uuid primary key default gen_random_uuid(),
  todo_id           uuid not null references todos(id) on delete cascade,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  actual_minutes    integer,
  blocked_reason    text,
  completed         boolean not null default false,
  idempotency_key   text not null unique,
  created_at        timestamptz not null default now()
);

create index if not exists idx_todos_plan_id on todos(plan_id);
create index if not exists idx_do_records_todo_id on do_records(todo_id);
create index if not exists idx_plan_history_plan_id on plan_history(plan_id);

-- ─────────────────────────────────────────────────────────
-- RLS — 로그인이 없는 공개 앱이므로 anon 역할에 전체 CRUD를 명시적으로 허용.
-- ─────────────────────────────────────────────────────────
alter table plans          enable row level security;
alter table plan_history   enable row level security;
alter table todos          enable row level security;
alter table do_records     enable row level security;
alter table retrospectives enable row level security;

drop policy if exists "anon_all_plans"          on plans;
drop policy if exists "anon_all_plan_history"   on plan_history;
drop policy if exists "anon_all_todos"          on todos;
drop policy if exists "anon_all_do_records"     on do_records;
drop policy if exists "anon_all_retrospectives" on retrospectives;

create policy "anon_all_plans"          on plans          for all using (true) with check (true);
create policy "anon_all_plan_history"   on plan_history   for all using (true) with check (true);
create policy "anon_all_todos"          on todos          for all using (true) with check (true);
create policy "anon_all_do_records"     on do_records     for all using (true) with check (true);
create policy "anon_all_retrospectives" on retrospectives for all using (true) with check (true);
