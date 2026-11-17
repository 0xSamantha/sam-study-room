import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const settings={};for(const line of readFileSync('.dev.vars','utf8').split('\n')){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m)settings[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2');}
const base=`${settings.SUPABASE_URL}/functions/v1/study-api/api/`;
const headers={Origin:'https://0xsamantha.github.io',apikey:settings.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'};
const auth=await fetch(base+'auth',{method:'POST',headers:{...headers,'X-Owner-Key':settings.OWNER_SECRET},body:'{}'});
assert.equal(auth.status,200,'Owner login');const {token}=await auth.json();assert.ok(token);
const owner=await fetch(base+'owner',{headers:{...headers,'X-Owner-Token':token}});assert.equal(owner.status,200,'Owner dashboard');const d=await owner.json();assert.ok(d.invite);assert.equal(d.demo,false);
assert.equal((await fetch(base+'owner',{headers})).status,401,'Guest owner denial');
const status=await fetch(base+`status?invite=${encodeURIComponent(d.invite)}`,{headers});assert.equal(status.status,d.budget.paused?423:200,'Invite/guard');
console.log(JSON.stringify({supabaseBackend:'reachable',ownerLogin:'passed',guestOwnerAccess:'denied',roomPaused:d.budget.paused,emailConfigured:d.emailReady,quotaMeters:d.meters.length}));
