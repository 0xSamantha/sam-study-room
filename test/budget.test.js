import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initial,assess,resume,configure,rollover} from '../src/budget.js';
const now=Date.parse('2026-11-12T12:00:00Z');
test('one warning per quota per UTC cycle',()=>{const b=initial(now);b.counts.requests=9000;assess(b,{},now);assess(b,{},now);assert.equal(b.outbox.length,1);rollover(b,now+86400000);b.counts.requests=9000;assess(b,{},now+86400000);assert.equal(b.outbox.length,2);});
test('two concurrent joins cannot both consume the last reservation',async()=>{const b=initial(now);b.counts.requests=9498;let tail=Promise.resolve();const reserve=()=>{const p=tail.then(()=>assess(b,{requests:1},now));tail=p;return p;};assert.deepEqual(await Promise.all([reserve(),reserve()]),[true,false]);assert.equal(b.counts.requests,9499);assert.equal(b.paused,true);});
test('reserve pauses before nominal threshold and writes are rejected',()=>{const b=initial(now);b.counts.storageWrites=9499;assert.equal(assess(b,{storageWrites:1},now),false);assert.equal(b.counts.storageWrites,9499);assert.equal(assess(b,{requests:1},now),false);});
test('pause survives daily rollover and requires safe manual resume',()=>{const b=initial(now);b.counts.requests=9600;assess(b,{},now);assert.throws(()=>resume(b,now));rollover(b,now+86400000);assert.equal(b.paused,true);resume(b,now+86400000);assert.equal(b.paused,false);});
test('production rejects absent or stale provider readings',()=>{const b=initial(now);assert.equal(assess(b,{},now,true),false);b.provider={checked:now-300001,meters:[]};assert.throws(()=>resume(b,now,true));});
test('provider quota trips buffered latch',()=>{const b=initial(now);b.provider={checked:now,meters:[{key:'doDuration',name:'DO duration',used:96,limit:100,resets:'tomorrow'}]};assert.equal(assess(b,{},now,true),false);assert.match(b.reason,/DO duration/);});
test('invalid and unsafe thresholds rejected',()=>{const b=initial(now);assert.throws(()=>configure(b,95,97,2));assert.throws(()=>configure(b,90,99,2));assert.throws(()=>configure(b,NaN,97,2));configure(b,80,95,3);assert.equal(b.stop,95);});

test('monthly provider warning does not repeat after daily app rollover',()=>{const b=initial(now);const provider={checked:now,meters:[{key:'supabaseRealtime',name:'Supabase Realtime',used:91,limit:100,resets:'2026-12-01T00:00:00Z'}]};b.provider=provider;assess(b,{},now);rollover(b,now+86400000);b.provider={...provider,checked:now+86400000};assess(b,{},now+86400000);assert.equal(b.outbox.length,1);});
