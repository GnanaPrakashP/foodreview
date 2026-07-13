-- Enable fast cross-device updates for Table Memory rooms.

alter table public.shared_memory_rooms replica identity full;
alter table public.shared_memory_messages replica identity full;
alter table public.shared_memory_photos replica identity full;
alter table public.shared_memory_dishes replica identity full;
alter table public.shared_memory_members replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_memory_rooms'
  ) then
    alter publication supabase_realtime add table public.shared_memory_rooms;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_memory_messages'
  ) then
    alter publication supabase_realtime add table public.shared_memory_messages;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_memory_photos'
  ) then
    alter publication supabase_realtime add table public.shared_memory_photos;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_memory_dishes'
  ) then
    alter publication supabase_realtime add table public.shared_memory_dishes;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_memory_members'
  ) then
    alter publication supabase_realtime add table public.shared_memory_members;
  end if;
end $$;
