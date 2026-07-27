begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shared_memory_messages'
      and column_name = 'client_created_at'
      and data_type = 'timestamp with time zone'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shared_memory_messages'
      and column_name = 'client_sequence'
      and data_type = 'bigint'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shared_memory_messages'
      and column_name = 'client_order_key'
      and data_type = 'text'
  ),
  'Memory messages persist canonical client time, sequence, and order key'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.shared_memory_messages'::regclass
      and conname = 'shared_memory_messages_client_sequence_check'
      and convalidated
  ),
  'client sequence validation is installed and validated'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.shared_memory_messages'::regclass
      and conname = 'shared_memory_messages_client_order_key_check'
      and convalidated
  ),
  'client order-key validation is installed and validated'
);

select ok(
  to_regclass('public.shared_memory_messages_client_order_idx') is not null,
  'client ordering has a bounded room-scoped index'
);

select ok(
  to_regprocedure(
    'public.shared_memory_chat_page_v2(uuid,timestamp with time zone,uuid,integer)'
  ) is not null
  and to_regprocedure(
    'public.shared_memory_room_bootstrap_v2(uuid,integer)'
  ) is not null
  and to_regprocedure(
    'public.shared_memory_room_sync_v2(uuid,bigint,integer)'
  ) is not null,
  'member-scoped chat, bootstrap, and sync v2 RPCs exist'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.shared_memory_chat_page_v2(uuid,timestamp with time zone,uuid,integer)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.shared_memory_room_bootstrap_v2(uuid,integer)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.shared_memory_room_sync_v2(uuid,bigint,integer)',
    'execute'
  ),
  'authenticated members can execute the member-scoped v2 read RPCs'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.shared_memory_enrich_message_metadata_v1(jsonb)',
    'execute'
  ),
  'authenticated clients cannot execute the internal metadata enrichment helper'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.attach_shared_memory_media_assets_v2(uuid,uuid,text,text,uuid,text,timestamp with time zone,bigint,text,uuid[])',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.attach_shared_memory_media_assets_v2(uuid,uuid,text,text,uuid,text,timestamp with time zone,bigint,text,uuid[])',
    'execute'
  ),
  'atomic media attachment remains service-role-only'
);

select * from finish();
rollback;
