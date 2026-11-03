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
revoke all on public.closet_docs from anon;
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
