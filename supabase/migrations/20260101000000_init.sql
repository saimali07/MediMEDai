-- MediMind AI — schema, Row Level Security, storage, RAG and rate limiting
-- Run with:  supabase db push

create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  age         int check (age is null or (age >= 0 and age <= 120)),
  sex         text check (sex is null or sex in ('female','male','other')),
  language    text not null default 'en' check (language in ('en','ur','hi')),
  consent_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------- assessments
create table if not exists public.assessments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  type         text not null check (type in ('text','image','voice','multimodal','report')),
  title        text,
  input        jsonb not null default '{}'::jsonb,
  image_paths  text[] not null default '{}',
  result       jsonb not null,
  urgency      text not null check (urgency in ('emergency','urgent','routine','self_care')),
  created_at   timestamptz not null default now()
);
create index if not exists assessments_user_created_idx on public.assessments (user_id, created_at desc);

-- ----------------------------------------------------------------- reports
create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  assessment_id  uuid references public.assessments(id) on delete cascade,
  file_path      text not null,
  extracted_text text,
  explanation    jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists reports_user_idx on public.reports (user_id);

-- ------------------------------------------------------------ chat_messages
create table if not exists public.chat_messages (
  id             uuid primary key default gen_random_uuid(),
  assessment_id  uuid not null references public.assessments(id) on delete cascade,
  role           text not null check (role in ('user','assistant')),
  content        text not null,
  created_at     timestamptz not null default now()
);
create index if not exists chat_messages_assessment_idx on public.chat_messages (assessment_id, created_at);

-- --------------------------------------------------------- knowledge_chunks
create table if not exists public.knowledge_chunks (
  id         bigserial primary key,
  source     text not null,
  url        text not null,
  content    text not null,
  embedding  extensions.vector(768)
);
create index if not exists knowledge_chunks_url_idx on public.knowledge_chunks (url);
create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- -------------------------------------------------------------- rate_limits
create table if not exists public.rate_limits (
  key           text not null,          -- 'user:<uuid>' or 'guest:<sha256 of ip>'
  window_start  timestamptz not null,
  count         int not null default 0,
  primary key (key, window_start)
);

-- ------------------------------------------------------------ RLS: enable
alter table public.profiles         enable row level security;
alter table public.assessments      enable row level security;
alter table public.reports          enable row level security;
alter table public.chat_messages    enable row level security;
alter table public.knowledge_chunks enable row level security;   -- no policies: service role only
alter table public.rate_limits      enable row level security;   -- no policies: service role only

-- profiles
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_delete_own" on public.profiles for delete to authenticated using (id = auth.uid());

-- assessments (rows are INSERTED only by Edge Functions with the service role)
drop policy if exists "assessments_select_own" on public.assessments;
drop policy if exists "assessments_delete_own" on public.assessments;
create policy "assessments_select_own" on public.assessments for select to authenticated using (user_id = auth.uid());
create policy "assessments_delete_own" on public.assessments for delete to authenticated using (user_id = auth.uid());

-- reports
drop policy if exists "reports_select_own" on public.reports;
drop policy if exists "reports_delete_own" on public.reports;
create policy "reports_select_own" on public.reports for select to authenticated using (user_id = auth.uid());
create policy "reports_delete_own" on public.reports for delete to authenticated using (user_id = auth.uid());

-- chat_messages: visible only through an assessment the user owns
drop policy if exists "chat_select_own" on public.chat_messages;
drop policy if exists "chat_delete_own" on public.chat_messages;
create policy "chat_select_own" on public.chat_messages for select to authenticated
  using (exists (select 1 from public.assessments a where a.id = assessment_id and a.user_id = auth.uid()));
create policy "chat_delete_own" on public.chat_messages for delete to authenticated
  using (exists (select 1 from public.assessments a where a.id = assessment_id and a.user_id = auth.uid()));

-- ------------------------------------------------- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, nullif(left(coalesce(new.raw_user_meta_data->>'name', ''), 80), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------ RAG search
create or replace function public.match_chunks(
  query_embedding extensions.vector(768),
  k int default 4,
  min_similarity float default 0.5
)
returns table (id bigint, source text, url text, content text, similarity float)
language sql
stable
set search_path = public, extensions
as $$
  select kc.id, kc.source, kc.url, kc.content,
         1 - (kc.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks kc
  where kc.embedding is not null
    and 1 - (kc.embedding <=> query_embedding) >= min_similarity
  order by kc.embedding <=> query_embedding
  limit greatest(k, 1);
$$;

revoke all on function public.match_chunks(extensions.vector, int, float) from public, anon, authenticated;
grant execute on function public.match_chunks(extensions.vector, int, float) to service_role;

-- ------------------------------------------------------ atomic rate limiter
create or replace function public.bump_rate_limit(p_key text, p_window timestamptz)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count int;
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, p_window, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into new_count;

  -- opportunistic cleanup of old windows
  delete from public.rate_limits where window_start < now() - interval '3 days';
  return new_count;
end;
$$;

revoke all on function public.bump_rate_limit(text, timestamptz) from public, anon, authenticated;
grant execute on function public.bump_rate_limit(text, timestamptz) to service_role;

-- ------------------------------------------------------------ storage buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('assessment-images', 'assessment-images', false, 8388608,
     array['image/jpeg','image/png','image/webp']),
  ('reports', 'reports', false, 10485760,
     array['application/pdf','image/jpeg','image/png','image/webp']),
  ('audio', 'audio', false, 10485760,
     array['audio/wav','audio/x-wav','audio/mpeg','audio/mp3','audio/aac','audio/ogg','audio/flac','audio/aiff','audio/webm','audio/mp4'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Users may only touch objects inside their own  <user_id>/  folder.
drop policy if exists "medimind_files_select_own" on storage.objects;
drop policy if exists "medimind_files_insert_own" on storage.objects;
drop policy if exists "medimind_files_delete_own" on storage.objects;

create policy "medimind_files_select_own" on storage.objects for select to authenticated
  using (bucket_id in ('assessment-images','reports','audio')
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy "medimind_files_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id in ('assessment-images','reports','audio')
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "medimind_files_delete_own" on storage.objects for delete to authenticated
  using (bucket_id in ('assessment-images','reports','audio')
         and (storage.foldername(name))[1] = auth.uid()::text);
