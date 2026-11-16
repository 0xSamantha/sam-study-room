-- Run this entire file once in the Supabase SQL editor.
-- Adds only study-room objects; existing website tables and Auth settings stay unchanged.
-- Any conflict aborts the installation rather than leaving a partial setup.
begin;
create schema study_private;
revoke all on schema study_private from public, anon, authenticated;
create table study_private.members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 32),
 is_owner boolean not null default false,
 seen_at timestamptz not null default now(),
 last_action timestamptz
);
create table public.study_room (
 id integer primary key check(id=1),
 payload jsonb not null,
 updated_at timestamptz not null default now()
);
insert into public.study_room values(1,'{"timer":{"mode":"focus","remaining":1500000,"end":null},"messages":[],"members":[],"paused":true,"serverTime":0}',now());
alter table public.study_room enable row level security;
alter table study_private.members enable row level security;
revoke all on public.study_room from anon,authenticated;
grant select on public.study_room to authenticated;
create function public.study_can_read() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from study_private.members where user_id=auth.uid() and seen_at>now()-interval '3 minutes');
$$;
revoke all on function public.study_can_read() from public,anon;
grant execute on function public.study_can_read() to authenticated;
create policy member_read on public.study_room for select to authenticated using(public.study_can_read());
-- Transaction lock gives one order to simultaneous joins/actions, independently of Worker serialization.
create function public.study_command(p_action text,p_uid uuid default null,p_name text default null,p_owner boolean default false,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb; t jsonb; msgs jsonb; stamp bigint; n integer; member study_private.members; r jsonb;
begin
 select payload into s from public.study_room where id=1 for update;
 stamp := floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if p_action='revoke' then delete from study_private.members; s:=jsonb_set(s,'{paused}','true');
 elsif p_action='pause' then s:=jsonb_set(s,'{paused}','true');
 elsif p_action='resume' then s:=jsonb_set(s,'{paused}','false');
 else
  if (s->>'paused')::boolean then return jsonb_build_object('paused',true,'error','Study room paused'); end if;
  if p_action='join' then
   delete from study_private.members where seen_at<now()-interval '3 minutes';
   select count(*) into n from study_private.members;
   if n>=12 and not exists(select 1 from study_private.members where user_id=p_uid) then return jsonb_build_object('error','All twelve seats are taken'); end if;
   if p_uid is null or length(trim(p_name)) not between 1 and 32 then return jsonb_build_object('error','Valid user and name required'); end if;
   insert into study_private.members(user_id,name,is_owner) values(p_uid,trim(p_name),p_owner)
   on conflict(user_id) do update set name=excluded.name,is_owner=excluded.is_owner,seen_at=now();
  else
   select * into member from study_private.members where user_id=p_uid and seen_at>now()-interval '3 minutes';
   if not found then return jsonb_build_object('error','Join the room first'); end if;
   if p_action='leave' then delete from study_private.members where user_id=p_uid;
   elsif p_action='heartbeat' then update study_private.members set seen_at=now() where user_id=p_uid;
   else
    if member.last_action>now()-interval '1 second' then return jsonb_build_object('error','Please wait a moment'); end if;
    update study_private.members set last_action=now(),seen_at=now() where user_id=p_uid;
    t:=s->'timer';
    if p_action='chat' then
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
    elsif p_action='reset' then t:=jsonb_set(jsonb_set(t,'{end}','null'),'{remaining}',to_jsonb(case when t->>'mode'='focus' then 1500000 else 300000 end));
    elsif p_action='mode' and p_payload->>'mode' in ('focus','break') then t:=jsonb_build_object('mode',p_payload->>'mode','remaining',case when p_payload->>'mode'='focus' then 1500000 else 300000 end,'end',null);
    else return jsonb_build_object('error','Unknown action'); end if;
    s:=jsonb_set(s,'{timer}',t);
   end if;
  end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',user_id,'name',name,'owner',is_owner) order by name),'[]') into r from study_private.members where seen_at>now()-interval '3 minutes';
 s:=jsonb_set(jsonb_set(s,'{members}',r),'{serverTime}',to_jsonb(stamp));
 update public.study_room set payload=s,updated_at=now() where id=1;
 return s;
end;
$$;
revoke all on function public.study_command(text,uuid,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.study_command(text,uuid,text,boolean,jsonb) to service_role;
alter publication supabase_realtime add table public.study_room;

-- Provider database capacity reading, available only to the server.
create function public.study_usage() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('databaseBytes',pg_database_size(current_database()));
$$;
revoke all on function public.study_usage() from public,anon,authenticated;
grant execute on function public.study_usage() to service_role;
commit;
