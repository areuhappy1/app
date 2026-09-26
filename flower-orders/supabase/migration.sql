-- 꽃 주문함 서버 테이블
-- 모든 접근은 flower 엣지 함수(서비스 키)를 거칩니다. RLS를 켜고 정책을 두지 않아
-- 브라우저의 공개(anon) 키로는 읽거나 쓸 수 없습니다.

create table if not exists public.flower_messages (
  id bigint generated always as identity primary key,
  source text not null default 'kakao',       -- kakao | sms
  sender text not null default '',            -- 카톡 알림 제목 또는 문자 보낸 사람
  phone text not null default '',             -- 문자 번호 (있으면)
  body text not null,
  received_at timestamptz not null default now(),
  order_id uuid,
  dismissed boolean not null default false
);
create index if not exists flower_messages_pending_idx
  on public.flower_messages (received_at desc) where order_id is null and not dismissed;

create table if not exists public.flower_orders (
  id uuid primary key default gen_random_uuid(),
  data jsonb not null default '{}'::jsonb,    -- 고객·상품·날짜 등 주문서 내용
  status text not null default 'new',         -- new | making | ready | done
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 접속 키의 SHA-256 해시 (ingest_key_hash, dashboard_key_hash)
create table if not exists public.flower_config (
  key text primary key,
  value text not null
);

alter table public.flower_messages enable row level security;
alter table public.flower_orders enable row level security;
alter table public.flower_config enable row level security;
