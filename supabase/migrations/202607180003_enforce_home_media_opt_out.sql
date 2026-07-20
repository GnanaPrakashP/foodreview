-- New reviews opt into the ready-media guard by default. Only the service role
-- or direct database administrators may create/repair a legacy opt-out row;
-- authenticated clients cannot bypass publication by sending false explicitly.

alter table public.reviews
  alter column requires_ready_media set default true;

create or replace function private.prevent_untrusted_published_media_opt_out_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'active'
     and not new.requires_ready_media
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'published_review_media_guard_cannot_be_disabled' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_untrusted_published_media_opt_out_v1() from public, anon, authenticated;

drop trigger if exists reviews_prevent_untrusted_media_opt_out_v1 on public.reviews;
create trigger reviews_prevent_untrusted_media_opt_out_v1
before insert or update of status, requires_ready_media on public.reviews
for each row execute function private.prevent_untrusted_published_media_opt_out_v1();
