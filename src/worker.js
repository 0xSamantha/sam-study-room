import {initial,assess,meters,configure,resume} from './budget.js';
import {youtubeId} from './youtube.js';
import {collectUsage} from './provider-usage.js';
const policy={'Cache-Control':'no-store','Permissions-Policy':'camera=(), microphone=()','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(v,status=200)=>Response.json(v,{status,headers:policy});
export default {
 async fetch(req,env){
  const u=new URL(req.url);
  if((u.pathname.startsWith('/api/')||u.pathname.startsWith('/room/'))){
   if(req.method!=='GET'&&req.headers.get('Origin')!==u.origin)return json({error:'Cross-origin request rejected'},403);
   return env.ROOM.get(env.ROOM.idFromName('usage-coordinator')).fetch(req);
  }
  return env.ASSETS.fetch(req);
 }
};
export class StudyRoom {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.tail=Promise.resolve();ctx.blockConcurrencyWhile(async()=>{this.data=await ctx.storage.get('guard')||{budget:initial(),invite:crypto.randomUUID()};});}
 serial(fn){const p=this.tail.then(fn);this.tail=p.catch(()=>{});return p;}
 get production(){return this.env.LOCAL_DEMO!=='true';}
 owner(req){return !!this.env.OWNER_SECRET&&(req.headers.get('Authorization')===`Bearer ${this.env.OWNER_SECRET}`||(this.data.ownerSession&&this.data.ownerExpires>Date.now()&&req.headers.get('Cookie')?.split('; ').includes(`owner=${this.data.ownerSession}`)));}
 allowed(req){return new URL(req.url).searchParams.get('invite')===this.data.invite;}
 async save(){await this.ctx.storage.put('guard',this.data);}
 async db(action,uid=null,name=null,owner=false,payload={}){
  if(!this.env.SUPABASE_URL||!this.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Supabase is not configured. Follow README.md to connect your project.');
  const r=await fetch(`${this.env.SUPABASE_URL}/rest/v1/rpc/study_command`,{method:'POST',headers:{apikey:this.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_uid:uid,p_name:name,p_owner:owner,p_payload:payload}),signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error('Supabase room transaction failed. Check the migration and server credentials.');return r.json();
 }
 async databasePaused(){
  if(!this.env.SUPABASE_URL||!this.env.SUPABASE_SERVICE_ROLE_KEY)return null;
  const r=await fetch(`${this.env.SUPABASE_URL}/rest/v1/study_room?id=eq.1&select=payload`,{headers:{apikey:this.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`},signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error('Unable to check the database room status.');
  const rows=await r.json();this.roomTimer=rows[0]?.payload?.timer;return rows[0]?.payload?.paused??null;
 }
 async user(req){const token=req.headers.get('X-Study-Token');if(!token)throw Error('Sign in to join the room.');const r=await fetch(`${this.env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:this.env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Your study session expired. Please rejoin.');return (await r.json()).id;}
 async latch(){await this.ctx.storage.deleteAlarm();try{await this.db('pause');}catch{this.data.budget.reason+=' Database pause delivery pending; API writes remain blocked.';}await this.save();}
 async gate(cost={requests:1,storageWrites:4,realtime:12,egress:2097152}){
  const b=this.data.budget;if(b.paused)return false;
  const ok=assess(b,cost,Date.now(),this.production);await this.save();if(!ok)await this.latch();return ok;
 }
 async warnings(){
  const b=this.data.budget;
  if(!this.env.RESEND_API_KEY||!this.env.OWNER_EMAIL||!this.env.EMAIL_FROM)return;
  for(const m of b.outbox.filter(m=>m.status==='pending')){
   if(b.counts.emails>=18){m.status='blocked: email reserve';continue;}
   b.counts.emails++;m.status='sending';await this.save();
   try{const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${this.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':m.id},body:JSON.stringify({from:this.env.EMAIL_FROM,to:[this.env.OWNER_EMAIL],subject:'Reading Room usage warning',text:m.text})});m.status=r.ok?'sent':`delivery failed (${r.status})`;}catch{m.status='delivery uncertain — owner review';}await this.save();
  }
 }
 fetch(req){return this.serial(async()=>{
  const u=new URL(req.url),p=u.pathname,b=this.data.budget,owner=this.owner(req);
  try{
   if(p==='/api/auth'&&req.method==='POST'){
    if(!owner)return json({error:'Owner key required'},401);this.data.ownerSession=crypto.randomUUID();this.data.ownerExpires=Date.now()+86400000;await this.save();
    return new Response('{}',{headers:{...policy,'Content-Type':'application/json','Set-Cookie':`owner=${this.data.ownerSession}; HttpOnly; SameSite=Strict; Path=/; ${this.production?'Secure; ':''}Max-Age=86400`}});
   }
   if(p==='/api/owner'){
    if(!owner)return json({error:'Owner key required'},401);
    if(!b.paused&&!assess(b,{},Date.now(),this.production))await this.latch();
    return json({databasePaused:await this.databasePaused(),timer:this.roomTimer,invite:this.data.invite,budget:b,meters:meters(b),demo:!this.production,emailReady:!!(this.env.RESEND_API_KEY&&this.env.OWNER_EMAIL&&this.env.EMAIL_FROM),unknown:b.provider?.unknown||['Provider usage has not been checked. Connect Supabase and Cloudflare analytics, then refresh.'],providerConfigured:!!(this.env.CLOUDFLARE_ACCOUNT_ID&&this.env.CLOUDFLARE_ANALYTICS_TOKEN)});
   }
   if(p.startsWith('/api/owner/')){
    if(!owner)return json({error:'Owner key required'},401);if(req.method!=='POST')return json({error:'POST required'},405);const body=await readBody(req);
    if(p.endsWith('/settings')){configure(b,Number(body.warn),Number(body.stop),Number(body.buffer));await this.gate({});}
    else if(p.endsWith('/pause')){b.paused=true;b.reason='Paused by the owner';await this.latch();}
    else if(p.endsWith('/resume')){
     if(this.production&&!(this.env.RESEND_API_KEY&&this.env.OWNER_EMAIL&&this.env.EMAIL_FROM))throw Error('Configure warning email delivery before reopening.');
     if(this.production&&!(this.env.CLOUDFLARE_ACCOUNT_ID&&this.env.CLOUDFLARE_ANALYTICS_TOKEN))throw Error('Configure the Cloudflare read-only analytics token before reopening.');
     resume(b,Date.now(),this.production);try{await this.db('resume');}catch(e){b.paused=true;b.reason=e.message;await this.save();throw e;}await this.ctx.storage.setAlarm(Date.now()+60000);
    }
    else if(p.endsWith('/refresh')){await this.refresh();await this.gate({});}
    else if(p.endsWith('/timers')){
     if(!await this.gate())return json({paused:true,error:b.reason},423);
     const result=await this.db('timerSettings',null,null,true,body);
     if(result.error)throw Error(result.error);
     await this.save();return json(result);
    }
    else if(p.endsWith('/schedule')){
     if(!['scheduleAdd','scheduleRemove'].includes(body.type))throw Error('Unknown schedule action');
     if(!await this.gate())return json({paused:true,error:b.reason},423);
     const result=await this.db(body.type,null,null,true,body);
     if(result.error)throw Error(result.error);
    }
    else if(p.endsWith('/rotate')){await this.db('revoke');this.data.invite=crypto.randomUUID();b.paused=true;b.reason='Invitation replaced. Resume after reviewing membership.';await this.latch();}
    else return json({error:'Unknown owner action'},404);
    await this.save();await this.warnings();return json({ok:true});
   }
   if(!this.allowed(req))return json({error:'A valid invitation is required'},403);
   if(p.startsWith('/room/')&&b.paused)return pausedPage();
   if(!await this.gate()){await this.warnings();return p.startsWith('/room/')?pausedPage():json({paused:true,error:b.reason},423);}
   await this.warnings();
   if(p.startsWith('/room/'))return this.env.ASSETS.fetch(new Request(new URL('/index.html',req.url)));
   if(p==='/api/schedule'){
    const r=await fetch(`${this.env.SUPABASE_URL}/rest/v1/rpc/study_schedule`,{method:'POST',headers:{apikey:this.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw Error('Schedule setup is pending. Apply migration 002_schedule_and_seating.sql.');
    return json({sessions:await r.json()});
   }
   if(p==='/api/status')return json({paused:false,configured:!!(this.env.SUPABASE_URL&&this.env.SUPABASE_PUBLISHABLE_KEY),url:this.env.SUPABASE_URL,key:this.env.SUPABASE_PUBLISHABLE_KEY});
   if(req.method!=='POST')return json({error:'POST required'},405);
   const body=await readBody(req),uid=await this.user(req);
   if(p==='/api/join'){
    const result=await this.db('join',uid,String(body.name||'').trim().slice(0,32),owner,body);
    if(!b.paused)await this.ctx.storage.setAlarm(Date.now()+60000);return json(result,result.error?400:200);
   }
   if(p==='/api/action'){
    if(!['chat','start','pauseTimer','reset','mode','heartbeat','leave','seat','color','queueAdd','queueRemove','queueNext'].includes(body.type))throw Error('Unknown action');
    if(body.type==='queueAdd')body.videoId=youtubeId(body.url);
    const result=await this.db(body.type,uid,null,owner,body);return json(result,result.error?400:200);
   }
   return json({error:'Unknown endpoint'},404);
  }catch(e){return json({error:e.message},400);}
 });}
 async refresh(){
  if(!this.env.USAGE_SNAPSHOT_URL){this.data.budget.provider=await collectUsage(this.env);return;}
  const url=new URL(this.env.USAGE_SNAPSHOT_URL);if(url.protocol!=='https:')throw Error('Usage adapter requires HTTPS');
  const r=await fetch(url,{headers:{Authorization:`Bearer ${this.env.USAGE_SNAPSHOT_TOKEN}`},signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Provider usage check failed');const p=await r.json();
  const required=['workerRequests','doRequests','supabaseDatabase'];
  if(!Number.isFinite(p.checked)||Date.now()-p.checked>300000||p.checked>Date.now()+10000||!Array.isArray(p.meters)||required.some(key=>!p.meters.some(m=>m.key===key)))throw Error('Provider snapshot incomplete or stale');
  for(const m of p.meters)if(!Number.isFinite(m.used)||m.used<0||!Number.isFinite(m.limit)||m.limit<=0||(m.resets!==null&&(!Number.isFinite(Date.parse(m.resets))||Date.parse(m.resets)<=Date.now())))throw Error('Invalid provider meter');
  this.data.budget.provider=p;
 }
 alarm(){return this.serial(async()=>{
  if(this.data.budget.paused)return;
  try{if(this.production)await this.refresh();}catch{this.data.budget.provider=null;}
  if(await this.gate({requests:1,storageWrites:4,realtime:12,egress:2097152}))await this.ctx.storage.setAlarm(Date.now()+60000);
  await this.warnings();
 });}
}
async function readBody(req){if(Number(req.headers.get('content-length'))>4096)throw Error('Request too large');const text=await req.text();if(text.length>4096)throw Error('Request too large');return JSON.parse(text);}

function pausedPage(){return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Study room paused</title><link rel="stylesheet" href="/paused.css"><main><p>THE READING ROOM</p><h1>Study room paused</h1><p>The library is resting to protect its usage budget. The owner needs to review usage before reopening.</p><p>No live connection is active.</p><a href="/?settings=1">Owner settings / return to the reading room</a></main></html>`,{status:503,headers:{...policy,"Content-Type":"text/html;charset=utf-8"}});}
