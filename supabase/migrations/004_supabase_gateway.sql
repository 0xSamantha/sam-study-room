-- Run once after 001–003. Moves the usage guard from Cloudflare into this database.
-- Existing room features and website tables are preserved. Reopening is an explicit owner action.
begin;
create table if not exists study_private.guard(
 id integer primary key check(id=1),
 invite text not null default gen_random_uuid()::text,
 cycle date not null default (now() at time zone 'UTC')::date,
 paused boolean not null default true,
 reason text not null default 'Backend migration completed. Owner review required.',
 warn numeric not null default 90,
 stop numeric not null default 97,
 buffer numeric not null default 2,
 counts jsonb not null default '{"requests":0,"storageWrites":0,"realtime":0,"egress":0,"emails":0}',
 checked timestamptz not null default now()
);
insert into study_private.guard(id) values(1) on conflict do nothing;
alter table study_private.guard enable row level security;
revoke all on study_private.guard from public,anon,authenticated;
create table if not exists study_private.warnings(
 event_key text primary key, quota text not null, message text not null,
 status text not null default 'pending', created_at timestamptz not null default now()
);
alter table study_private.warnings enable row level security;
revoke all on study_private.warnings from public,anon,authenticated;
create or replace function public.study_gateway(p_action text,p_owner boolean default false,p_invite text default null,p_uid uuid default null,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare g study_private.guard; q record; used numeric; projected numeric; percent numeric; db_size bigint; reset_at timestamptz; readings jsonb:='[]'; warnings jsonb; result jsonb; costs jsonb; blocked boolean:=false; msg text; cycle_key text;
begin
 select * into g from study_private.guard where id=1 for update;
 if p_action like 'owner%' then
  if not p_owner then return jsonb_build_object('error','Owner access required','status',401); end if;
 elsif p_invite is distinct from g.invite then return jsonb_build_object('error','A valid invitation is required','status',403);
 end if;
 if g.paused and p_action not in ('owner','owner/pause','owner/resume','owner/settings','owner/refresh','owner/rotate') then return jsonb_build_object('paused',true,'error',g.reason,'status',423);end if;
 if g.cycle<>(now() at time zone 'UTC')::date then
  g.cycle:=(now() at time zone 'UTC')::date;
  g.counts:='{"requests":0,"storageWrites":0,"realtime":0,"egress":0,"emails":0}';
 end if;
 if p_action='owner/settings' then
  if coalesce(p_payload->>'warn','')!~ '^[0-9]+([.][0-9]+)?$' or coalesce(p_payload->>'stop','')!~ '^[0-9]+([.][0-9]+)?$' or coalesce(p_payload->>'buffer','')!~ '^[0-9]+([.][0-9]+)?$' then return jsonb_build_object('error','Enter numeric thresholds','status',400);end if;
  g.warn:=(p_payload->>'warn')::numeric;g.stop:=(p_payload->>'stop')::numeric;g.buffer:=(p_payload->>'buffer')::numeric;
  if g.warn<1 or g.stop>97 or g.buffer<1 or g.buffer>20 or g.warn>=g.stop-g.buffer then return jsonb_build_object('error','Warning must be below pause minus reserve; pause ≤ 97; reserve 1–20','status',400);end if;
 end if;
 costs:=case when p_action in ('owner','owner/pause','owner/settings','owner/refresh','owner/rotate') then '{}'::jsonb else '{"requests":1,"storageWrites":4,"realtime":12,"egress":2097152}'::jsonb end;
 db_size:=pg_database_size(current_database());
 reset_at:=((g.cycle+1)::timestamp at time zone 'UTC');
 for q in select * from (values
  ('requests','Room API request budget',10000::numeric),
  ('storageWrites','Database write reservations',10000::numeric),
  ('realtime','Real-time delivery reservations',20000::numeric),
  ('egress','Egress byte reservations',100000000::numeric),
  ('emails','Warning email budget',20::numeric),
  ('database','Supabase database bytes',500000000::numeric)
 ) as x(key,name,lim) loop
  used:=case when q.key='database' then db_size else coalesce((g.counts->>q.key)::numeric,0) end;
  projected:=used+coalesce((costs->>q.key)::numeric,0);percent:=projected/q.lim*100;
  cycle_key:=q.key||':'||case when q.key='database' then 'capacity' else reset_at::text end;
  if percent>=g.warn then
   msg:=q.name||': '||used||' of '||q.lim||' used; '||greatest(0,q.lim-used)||' remains. Reset: '||case when q.key='database' then 'capacity does not reset' else reset_at::text end;
   insert into study_private.warnings(event_key,quota,message) values(cycle_key,q.key,msg) on conflict do nothing;
  end if;
  if percent+g.buffer>=g.stop then blocked:=true;g.reason:=q.name||' reached the buffered pause threshold.';end if;
  readings:=readings||jsonb_build_array(jsonb_build_object('key',q.key,'name',q.name,'used',used,'limit',q.lim,'percent',used/q.lim*100,'resets',case when q.key='database' then null else reset_at end,'checked',now(),'note',case when q.key='database' then 'Measured database capacity; includes the personal website.' else 'Conservative daily app reservation, not account-wide provider billing.' end));
 end loop;
 if blocked then g.paused:=true;end if;
 if p_action='owner/pause' then g.paused:=true;g.reason:='Paused by the owner';end if;
 if p_action='owner/rotate' then g.invite:=gen_random_uuid()::text;g.paused:=true;g.reason:='Invitation replaced. Owner review required.';perform public.study_command('revoke');end if;
 if p_action='owner/resume' and not blocked then g.paused:=false;g.reason:='';perform public.study_command('resume');end if;
 if g.paused then
  -- Only publish once when transitioning; rejected requests do not rewrite room state.
  if coalesce((select (payload->>'paused')::boolean from public.study_room where id=1),false)=false then perform public.study_command('pause');end if;
 end if;
 g.checked:=now();
 if not g.paused then
  for q in select * from jsonb_each_text(costs) loop g.counts:=jsonb_set(g.counts,array[q.key],to_jsonb(coalesce((g.counts->>q.key)::numeric,0)+q.value::numeric));end loop;
 end if;
 update study_private.guard set invite=g.invite,cycle=g.cycle,paused=g.paused,reason=g.reason,warn=g.warn,stop=g.stop,buffer=g.buffer,counts=g.counts,checked=g.checked where id=1;
 if p_action='owner' then
  select coalesce(jsonb_agg(jsonb_build_object('id',event_key,'text',message,'status',status) order by created_at desc),'[]') into warnings from (select * from study_private.warnings order by created_at desc limit 30) x;
  return jsonb_build_object('invite',g.invite,'databasePaused',g.paused,'timer',(select payload->'timer' from public.study_room where id=1),'budget',jsonb_build_object('paused',g.paused,'reason',g.reason,'warn',g.warn,'stop',g.stop,'buffer',g.buffer,'counts',g.counts,'outbox',warnings),'meters',readings);
 end if;
 if p_action in ('owner/pause','owner/settings','owner/refresh','owner/rotate') then return jsonb_build_object('ok',true);end if;
 if p_action='owner/resume' then
  if g.paused then return jsonb_build_object('error',g.reason,'status',409);end if;
  return jsonb_build_object('ok',true);
 end if;
 if g.paused then return jsonb_build_object('paused',true,'error',g.reason,'status',423);end if;
 if p_action='status' then return jsonb_build_object('paused',false,'configured',true);end if;
 if p_action='schedule' then return jsonb_build_object('sessions',public.study_schedule());end if;
 if p_action='owner/schedule' then
  if coalesce(p_payload->>'type','') not in ('scheduleAdd','scheduleRemove') then return jsonb_build_object('error','Unknown schedule action','status',400);end if;
  result:=public.study_command(p_payload->>'type',null,null,true,p_payload);
 elsif p_action='owner/timers' then result:=public.study_command('timerSettings',null,null,true,p_payload);
 elsif p_action='join' then
  if p_uid is null then return jsonb_build_object('error','Sign in to take a seat','status',401);end if;
  result:=public.study_command('join',p_uid,p_payload->>'name',p_owner,p_payload);
 elsif p_action='action' then
  if p_uid is null then return jsonb_build_object('error','Session expired. Please rejoin.','status',401);end if;
  if coalesce(p_payload->>'type','') not in ('chat','start','pauseTimer','reset','mode','heartbeat','leave','seat','color','queueAdd','queueRemove','queueNext') then return jsonb_build_object('error','Unknown action','status',400);end if;
  result:=public.study_command(p_payload->>'type',p_uid,null,p_owner,p_payload);
 else return jsonb_build_object('error','Unknown endpoint','status',404);
 end if;
 if result?'error' then return result||jsonb_build_object('status',case when result?'paused' then 423 else 400 end);end if;
 return result;
end;
$$;
revoke all on function public.study_gateway(text,boolean,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.study_gateway(text,boolean,text,uuid,jsonb) to service_role;
create or replace function public.study_warning_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare w study_private.warnings;
begin
 perform 1 from study_private.guard where id=1 for update;
 if (select coalesce((counts->>'emails')::integer,0)>=18 from study_private.guard where id=1) then return null;end if;
 select * into w from study_private.warnings where status='pending' order by created_at limit 1 for update skip locked;
 if not found then return null;end if;
 update study_private.warnings set status='sending' where event_key=w.event_key;
 update study_private.guard set counts=jsonb_set(counts,'{emails}',to_jsonb(coalesce((counts->>'emails')::integer,0)+1)) where id=1;
 return jsonb_build_object('id',w.event_key,'text',w.message);
end;
$$;
create or replace function public.study_warning_finish(p_id text,p_status text) returns void language sql security definer set search_path='' as $$
 update study_private.warnings set status=left(p_status,120) where event_key=p_id and status='sending';
$$;
revoke all on function public.study_warning_claim() from public,anon,authenticated;
revoke all on function public.study_warning_finish(text,text) from public,anon,authenticated;
grant execute on function public.study_warning_claim() to service_role;
grant execute on function public.study_warning_finish(text,text) to service_role;
update study_private.guard set paused=true,reason='Backend migration completed. Owner review required.' where id=1;
do $$ begin perform public.study_command('pause');end $$;
commit;
