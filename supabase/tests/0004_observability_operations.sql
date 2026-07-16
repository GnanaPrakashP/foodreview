begin;
select plan(31);

select has_table('public', 'push_delivery_jobs', 'durable push queue exists');
select has_table('public', 'operational_scheduler_heartbeats', 'scheduler heartbeat table exists');
select has_table('public', 'operational_scheduler_runs', 'bounded scheduler history exists');
select has_column('public', 'push_tokens', 'disabled_at', 'push tokens support invalid-token disablement');
select has_column('public', 'push_tokens', 'disabled_reason', 'push token disablement stores a safe reason');
select has_column('public', 'push_delivery_jobs', 'provider_ticket_id', 'push tickets are durable');
select has_column('public', 'push_delivery_jobs', 'receipt_attempts', 'receipt retries are durable');
select has_column('public', 'push_delivery_jobs', 'correlation_id', 'push jobs carry correlation identifiers');

select ok((select relrowsecurity from pg_class where oid = 'public.push_delivery_jobs'::regclass), 'push queue has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.operational_scheduler_heartbeats'::regclass), 'scheduler heartbeat table has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.operational_scheduler_runs'::regclass), 'scheduler run table has RLS');
select ok(not has_table_privilege('authenticated', 'public.push_delivery_jobs', 'SELECT'), 'authenticated clients cannot inspect push operations');
select ok(not has_table_privilege('anon', 'public.operational_scheduler_runs', 'SELECT'), 'anonymous clients cannot inspect scheduler operations');
select ok(has_table_privilege('service_role', 'public.push_delivery_jobs', 'SELECT'), 'service role can process push jobs');

select has_function('public', 'claim_push_delivery_jobs', array['text', 'integer', 'integer'], 'atomic push send claim exists');
select has_function('public', 'complete_push_delivery_ticket', array['uuid', 'uuid', 'text', 'integer'], 'durable ticket completion exists');
select has_function('public', 'fail_push_delivery_send', array['uuid', 'uuid', 'text', 'boolean'], 'bounded push send failure exists');
select has_function('public', 'claim_push_receipt_jobs', array['text', 'integer', 'integer'], 'atomic receipt claim exists');
select has_function('public', 'complete_push_delivery_receipt', array['uuid', 'uuid', 'text', 'text'], 'receipt outcome completion exists');
select has_function('public', 'record_scheduler_run', array['text', 'uuid', 'text', 'text', 'timestamp with time zone', 'integer', 'text', 'text'], 'scheduler run heartbeat exists');
select has_function('public', 'production_operations_health', array[]::text[], 'read-only production operations health exists');
select has_function('public', 'production_operations_contract', array[]::text[], 'operations drift contract exists');
select has_function('public', 'reconcile_push_delivery_jobs', array['boolean', 'integer'], 'dry-run/apply push reconciliation exists');

select ok(
  has_function_privilege('authenticated', 'public.production_operations_health()', 'EXECUTE')
  and (select position('service_role_required' in routine.prosrc) > 0 from pg_catalog.pg_proc routine where routine.oid = 'public.production_operations_health()'::regprocedure),
  'authenticated operations-health calls reach only the stable service-role guard'
);
select ok(
  has_function_privilege('anon', 'public.reconcile_push_delivery_jobs(boolean,integer)', 'EXECUTE')
  and (select position('service_role_required' in routine.prosrc) > 0 from pg_catalog.pg_proc routine where routine.oid = 'public.reconcile_push_delivery_jobs(boolean,integer)'::regprocedure),
  'anonymous reconciliation calls reach only the stable service-role guard'
);
select ok(has_function_privilege('service_role', 'public.production_operations_health()', 'EXECUTE'), 'service role can execute operations health');
select ok(has_function_privilege('service_role', 'public.reconcile_push_delivery_jobs(boolean,integer)', 'EXECUTE'), 'service role can reconcile push jobs');

select has_index('public', 'push_delivery_jobs', 'push_delivery_jobs_send_claim_idx', 'push send claim index exists');
select has_index('public', 'push_delivery_jobs', 'push_delivery_jobs_receipt_claim_idx', 'push receipt claim index exists');
select has_index('public', 'operational_scheduler_runs', 'operational_scheduler_runs_job_created_idx', 'scheduler history lookup index exists');

select set_config('request.jwt.claim.role', 'service_role', true) = 'service_role';
select is((public.production_operations_contract()->'missingTables')::text, '[]', 'operations contract has no missing tables');

select * from finish();
rollback;
