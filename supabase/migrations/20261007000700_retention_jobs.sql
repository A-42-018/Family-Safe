-- 32a — retention (prompt §45) and the stale-offline sweep, in ONE function so one schedule covers everything:
--   retention_run() → jsonb of how many rows each step removed/changed.
-- Steps (windows are mirrored in `packages/contracts/src/retention.ts`; a drift test compares them):
--   devices silent for 45 min        ONLINE → OFFLINE + DEVICE_OFFLINE event (the 29a-2 trigger notifies)
--   audit_logs                       180 days            (audit_purge_expired, 30a)
--   notifications                    90 days             (notifications_purge_expired, 29a-1)
--   device_events                    90 days
--   app_usage_daily, device_usage_daily   90 days (by usage_date, UTC)
--   location_points                  90 days = the longest choice of prompt §12; per-device 7/30/90 choices come with 22a
--   device_commands                  30 days after creation (they expire after 24 h)
--   device_credentials               30 days after the refresh token expired (reuse detection needs rows until then)
--   pairing_tokens                   7 days after they expired
-- SECURITY DEFINER, service_role only. Idempotent: a second run right after changes nothing.
-- Scheduling: when the pg_cron extension is already enabled this migration schedules the job every 15 minutes;
-- otherwise it only says so (the operator enables pg_cron once, see docs/SECURITY.md → Retention).

create or replace function public.retention_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out   jsonb := '{}'::jsonb;
  v_n     int;
  v_today date  := (now() at time zone 'UTC')::date;
begin
  v_out := v_out || jsonb_build_object('devices_marked_offline', public.device_mark_stale_offline());
  v_out := v_out || jsonb_build_object('audit_logs', public.audit_purge_expired());
  v_out := v_out || jsonb_build_object('notifications', public.notifications_purge_expired());

  with gone as (delete from public.device_events where created_at < now() - interval '90 days' returning 1)
  select count(*)::int into v_n from gone;
  v_out := v_out || jsonb_build_object('device_events', v_n);

  with gone as (delete from public.app_usage_daily where usage_date < v_today - 90 returning 1)
  select count(*)::int into v_n from gone;
  v_out := v_out || jsonb_build_object('app_usage_daily', v_n);

  with gone as (delete from public.device_usage_daily where usage_date < v_today - 90 returning 1)
  select count(*)::int into v_n from gone;
  v_out := v_out || jsonb_build_object('device_usage_daily', v_n);

  with gone as (delete from public.location_points where recorded_at < now() - interval '90 days' returning 1)
  select count(*)::int into v_n from gone;
  v_out := v_out || jsonb_build_object('location_points', v_n);

  with gone as (delete from public.device_commands where created_at < now() - interval '30 days' returning 1)
  select count(*)::int into v_n from gone;
  v_out := v_out || jsonb_build_object('device_commands', v_n);

  with gone as (delete from public.device_credentials where expires_at < now() - interval '30 days' returning 1)
  select count(*)::int into v_n from gone;
  v_out := v_out || jsonb_build_object('device_credentials', v_n);

  with gone as (delete from public.pairing_tokens where expires_at < now() - interval '7 days' returning 1)
  select count(*)::int into v_n from gone;
  v_out := v_out || jsonb_build_object('pairing_tokens', v_n);

  return v_out;
end;
$$;
revoke all on function public.retention_run() from public, anon, authenticated;
grant execute on function public.retention_run() to service_role;

do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('familysafe-retention', '*/15 * * * *', 'select public.retention_run()');
  else
    raise notice 'pg_cron is not enabled: schedule "select public.retention_run()" every 15 minutes (docs/SECURITY.md, Retention)';
  end if;
end $$;
