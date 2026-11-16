import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StudyRoom} from '../src/worker.js';
async function fixture(){let saves=0;let ready;const ctx={storage:{get:async()=>null,put:async()=>{saves++;},deleteAlarm:async()=>{},setAlarm:async()=>{}},blockConcurrencyWhile:fn=>{ready=fn();}};const room=new StudyRoom(ctx,{LOCAL_DEMO:'true',OWNER_SECRET:'secret'});await ready;room.db=async action=>({paused:action==='pause'});return {room,saves:()=>saves};}
const req=(path,auth=false,body)=>new Request(`https://example.com${path}`,{method:body?'POST':'GET',headers:{...(auth?{Authorization:'Bearer secret'}:{}),Origin:'https://example.com'},body:body?JSON.stringify(body):undefined});
test('actual coordinator serializes concurrent joins and latches before cutoff',async()=>{const {room}=await fixture();let pauses=0;room.db=async action=>{if(action==='pause')pauses++;return {};};room.data.budget.counts.requests=9498;const path=`/api/status?invite=${room.data.invite}`;const results=await Promise.all([room.fetch(req(path)),room.fetch(req(path))]);assert.deepEqual(results.map(r=>r.status),[200,423]);assert.equal(pauses,1);assert.equal(room.data.budget.counts.requests,9499);});
test('latched coordinator rejects writes without further storage writes',async()=>{const f=await fixture();f.room.data.budget.paused=true;const before=f.saves();assert.equal((await f.room.fetch(req(`/api/status?invite=${f.room.data.invite}`))).status,423);assert.equal(f.saves(),before);});
test('owner endpoints deny guests and invite is required',async()=>{const {room}=await fixture();assert.equal((await room.fetch(req('/api/owner'))).status,401);assert.equal((await room.fetch(req('/api/status?invite=wrong'))).status,403);});
test('database pause failures still latch API writes closed',async()=>{const {room}=await fixture();room.db=async()=>{throw Error('offline');};assert.equal((await room.fetch(req('/api/owner/pause',true,{}))).status,200);assert.equal(room.data.budget.paused,true);assert.match(room.data.budget.reason,/pending/);assert.equal((await room.fetch(req(`/api/status?invite=${room.data.invite}`))).status,423);});

test('two people joining simultaneously near a quota: exactly one Supabase join commits',async()=>{const {room}=await fixture();room.user=async r=>r.headers.get('X-Study-Token');const joined=[];room.db=async(action,uid)=>{if(action==='join')joined.push(uid);return {members:joined};};room.data.budget.counts.requests=9498;const path=`/api/join?invite=${room.data.invite}`;const join=id=>new Request(`https://example.com${path}`,{method:'POST',headers:{Origin:'https://example.com','X-Study-Token':id},body:JSON.stringify({name:id})});const results=await Promise.all([room.fetch(join('Alice')),room.fetch(join('Bob'))]);assert.deepEqual(results.map(r=>r.status),[200,423]);assert.deepEqual(joined,['Alice']);});
test('paused invitation returns lightweight HTML without loading Supabase',async()=>{const {room}=await fixture();room.data.budget.paused=true;const r=await room.fetch(req(`/room/entry?invite=${room.data.invite}`));assert.equal(r.status,503);const s=await r.text();assert.match(s,/Study room paused/);assert.doesNotMatch(s,/<script|supabase/);});

test('owner cookie remains valid on a newly opened invitation page',async()=>{
 const {room}=await fixture();
 const login=await room.fetch(req('/api/auth',true,{}));
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const nextPage=new Request('https://example.com/api/owner',{headers:{Cookie:cookie}});
 assert.equal((await room.fetch(nextPage)).status,200);
 assert.equal((await room.fetch(req('/api/owner'))).status,401);
});
test('owner status reports a database pause even when the local guard is open',async()=>{
 const {room}=await fixture();room.databasePaused=async()=>true;
 const result=await (await room.fetch(req('/api/owner',true))).json();
 assert.equal(result.databasePaused,true);assert.equal(result.budget.paused,false);
});
test('explicit owner resume reopens both database and local guard',async()=>{
 const {room}=await fixture();room.data.budget.paused=true;let resumed=false;
 room.db=async action=>{resumed=action==='resume';return {paused:false};};
 assert.equal((await room.fetch(req('/api/owner/resume',true,{}))).status,200);
 assert.equal(resumed,true);assert.equal(room.data.budget.paused,false);
});
