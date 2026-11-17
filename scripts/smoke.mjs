import assert from 'node:assert/strict';
const base='http://localhost:8787/sam-study-room/';
const r=await fetch(base);assert.equal(r.status,200);const html=await r.text();assert.ok(html.includes('./boot.js'));assert.ok(!html.includes('src="/'));
for(const name of ['boot.js','app.js','config.js','style.css','paused.html'])assert.equal((await fetch(base+name)).status,200,name);
const paused=await (await fetch(base+'paused.html')).text();assert.ok(!paused.includes('<script'));
console.log('PASS: nested GitHub Pages path, static assets, public config and script-free paused page.');
