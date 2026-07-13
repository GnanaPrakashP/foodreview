-- Link Table Memory messages as replies to earlier room messages.

alter table public.shared_memory_messages
  add column if not exists reply_to_message_id uuid references public.shared_memory_messages(id) on delete set null;

create index if not exists shared_memory_messages_reply_idx
  on public.shared_memory_messages(reply_to_message_id);
