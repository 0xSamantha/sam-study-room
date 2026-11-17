-- Run after migrations 001 and 002. Preserves existing seats, schedules and website data.
begin;
create or replace function public.study_command(p_action text,p_uid uuid default null,p_name text default null,p_owner boolean default false,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb; t jsonb; msgs jsonb; stamp bigint; n integer; member study_private.members; r jsonb; chosen integer; led text; start_at timestamptz; end_at timestamptz; zone text; queue jsonb; item jsonb; focus_ms bigint; break_ms bigint;
begin
 select payload into s from public.study_room where id=1 for update;
 stamp := floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if p_action='revoke' then delete from study_private.members; s:=jsonb_set(s,'{paused}','true');
 elsif p_action='pause' then s:=jsonb_set(s,'{paused}','true');
 elsif p_action='resume' then s:=jsonb_set(s,'{paused}','false');
 else
  if (s->>'paused')::boolean then return jsonb_build_object('paused',true,'error','Study room paused'); end if;
  if p_action='timerSettings' then
   if not p_owner then return jsonb_build_object('error','Only the owner can edit timer durations'); end if;
   if coalesce(p_payload->>'focusMinutes','') !~ '^[0-9]{1,3}$' or coalesce(p_payload->>'breakMinutes','') !~ '^[0-9]{1,3}$' then return jsonb_build_object('error','Use whole minutes between 1 and 240'); end if;
   focus_ms:=(p_payload->>'focusMinutes')::bigint*60000; break_ms:=(p_payload->>'breakMinutes')::bigint*60000;
   if focus_ms not between 60000 and 14400000 or break_ms not between 60000 and 14400000 then return jsonb_build_object('error','Use whole minutes between 1 and 240'); end if;
   t:=(s->'timer')||jsonb_build_object('focusMs',focus_ms,'breakMs',break_ms,'end',null,'remaining',case when s->'timer'->>'mode'='break' then break_ms else focus_ms end);
   s:=jsonb_set(s,'{timer}',t);
  elsif p_action in ('scheduleAdd','scheduleRemove') then
   if not p_owner then return jsonb_build_object('error','Only the owner can manage the schedule'); end if;
   if p_action='scheduleAdd' then
    if coalesce(length(trim(p_payload->>'title')),0) not between 1 and 80 or coalesce(length(p_payload->>'notes'),0)>300 then return jsonb_build_object('error','Use a title of 1–80 characters and notes up to 300 characters'); end if;
    start_at:=(p_payload->>'startsAt')::timestamptz; end_at:=(p_payload->>'endsAt')::timestamptz; zone:=p_payload->>'timezone';
    if start_at is null or end_at is null or start_at<now()-interval '1 minute' or end_at<=start_at or end_at>start_at+interval '12 hours' then return jsonb_build_object('error','Choose a future start and an end within twelve hours'); end if;
    if not exists(select 1 from pg_timezone_names where name=zone) then return jsonb_build_object('error','Choose a valid timezone'); end if;
    delete from study_private.sessions where ends_at<now()-interval '1 day';
    if (select count(*) from study_private.sessions)>=24 then return jsonb_build_object('error','You can publish up to 24 sessions'); end if;
    insert into study_private.sessions(title,starts_at,ends_at,timezone,notes) values(trim(p_payload->>'title'),start_at,end_at,zone,coalesce(p_payload->>'notes',''));
   else delete from study_private.sessions where id=(p_payload->>'id')::uuid;
   end if;
  elsif p_action='join' then
   delete from study_private.members where seen_at<now()-interval '3 minutes';
   select count(*) into n from study_private.members;
   if n>=12 and not exists(select 1 from study_private.members where user_id=p_uid) then return jsonb_build_object('error','All twelve seats are taken'); end if;
   if p_uid is null or length(trim(p_name)) not between 1 and 32 then return jsonb_build_object('error','Valid user and name required'); end if;
   led:=case when p_owner then '#ff5ca8' else lower(coalesce(p_payload->>'color','#59b8ff')) end;
   if not p_owner and led not in ('#59b8ff','#66db9b','#ffc65b','#b995ff','#56dce2','#ff965b') then return jsonb_build_object('error','Choose one of the available LED colors'); end if;
   chosen:=(p_payload->>'seat')::integer;
   if chosen is null then select seat into chosen from study_private.members where user_id=p_uid; end if;
   if chosen is null then select x into chosen from generate_series(0,11) as x where not exists(select 1 from study_private.members where seat=x) order by x limit 1; end if;
   if chosen is null then return jsonb_build_object('error','All seats are taken'); end if;
   if chosen not between 0 and 11 then return jsonb_build_object('error','Choose a seat between 1 and 12'); end if;
   if exists(select 1 from study_private.members where seat=chosen and user_id<>p_uid) then return jsonb_build_object('error','Someone just took that seat. Please choose another.'); end if;
   insert into study_private.members(user_id,name,is_owner,seat,color) values(p_uid,trim(p_name),p_owner,chosen,led)
   on conflict(user_id) do update set name=excluded.name,is_owner=excluded.is_owner,seat=excluded.seat,color=excluded.color,seen_at=now();
  else
   select * into member from study_private.members where user_id=p_uid and seen_at>now()-interval '3 minutes';
   if not found then return jsonb_build_object('error','Join the room first'); end if;
   if p_action='leave' then delete from study_private.members where user_id=p_uid;
   elsif p_action='seat' then
    chosen:=(p_payload->>'seat')::integer;
    if chosen is null or chosen not between 0 and 11 then return jsonb_build_object('error','Choose an available seat'); end if;
    if exists(select 1 from study_private.members where seat=chosen and user_id<>p_uid) then return jsonb_build_object('error','Someone just took that seat. Please choose another.'); end if;
    update study_private.members set seat=chosen,seen_at=now() where user_id=p_uid;
   elsif p_action='color' then
    led:=case when p_owner then '#ff5ca8' else lower(p_payload->>'color') end;
    if led is null or led not in ('#ff5ca8','#59b8ff','#66db9b','#ffc65b','#b995ff','#56dce2','#ff965b') or (not p_owner and led='#ff5ca8') then return jsonb_build_object('error','Choose an available LED color'); end if;
    update study_private.members set color=led,seen_at=now() where user_id=p_uid;
   elsif p_action='heartbeat' then update study_private.members set seen_at=now() where user_id=p_uid;
   else
    if member.last_action>now()-interval '1 second' then return jsonb_build_object('error','Please wait a moment'); end if;
    update study_private.members set last_action=now(),seen_at=now() where user_id=p_uid;
    t:=s->'timer';
    if p_action in ('queueAdd','queueRemove','queueNext') then
     queue:=coalesce(s->'queue','[]'::jsonb);
     if p_action='queueAdd' then
      if coalesce(p_payload->>'videoId','') !~ '^[A-Za-z0-9_-]{11}$' then return jsonb_build_object('error','Invalid YouTube video'); end if;
      if jsonb_array_length(queue)>=20 then return jsonb_build_object('error','The queue holds up to 20 videos'); end if;
      if exists(select 1 from jsonb_array_elements(queue) q where q->>'videoId'=p_payload->>'videoId') then return jsonb_build_object('error','That video is already in the queue'); end if;
      if coalesce(length(p_payload->>'title'),0)>80 then return jsonb_build_object('error','Use a title up to 80 characters'); end if;
      queue:=queue||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'videoId',p_payload->>'videoId','title',coalesce(nullif(trim(p_payload->>'title'),''),'YouTube video'),'addedBy',member.name,'userId',p_uid));
     elsif p_action='queueNext' then
      if not p_owner then return jsonb_build_object('error','Only the owner can advance the queue'); end if;
      queue:=queue-0;
     else
      select q into item from jsonb_array_elements(queue) q where q->>'id'=p_payload->>'id';
      if item is null then return jsonb_build_object('error','Video is no longer in the queue'); end if;
      if not p_owner and item->>'userId'<>p_uid::text then return jsonb_build_object('error','You can only remove videos you added'); end if;
      select coalesce(jsonb_agg(q order by ord),'[]'::jsonb) into queue from jsonb_array_elements(queue) with ordinality x(q,ord) where q->>'id'<>p_payload->>'id';
     end if;
     s:=jsonb_set(s,'{queue}',queue);
    elsif p_action='chat' then
     if length(trim(p_payload->>'text')) not between 1 and 500 then return jsonb_build_object('error','Notes must contain 1 to 500 characters'); end if;
     msgs:=s->'messages'||jsonb_build_array(jsonb_build_object('name',member.name,'text',trim(p_payload->>'text'),'time',stamp));
     select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into msgs from jsonb_array_elements(msgs) with ordinality as x(value,ord) where ord>jsonb_array_length(msgs)-30;
     s:=jsonb_set(s,'{messages}',msgs);
    elsif not p_owner or not member.is_owner then return jsonb_build_object('error','Only the owner can control the timer');
    elsif p_action='start' then
     if t->>'end' is null then t:=jsonb_set(t,'{end}',to_jsonb(stamp+(t->>'remaining')::bigint)); end if;
    elsif p_action='pauseTimer' then
     if t->>'end' is not null then t:=jsonb_set(t,'{remaining}',to_jsonb(greatest(0,(t->>'end')::bigint-stamp))); end if;
     t:=jsonb_set(t,'{end}','null');
    elsif p_action='reset' then t:=jsonb_set(jsonb_set(t,'{end}','null'),'{remaining}',to_jsonb(case when t->>'mode'='focus' then coalesce((t->>'focusMs')::bigint,1500000) else coalesce((t->>'breakMs')::bigint,300000) end));
    elsif p_action='mode' and p_payload->>'mode' in ('focus','break') then t:=t||jsonb_build_object('mode',p_payload->>'mode','remaining',case when p_payload->>'mode'='focus' then coalesce((t->>'focusMs')::bigint,1500000) else coalesce((t->>'breakMs')::bigint,300000) end,'end',null);
    else return jsonb_build_object('error','Unknown action'); end if;
    s:=jsonb_set(s,'{timer}',t);
   end if;
  end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',user_id,'name',name,'owner',is_owner,'seat',seat,'color',case when is_owner then '#ff5ca8' else color end) order by name),'[]') into r from study_private.members where seen_at>now()-interval '3 minutes';
 s:=jsonb_set(jsonb_set(s,'{members}',r),'{serverTime}',to_jsonb(stamp));
 s:=jsonb_set(s,'{sessions}',public.study_schedule());
 update public.study_room set payload=s,updated_at=now() where id=1;
 return s;
end;
$$;
revoke all on function public.study_command(text,uuid,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.study_command(text,uuid,text,boolean,jsonb) to service_role;
commit;
