import {youtubeId} from '../_shared/youtube.js';
const unknown=[
 'GitHub Pages bandwidth and build limits: hosting traffic cannot be stopped by a Supabase room pause; no automatic paid upgrades are enabled.',
 'Supabase egress (5 GB/month) and Realtime messages (2 million/month): app reservations exclude direct service traffic, reconnects and usage from the personal website.',
 'Supabase concurrent Realtime connections (200), messages/second (100), Auth active users (50,000/month), and Edge Function invocations (500,000/month): no complete account-wide billing meter is integrated.',
 'Resend Free: 100 emails/day and 3,000/month. App counts warning attempts only, not inbound emails or other applications.',
 'A pause blocks room joins and writes. Existing clients unsubscribe on notification; Supabase does not provide an app-level guarantee of forcibly closing every socket. Unknown or delayed usage cannot have a guaranteed cutoff below 98%.'
];
const encoder=new TextEncoder();
const encode=data=>btoa(String.fromCharCode(...new Uint8Array(data))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const decode=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function key(secret){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function ownerToken(secret,now=Date.now()){
 const payload=encode(encoder.encode(JSON.stringify({expires:now+86400000,nonce:crypto.randomUUID()})));
 const mac=await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(payload));return `${payload}.${encode(mac)}`;
}
export async function isOwner(token,secret,now=Date.now()){
 if(!secret||!token||token.length>1024)return false;
 try{const [payload,signature,...extra]=token.split('.');if(extra.length||!signature)return false;
  if(!await crypto.subtle.verify('HMAC',await key(secret),decode(signature),encoder.encode(payload)))return false;
  const p=JSON.parse(new TextDecoder().decode(decode(payload)));return Number.isFinite(p.expires)&&p.expires>now&&p.expires<=now+86400000;
 }catch{return false;}
}
async function equalSecret(a,b){const hashes=await Promise.all([a,b].map(s=>crypto.subtle.digest('SHA-256',encoder.encode(s))));const x=new Uint8Array(hashes[0]),y=new Uint8Array(hashes[1]);let n=0;for(let i=0;i<x.length;i++)n|=x[i]^y[i];return n===0;}
async function readBody(req){
 if(!req.body)return {};
 const reader=req.body.getReader();const parts=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();throw Error('Request too large');}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
 return JSON.parse(new TextDecoder().decode(bytes)||'{}');
}
export function createHandler(env,request=fetch){
 const allowed=(env.ALLOWED_ORIGINS||'https://0xsamantha.github.io').split(',').map(s=>s.trim());
 return async req=>{
  const origin=req.headers.get('Origin');const accept=!!origin&&allowed.includes(origin);
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Permissions-Policy':'camera=(), microphone=()','Vary':'Origin'};
  if(accept)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'apikey, content-type, x-owner-token, x-owner-key, x-study-token','Access-Control-Allow-Methods':'GET, POST, OPTIONS'});
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(origin&&!accept)return json({error:'Origin is not allowed'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  const rpc=async(name,body={})=>{
   const r=await request(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
   if(!r.ok)throw Error('Server setup is incomplete or unavailable. Check the Supabase migrations.');return r.json();
  };
  const emailReady=!!(env.RESEND_API_KEY&&env.EMAIL_FROM&&env.OWNER_EMAIL);
  const sendWarnings=async()=>{
   if(!emailReady)return;
   for(let n=0;n<6;n++){
    const w=await rpc('study_warning_claim');if(!w)break;
    let status='delivery uncertain — owner review';
    try{const digest=encode(await crypto.subtle.digest('SHA-256',encoder.encode(w.id)));
     const r=await request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':digest},body:JSON.stringify({from:env.EMAIL_FROM,to:[env.OWNER_EMAIL],subject:'Study room usage warning',text:w.text}),signal:AbortSignal.timeout(8000)});status=r.ok?'sent':`delivery failed (${r.status})`;
    }catch{}
    await rpc('study_warning_finish',{p_id:w.id,p_status:status});
   }
  };
  try{
   if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'Supabase server configuration is missing.'},503);
   const url=new URL(req.url);const match=url.pathname.match(/\/api\/(.+)$/);if(!match)return json({error:'Unknown endpoint'},404);
   const action=match[1];
   if(!['GET','POST'].includes(req.method))return json({error:'Method not allowed'},405);
   const body=req.method==='POST'?await readBody(req):{};
   if(action==='auth'){
    if(req.method!=='POST')return json({error:'POST required'},405);
    if(!env.OWNER_SECRET||env.OWNER_SECRET.length<32)return json({error:'Configure a strong owner secret on the server.'},503);
    const candidate=req.headers.get('X-Owner-Key')||'';
    if(candidate.length>256||!await equalSecret(candidate,env.OWNER_SECRET))return json({error:'Owner key was not accepted.'},401);
    return json({token:await ownerToken(env.OWNER_SECRET)});
   }
   const owner=await isOwner(req.headers.get('X-Owner-Token'),env.OWNER_SECRET);
   if(action.startsWith('owner')&&!owner)return json({error:'Owner access required'},401);
   const read=['owner','status','schedule'].includes(action);
   if(read?req.method!=='GET':req.method!=='POST')return json({error:read?'GET required':'POST required'},405);
   if(action==='owner/resume'&&!emailReady&&env.ALLOW_TEST_WITHOUT_EMAIL!=='true')return json({error:'Configure warning email delivery before reopening the published room.'},409);
   let uid=null;
   if(['join','action'].includes(action)){
    const token=req.headers.get('X-Study-Token');if(!token)return json({error:'Sign in to take a seat.'},401);
    const r=await request(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_ANON_KEY||env.STUDY_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(8000)});
    if(!r.ok)return json({error:'Session expired. Please rejoin.'},401);uid=(await r.json()).id;if(!uid)return json({error:'Session expired.'},401);
    if(action==='action'&&body.type==='queueAdd')body.videoId=youtubeId(body.url);
   }
   const result=await rpc('study_gateway',{p_action:action,p_owner:owner,p_invite:url.searchParams.get('invite'),p_uid:uid,p_payload:body});
   const status=result.status||200;delete result.status;
   if(action==='owner'&&!result.error)Object.assign(result,{unknown,demo:false,emailReady,providerConfigured:true});
   try{await sendWarnings();}catch{if(action==='owner')result.warningDeliveryError='Warning delivery could not be checked.';}
   return json(result,status);
  }catch(e){return json({error:e.message||'Request failed'},400);}
 };
}
