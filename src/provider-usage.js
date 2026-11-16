import {day,nextDay} from './budget.js';
// Delayed analytics are observations, never represented as a hard cutoff.
export async function collectUsage(env,now=Date.now(),request=fetch){
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Connect Supabase before checking usage.');
 const dbResponse=await request(`${env.SUPABASE_URL}/rest/v1/rpc/study_usage`,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(8000)});
 if(!dbResponse.ok)throw Error('Supabase database usage check failed. Apply the latest migration.');
 const db=await dbResponse.json();
 if(!Number.isFinite(db.databaseBytes)||db.databaseBytes<0)throw Error('Invalid database usage reading.');
 const checked=new Date(now).toISOString();
 const meters=[{key:'supabaseDatabase',name:'Supabase database size',used:db.databaseBytes,limit:500000000,resets:null,checked,note:'Measured by pg_database_size; capacity does not reset.'}];
 const unknown=[
  'Supabase egress: 5 GB/month. A complete billing meter is not integrated; app egress reservations exclude direct auth, reconnects and malicious traffic.',
  'Supabase real-time messages: 2 million/month; 200 concurrent connections; 100 messages/second. App fanout reservations are conservative but do not measure all subscription traffic.',
  'Supabase active users: 50,000/month. Auth API is publicly reachable; room pause cannot stop direct auth calls.',
  'Resend account usage: 100 emails/UTC day and 3,000/month. App counts only warning attempts; inbound mail or other apps are not included.',
  'Cloudflare Durable Object duration: 13,000 GB-s/day; SQLite reads 5 million/day and writes 100,000/day. Reservations are not exact billing meters.'
 ];
 if(env.CLOUDFLARE_ACCOUNT_ID&&env.CLOUDFLARE_ANALYTICS_TOKEN){
  const variables={accountTag:env.CLOUDFLARE_ACCOUNT_ID,start:`${day(now)}T00:00:00Z`,end:checked};
  const query=`query RoomUsage($accountTag: string, $start: string, $end: string) {
   viewer { accounts(filter: {accountTag: $accountTag}) {
    workersInvocationsAdaptive(limit: 10000, filter: {datetime_geq: $start, datetime_leq: $end}) { sum { requests } }
    durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: {datetime_geq: $start, datetime_leq: $end}) { sum { requests } }
   } }
  }`;
  const response=await request('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:`Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Cloudflare analytics check failed.');const result=await response.json();
  if(result.errors?.length||!result.data?.viewer?.accounts?.length)throw Error('Cloudflare analytics unavailable for this token or schema.');
  const account=result.data.viewer.accounts[0];
  for(const [key,field,name] of [['workerRequests','workersInvocationsAdaptive','Cloudflare Worker requests'],['doRequests','durableObjectsInvocationsAdaptiveGroups','Cloudflare Durable Object requests']]){
   const rows=account[field];if(!Array.isArray(rows)||rows.length>=10000||rows.some(x=>!Number.isFinite(x.sum?.requests)||x.sum.requests<0))throw Error('Cloudflare analytics truncated or invalid.');
   meters.push({key,name,used:rows.reduce((s,x)=>s+x.sum.requests,0),limit:100000,resets:nextDay(now),checked,note:'Account-wide delayed/adaptive analytics. A reported zero may lag new activity.'});
  }
  // Per-object storage grouping needs account-specific dimensions. Never sum overlapping maxima.
  unknown.push('Cloudflare SQLite stored data: 5 GB total. Storage analytics is exposed, but this collector does not infer an account total from overlapping per-object maxima.');
 }else unknown.push('Cloudflare analytics token is missing. Account-wide Worker/DO requests and storage usage are unknown. Production resume requires the analytics token.');
 return {checked:now,meters,unknown};
}
