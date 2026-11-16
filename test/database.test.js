import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db;const uid='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';
before(async()=>{console.log('Starting embedded PostgreSQL migration check');db=new PGlite();await db.waitReady;await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;insert into auth.users values('${uid}'),('${other}');`);await db.exec("create table public.site_hello(id integer primary key, message text);insert into public.site_hello values(1,'website remains intact');alter table public.site_hello enable row level security;");console.log('Loading Supabase migration');const sql=await readFile(new URL('../supabase/migrations/001_study_room.sql',import.meta.url),'utf8');await db.exec(sql.replace('alter publication supabase_realtime add table public.study_room;',''));});
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
