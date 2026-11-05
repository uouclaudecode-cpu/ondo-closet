-- 온도 옷장 데이터베이스
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여넣고 Run 하세요.

-- 옷, 코디 기록, 여행, 설정을 한 테이블에 문서처럼 저장해요.
-- id 예시: it_xxx (옷), log_2026-11-03 (착용 기록), trip_xxx (여행), prefs (설정)
create table if not exists public.closet_docs (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- 로그인한 사용자(authenticated)만 이 테이블을 쓸 수 있게 열어 줘요.
-- (프로젝트 만들 때 "Automatically expose new tables"를 꺼도 작동하도록 직접 지정)
-- (자동으로 붙는 TRUNCATE 같은 권한은 RLS를 건너뛰므로 먼저 모두 빼고 필요한 것만 다시 줘요)
revoke all on public.closet_docs from anon, authenticated;
grant select, insert, update, delete on public.closet_docs to authenticated;

-- 행 단위 보안: 로그인한 사람은 자기 행만 읽고 쓸 수 있어요.
alter table public.closet_docs enable row level security;

drop policy if exists "own rows: select" on public.closet_docs;
drop policy if exists "own rows: insert" on public.closet_docs;
drop policy if exists "own rows: update" on public.closet_docs;
drop policy if exists "own rows: delete" on public.closet_docs;

create policy "own rows: select" on public.closet_docs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own rows: insert" on public.closet_docs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own rows: update" on public.closet_docs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows: delete" on public.closet_docs
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 공용 Gemini 키 하루 사용량 (서버 함수 closet-ai가 로그인한 사람 이름으로 셉니다).
-- 표에는 정책을 두지 않아서 직접 읽고 쓸 수 없고, 아래 두 함수로만 자기 줄을 세고 읽어요.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  kind    text not null,
  count   integer not null default 0,
  primary key (user_id, day, kind)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- 한 번 쓸 때마다 +1 (한국 시간 기준 하루). 한도에 닿았으면 -1을 돌려줘요. 되돌리는 기능은 일부러 없어요.
create or replace function public.use_ai_quota(p_kind text, p_limit integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Asia/Seoul')::date;
  n integer;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_limit < 1 or p_limit > 1000 or length(p_kind) > 30 then raise exception 'bad arguments'; end if;
  insert into public.ai_usage (user_id, day, kind, count) values (uid, today, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = public.ai_usage.count + 1
    where public.ai_usage.count < p_limit
  returning count into n;
  return coalesce(n, -1);
end;
$$;
revoke all on function public.use_ai_quota(text, integer) from public, anon;
grant execute on function public.use_ai_quota(text, integer) to authenticated;

create or replace function public.ai_quota_used(p_kind text)
returns integer language sql security definer set search_path = '' stable as $$
  select coalesce((select count from public.ai_usage where user_id = auth.uid() and day = (now() at time zone 'Asia/Seoul')::date and kind = p_kind), 0);
$$;
revoke all on function public.ai_quota_used(text) from public, anon;
grant execute on function public.ai_quota_used(text) to authenticated;

-- 마스터 계정: 공용 AI 하루 한도 없음 + 내 계정 화면의 운영 통계. 사이트에서는 읽기·쓰기 불가.
-- (마스터 추가: insert into public.app_roles (user_id, role) select id, 'master' from auth.users where email = '...';)
create table if not exists public.app_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role    text not null check (role in ('master')),
  created_at timestamptz not null default now()
);
alter table public.app_roles enable row level security;
revoke all on public.app_roles from anon, authenticated;
-- is_master(), master_stats(), 그리고 마스터를 한도에서 빼는 use_ai_quota()는 마이그레이션 app_roles_master에 있어요.
