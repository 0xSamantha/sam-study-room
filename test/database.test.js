import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db;const uid='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';
before(async()=>{console.log('Starting embedded PostgreSQL migration check');db=new PGlite();await db.waitReady;await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;insert into auth.users values('${uid}'),('${other}');`);await db.exec("create table public.site_hello(id integer primary key, message text);insert into public.site_hello values(1,'website remains intact');alter table public.site_hello enable row level security;");console.log('Loading Supabase migration');const sql=await readFile(new URL('../supabase/migrations/001_study_room.sql',import.meta.url),'utf8');await db.exec(sql.replace('alter publication supabase_realtime add table public.study_room;',''));const upgrade=await readFile(new URL('../supabase/migrations/002_schedule_and_seating.sql',import.meta.url),'utf8');await db.exec(upgrade);await db.exec(await readFile(new URL('../supabase/migrations/003_videos_and_timer_settings.sql',import.meta.url),'utf8'));});
after(async()=>{await db.close();});
async function command(action,user=uid,owner=true,payload={},name='Reader'){const r=await db.query('select public.study_command($1,$2,$3,$4,$5) as result',[action,user,name,owner,JSON.stringify(payload)]);return r.rows[0].result;}
test('database migration, owner timer, guest denial, paused writes, RLS',async()=>{
 assert.equal((await command('join')).paused,true);await command('resume');let s=await command('join');assert.equal(s.members.length,1);s=await command('start');assert.ok(s.timer.end);const end=s.timer.end;
 s=await command('join',other,false,{},'Friend');assert.equal(s.timer.end,end);assert.equal(s.members.length,2);
 s=await command('reset',other,false);assert.match(s.error,/owner/);s=await command('pause');assert.equal(s.paused,true);assert.equal((await command('chat',other,false,{text:'blocked'})).paused,true);
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${uid}';`);let rows=await db.query('select payload from public.study_room');assert.equal(rows.rows.length,1);
 await assert.rejects(db.exec("update public.study_room set payload='{}'"),/permission denied/);
 await assert.rejects(db.exec("select public.study_command('resume')"),/permission denied/);
 await db.exec("set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'");rows=await db.query('select payload from public.study_room');assert.equal(rows.rows.length,0);await db.exec('reset role');
 await command('resume');await db.exec('update study_private.members set last_action=null');s=await command('chat',other,false,{text:'A quiet hello'});assert.equal(s.messages.at(-1).text,'A quiet hello');
});

test('shared-project installation preserves existing website data and RLS',async()=>{
 const r=await db.query('select message from public.site_hello where id=1');
 assert.equal(r.rows[0].message,'website remains intact');
 const flags=await db.query("select relrowsecurity from pg_class where oid='public.site_hello'::regclass");
 assert.equal(flags.rows[0].relrowsecurity,true);
 const policies=await db.query("select * from pg_policies where schemaname='public' and tablename='site_hello'");
 assert.equal(policies.rows.length,0);
});

test('LED seating keeps owner pink and serializes conflicting seat choices',async()=>{
 await db.exec('update study_private.members set last_action=null');
 let s=await command('join',uid,true,{seat:0,color:'#59b8ff'});
 assert.equal(s.members.find(m=>m.id===uid).color,'#ff5ca8');
 s=await command('join',other,false,{seat:0,color:'#66db9b'});assert.match(s.error,/took that seat/);
 s=await command('join',other,false,{seat:3,color:'#66db9b'});assert.equal(s.members.find(m=>m.id===other).seat,3);assert.equal(s.members.find(m=>m.id===other).color,'#66db9b');
 s=await command('color',other,false,{color:'#ff5ca8'});assert.match(s.error,/available LED/);
 s=await command('color',uid,true,{color:'#ffc65b'});assert.equal(s.members.find(m=>m.id===uid).color,'#ff5ca8');
 s=await command('seat',other,false,{seat:0});assert.match(s.error,/took that seat/);
 s=await command('seat',other,false,{seat:5});assert.equal(s.members.find(m=>m.id===other).seat,5);
});
test('only owner can publish schedules, times persist as instants, paused writes are blocked',async()=>{
 const startsAt=new Date(Date.now()+86400000).toISOString(),endsAt=new Date(Date.now()+90000000).toISOString();
 const payload={title:'Evening focus',startsAt,endsAt,timezone:'America/Los_Angeles',notes:'Bring your reading'};
 let s=await command('scheduleAdd',other,false,payload);assert.match(s.error,/Only the owner/);
 s=await command('scheduleAdd',null,true,{...payload,endsAt:startsAt});assert.match(s.error,/future start/);
 s=await command('scheduleAdd',null,true,payload);assert.equal(s.sessions.length,1);assert.equal(Date.parse(s.sessions[0].startsAt),Date.parse(startsAt));
 const id=s.sessions[0].id;
 await command('pause');s=await command('scheduleRemove',null,true,{id});assert.equal(s.paused,true);
 await command('resume');s=await command('scheduleRemove',null,true,{id});assert.equal(s.sessions.length,0);
 await db.exec('set role authenticated');await assert.rejects(db.exec("select public.study_schedule()"),/permission denied/);await db.exec('reset role');
});

test('custom timer durations are owner-only and persist through mode/reset',async()=>{
 let s=await command('timerSettings',null,false,{focusMinutes:45,breakMinutes:10});assert.match(s.error,/Only the owner/);
 s=await command('timerSettings',null,true,{focusMinutes:0,breakMinutes:10});assert.match(s.error,/1 and 240/);
 s=await command('timerSettings',null,true,{focusMinutes:45,breakMinutes:10});assert.equal(s.timer.focusMs,2700000);assert.equal(s.timer.breakMs,600000);assert.equal(s.timer.end,null);assert.equal(s.timer.remaining,2700000);
 await db.exec('update study_private.members set last_action=null');s=await command('mode',uid,true,{mode:'break'});assert.equal(s.timer.remaining,600000);assert.equal(s.timer.focusMs,2700000);
 await db.exec('update study_private.members set last_action=null');s=await command('reset');assert.equal(s.timer.remaining,600000);
 await db.exec('update study_private.members set last_action=null');await command('start');
 s=await command('timerSettings',null,true,{focusMinutes:30,breakMinutes:7});assert.equal(s.timer.end,null);assert.equal(s.timer.remaining,420000);
});
test('video queue allows member contributions, prevents spoofing and enforces removal permissions',async()=>{
 const run=async(action,user,owner,payload)=>{await db.exec('update study_private.members set last_action=null');return command(action,user,owner,payload);};
 let s=await run('queueAdd',other,false,{videoId:'invalid'});assert.match(s.error,/Invalid YouTube/);
 s=await run('queueAdd',other,false,{videoId:'dQw4w9WgXcQ',title:'Study music',userId:uid});assert.equal(s.queue.length,1);assert.equal(s.queue[0].userId,other);
 const first=s.queue[0].id;
 s=await run('queueAdd',uid,true,{videoId:'dQw4w9WgXcQ'});assert.match(s.error,/already/);
 s=await run('queueAdd',uid,true,{videoId:'M7lc1UVf-VE',title:'Tutorial'});const second=s.queue[1].id;
 s=await run('queueRemove',other,false,{id:second});assert.match(s.error,/only remove/);
 s=await run('queueNext',other,false,{});assert.match(s.error,/Only the owner/);
 s=await run('queueRemove',other,false,{id:first});assert.equal(s.queue.length,1);assert.equal(s.queue[0].id,second);
 s=await run('queueNext',uid,true,{});assert.equal(s.queue.length,0);
 await command('pause');s=await run('queueAdd',other,false,{videoId:'dQw4w9WgXcQ'});assert.equal(s.paused,true);await command('resume');
});
