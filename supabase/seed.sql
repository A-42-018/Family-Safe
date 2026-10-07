-- LOCAL DEV ONLY (runs on `supabase db reset`). Never applied to hosted projects.
-- Login: parent@example.test / Dev-Only-Passw0rd!
do $$
declare
  v_parent uuid := '00000000-0000-4000-8000-000000000001';
  v_family uuid := '00000000-0000-4000-8000-000000000010';
  v_child  uuid := '00000000-0000-4000-8000-000000000020';
  v_device uuid := '00000000-0000-4000-8000-000000000030';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_parent, 'authenticated', 'authenticated',
    'parent@example.test', extensions.crypt('Dev-Only-Passw0rd!', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"full_name":"Dev Parent"}', now(), now(),
    '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_parent, v_parent::text,
          jsonb_build_object('sub', v_parent::text, 'email', 'parent@example.test'),
          'email', now(), now(), now());
  -- profile row is created by the on_auth_user_created trigger

  insert into public.families (id, parent_id, name) values (v_family, v_parent, 'Dev Family');
  insert into public.children (id, family_id, name, date_of_birth) values (v_child, v_family, 'Dev Child', date '2014-05-01');
  insert into public.devices (id, child_id, device_name, manufacturer, model, android_version, app_version,
                              device_status, enrollment_status, battery_level, is_charging, network_type, last_seen_at)
  values (v_device, v_child, 'Dev Pixel', 'Google', 'Pixel 8', '14', '0.1.0',
          'ONLINE', 'ENROLLED', 80, false, 'WIFI', now());
  -- device_rules / device_permissions rows are created by the on_device_created trigger
  update public.device_rules set daily_screen_limit_minutes = 120 where device_id = v_device;
  insert into public.app_rules (device_id, package_name, app_name, blocked, daily_limit_minutes)
  values (v_device, 'com.google.android.youtube', 'YouTube', false, 30);
  insert into public.schedules (device_id, name, type, start_time, end_time, days)
  values (v_device, 'School', 'SCHOOL', '08:00', '15:00', '{1,2,3,4,5}');
  insert into public.device_usage_daily (device_id, usage_date, total_screen_minutes, unlock_count)
  values (v_device, current_date, 95, 22);
  insert into public.app_usage_daily (device_id, package_name, usage_date, foreground_minutes, launch_count)
  values (v_device, 'com.google.android.youtube', current_date, 28, 4);
end $$;
