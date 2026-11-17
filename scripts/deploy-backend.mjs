import {readFile,writeFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
const settings={...process.env};
try{for(const line of (await readFile('.dev.vars','utf8')).split('\n')){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m&&!settings[m[1]])settings[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2');}}catch{}
const ref=settings.SUPABASE_URL?.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/)?.[1];
if(!ref||!settings.OWNER_SECRET||settings.OWNER_SECRET.length<32)throw Error('Set the Supabase project URL and a 32+ character owner secret in .dev.vars first.');
const names=['OWNER_SECRET','RESEND_API_KEY','OWNER_EMAIL','EMAIL_FROM','ALLOWED_ORIGINS'];
const entries=names.filter(k=>settings[k]).map(k=>`${k}=${JSON.stringify(settings[k])}`);
if(!settings.ALLOWED_ORIGINS)entries.push('ALLOWED_ORIGINS=https://0xsamantha.github.io');
const dir=await mkdtemp(join(tmpdir(),'study-secrets-'));const file=join(dir,'secrets.env');
const run=args=>new Promise((resolve,reject)=>{const p=spawn('npx',['--yes','supabase',...args],{stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error('Supabase CLI did not complete. Sign in with npx --yes supabase login and try again.')));});
try{
 await writeFile(file,entries.join('\n')+'\n',{mode:0o600});
 await run(['db','query',`--remote=${ref}`,'--file','supabase/migrations/004_supabase_gateway.sql','--yes']);
 await run(['secrets','set','--project-ref',ref,'--env-file',file,'--yes']);
 await run(['functions','deploy','study-api','--project-ref',ref,'--no-verify-jwt','--yes']);
 console.log('Supabase backend deployed and migration 004 applied. The room is paused for explicit owner review.');
}finally{await unlink(file).catch(()=>{});await rmdir(dir).catch(()=>{});}
