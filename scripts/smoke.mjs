// Safe local smoke check: no Supabase requests and no real email.
import assert from 'node:assert/strict';
const base='http://localhost:8787';
const key=process.env.SMOKE_OWNER_KEY;if(!key)throw Error('Set SMOKE_OWNER_KEY to the local owner key.');
const headers={Authorization:`Bearer ${key}`,Origin:base,'Content-Type':'application/json'};
const r=await fetch(base);assert.equal(r.status,200);assert.match(r.headers.get('permissions-policy'),/camera=\(\)/);
const d=await (await fetch(base+'/api/owner',{headers})).json();assert.ok(d.invite);assert.ok(d.meters.length>=5);
const denied=await fetch(base+'/api/owner');assert.equal(denied.status,401);
assert.equal((await fetch(base+'/api/status?invite=wrong')).status,403);
const assets=await fetch(base+'/app.js');assert.equal(assets.status,200);
console.log('PASS: HTML, camera/microphone restriction headers, owner dashboard, private invite validation and bundled app. Database/RLS/concurrency are tested separately with npm test.');
