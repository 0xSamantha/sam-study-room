import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,ownerToken,isOwner} from '../supabase/functions/study-api/handler.js';
const secret='a'.repeat(48),origin='https://0xsamantha.github.io';
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private',SUPABASE_ANON_KEY:'public',OWNER_SECRET:secret};
const req=(path,options={})=>new Request(`https://test.supabase.co/functions/v1/study-api/api/${path}`,{...options,headers:{Origin:origin,...options.headers}});
test('signed owner tokens persist without cross-site cookies and reject tampering/expiry',async()=>{
 const t=await ownerToken(secret);assert.equal(await isOwner(t,secret),true);assert.equal(await isOwner(t+'x',secret),false);assert.equal(await isOwner(t,'different'),false);assert.equal(await isOwner(await ownerToken(secret,Date.now()-86400001),secret),false);
});
test('owner login returns token, never a cookie or secret',async()=>{
 const h=createHandler(env);const r=await h(req('auth',{method:'POST',headers:{'X-Owner-Key':secret},body:'{}'}));assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);const d=await r.json();assert.equal(await isOwner(d.token,secret),true);assert.equal(JSON.stringify(d).includes(secret),false);
 assert.equal((await h(req('auth',{method:'POST',headers:{'X-Owner-Key':'bad'},body:'{}'}))).status,401);
});
test('CORS permits the GitHub Pages origin and rejects other sites',async()=>{
 const h=createHandler(env);const r=await h(req('status',{method:'OPTIONS'}));assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);
 assert.equal((await h(req('status',{headers:{Origin:'https://unrelated.example'}}))).status,403);
});
test('owner endpoints and production resume remain protected',async()=>{
 const h=createHandler(env);assert.equal((await h(req('owner'))).status,401);
 const r=await h(req('owner/resume',{method:'POST',headers:{'X-Owner-Token':await ownerToken(secret)},body:'{}'}));assert.equal(r.status,409);assert.match((await r.json()).error,/warning email/);
});
test('verified users reach the atomic database gateway without trusting caller owner/user flags',async()=>{
 let gateway;const request=async(url,options)=>{if(url.endsWith('/auth/v1/user'))return Response.json({id:'verified-user'});gateway=JSON.parse(options.body);return Response.json({members:[],timer:{}});};
 const h=createHandler(env,request);const r=await h(req('join?invite=abc',{method:'POST',headers:{'X-Study-Token':'jwt'},body:JSON.stringify({name:'Friend',owner:true,userId:'spoofed'})}));assert.equal(r.status,200);assert.equal(gateway.p_uid,'verified-user');assert.equal(gateway.p_owner,false);assert.equal(gateway.p_invite,'abc');
});
test('paused status is returned before the client starts a real-time connection',async()=>{
 const h=createHandler(env,async()=>Response.json({paused:true,status:423,error:'Paused'}));const r=await h(req('status?invite=abc'));assert.equal(r.status,423);assert.equal((await r.json()).paused,true);
});
test('invalid video URLs and oversized requests never reach the mutation RPC',async()=>{
 let calls=0;const h=createHandler(env,async url=>{calls++;assert.ok(url.endsWith('/auth/v1/user'));return Response.json({id:'user'});});
 let r=await h(req('action?invite=abc',{method:'POST',headers:{'X-Study-Token':'jwt'},body:JSON.stringify({type:'queueAdd',url:'https://evil.example/video'})}));assert.equal(r.status,400);assert.equal(calls,1);
 r=await h(req('auth',{method:'POST',body:'x'.repeat(5000)}));assert.equal(r.status,400);
});
