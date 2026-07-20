-- Keep the Home-visible review revision current when ordered media membership
-- changes without a direct update to the parent review row.

create or replace function public.touch_review_from_media_link_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_review_id uuid;
  v_new_review_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_review_id := old.review_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_review_id := new.review_id;
  end if;

  update public.reviews review
  set updated_at = clock_timestamp()
  where review.id = v_new_review_id
     or (v_old_review_id is distinct from v_new_review_id and review.id = v_old_review_id);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists touch_review_from_media_link_change_trigger on public.review_photos;
create trigger touch_review_from_media_link_change_trigger
after insert or update or delete on public.review_photos
for each row execute function public.touch_review_from_media_link_change();

revoke all on function public.touch_review_from_media_link_change() from public, anon, authenticated;
grant execute on function public.touch_review_from_media_link_change() to service_role;

comment on function public.touch_review_from_media_link_change() is
  'Advances the parent review revision when ordered media membership changes.';
