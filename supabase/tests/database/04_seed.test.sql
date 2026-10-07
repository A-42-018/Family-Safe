begin;
select plan(5);
select is((select count(*)::int from public.profiles where email = 'parent@example.test'), 1, 'seed: profile via trigger');
select is((select count(*)::int from public.devices where enrollment_status = 'ENROLLED'), 1, 'seed: enrolled device');
select is((select daily_screen_limit_minutes from public.device_rules limit 1), 120, 'seed: rules updated');
select is((select count(*)::int from public.device_permissions), 1, 'seed: permissions row');
select is((select count(*)::int from public.location_points), 0, 'seed: no location data');
select * from finish();
rollback;
