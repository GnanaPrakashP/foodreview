-- Ranked, indexed profile search for people pickers.
-- Run against the same Supabase project used by the mobile app.

create extension if not exists pg_trgm with schema extensions;

create index if not exists profiles_username_trgm_idx
  on public.profiles using gin (username gin_trgm_ops);

create index if not exists profiles_first_name_trgm_idx
  on public.profiles using gin (first_name gin_trgm_ops);

create index if not exists profiles_last_name_trgm_idx
  on public.profiles using gin (last_name gin_trgm_ops);

create index if not exists profiles_full_name_trgm_idx
  on public.profiles using gin ((lower(first_name || ' ' || last_name)) gin_trgm_ops);

create or replace function public.search_user_profiles(
  p_query text,
  p_excluded_usernames text[] default '{}'::text[],
  p_limit integer default 8
)
returns table(username text, first_name text, last_name text)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with normalized as (
    select
      regexp_replace(
        regexp_replace(
          lower(regexp_replace(btrim(coalesce(p_query, '')), '^@+', '')),
          '[^a-z0-9_[:space:]]',
          ' ',
          'g'
        ),
        '[[:space:]]+',
        ' ',
        'g'
      ) as q,
      array(
        select lower(regexp_replace(btrim(value), '^@+', ''))
        from unnest(coalesce(p_excluded_usernames, '{}'::text[])) as value
        where nullif(btrim(value), '') is not null
      ) as excluded,
      least(greatest(coalesce(p_limit, 8), 1), 20) as result_limit
  ),
  prepared as (
    select
      btrim(q) as q,
      '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as like_q,
      excluded,
      result_limit
    from normalized
  )
  select p.username, p.first_name, p.last_name
  from public.profiles p
  cross join prepared s
  where length(s.q) >= 2
    and not (p.username = any(s.excluded))
    and (
      p.username ilike s.like_q escape '\'
      or p.first_name ilike s.like_q escape '\'
      or p.last_name ilike s.like_q escape '\'
      or lower(p.first_name || ' ' || p.last_name) like s.like_q escape '\'
      or similarity(p.username, s.q) > 0.24
      or similarity(lower(p.first_name || ' ' || p.last_name), s.q) > 0.24
    )
  order by
    case
      when p.username = s.q then 0
      when p.username like s.q || '%' then 1
      when lower(p.first_name || ' ' || p.last_name) = s.q then 2
      when lower(p.first_name || ' ' || p.last_name) like s.q || '%' then 3
      when p.first_name ilike s.like_q escape '\' then 4
      when p.last_name ilike s.like_q escape '\' then 5
      else 6
    end,
    greatest(
      similarity(p.username, s.q),
      similarity(p.first_name, s.q),
      similarity(p.last_name, s.q),
      similarity(lower(p.first_name || ' ' || p.last_name), s.q)
    ) desc,
    p.username asc
  limit (select result_limit from prepared);
$$;

grant execute on function public.search_user_profiles(text, text[], integer) to authenticated;
