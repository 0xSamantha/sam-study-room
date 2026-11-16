import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectUsage} from '../src/provider-usage.js';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private',CLOUDFLARE_ACCOUNT_ID:'account',CLOUDFLARE_ANALYTICS_TOKEN:'private'};
const now=Date.parse('2026-11-12T12:00:00Z');
test('collector combines measured DB size with delayed account-wide analytics and labels unknowns',async()=>{const request=async url=>Response.json(url.includes('supabase')?{databaseBytes:25000000}:{data:{viewer:{accounts:[{workersInvocationsAdaptive:[{sum:{requests:90001}}],durableObjectsInvocationsAdaptiveGroups:[{sum:{requests:500}}],durableObjectsStorageGroups:[]}]}}});const r=await collectUsage(env,now,request);assert.equal(r.meters.length,3);assert.equal(r.meters[0].resets,null);assert.equal(r.meters[1].used,90001);assert.ok(r.unknown.some(x=>x.includes('2 million')));});
test('collector rejects failed or invalid readings instead of treating them as zero',async()=>{await assert.rejects(collectUsage(env,now,async()=>Response.json({databaseBytes:null})),/Invalid/);let calls=0;await assert.rejects(collectUsage(env,now,async()=>Response.json(++calls===1?{databaseBytes:1}:{errors:[{message:'denied'}]})),/unavailable/);});
