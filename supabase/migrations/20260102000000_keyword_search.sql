-- Groq has no embedding model, so RAG uses Postgres full-text search instead of pgvector.
-- (The vector column from the first migration is kept but unused, so this is safe to apply on top of it.)

alter table public.knowledge_chunks
  add column if not exists fts tsvector
  generated always as (to_tsvector('english', coalesce(content, ''))) stored;

create index if not exists knowledge_chunks_fts_idx on public.knowledge_chunks using gin (fts);

create or replace function public.search_chunks(q text, k int default 4, min_rank float default 0.05)
returns table (id bigint, source text, url text, content text, rank float)
language sql
stable
set search_path = public
as $$
  with terms as (
    select string_agg(distinct w, ' | ') as tq
    from regexp_split_to_table(lower(regexp_replace(q, '[^a-zA-Z ]', ' ', 'g')), '\s+') as w
    where length(w) >= 4
  )
  select kc.id, kc.source, kc.url, kc.content,
         ts_rank(kc.fts, to_tsquery('english', t.tq))::float as rank
  from public.knowledge_chunks kc, terms t
  where t.tq is not null
    and kc.fts @@ to_tsquery('english', t.tq)
    and ts_rank(kc.fts, to_tsquery('english', t.tq)) >= min_rank
  order by rank desc
  limit greatest(k, 1);
$$;

revoke all on function public.search_chunks(text, int, float) from public, anon, authenticated;
grant execute on function public.search_chunks(text, int, float) to service_role;
