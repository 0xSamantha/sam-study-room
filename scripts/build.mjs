import {build} from 'esbuild';
import {readFile,writeFile,cp,mkdir} from 'node:fs/promises';
const settings={...process.env};
try{for(const line of (await readFile('.dev.vars','utf8')).split('\n')){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m&&!settings[m[1]])settings[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2');}}catch{}
// Only these public values are ever serialized. No general environment substitution.
if(settings.SUPABASE_URL&&settings.SUPABASE_PUBLISHABLE_KEY){
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(settings.SUPABASE_URL)||!settings.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_'))throw Error('Invalid public Supabase configuration');
 await writeFile('public/config.js',`globalThis.STUDY_CONFIG = ${JSON.stringify({supabaseUrl:settings.SUPABASE_URL.replace(/\/$/,''),publishableKey:settings.SUPABASE_PUBLISHABLE_KEY})};\n`);
}
try{await readFile('public/config.js');}catch{await writeFile('public/config.js','globalThis.STUDY_CONFIG = {};\n');}
await build({entryPoints:['src/app.js'],bundle:true,format:'esm',minify:true,outfile:'public/app.js'});
await mkdir('docs',{recursive:true});
for(const name of ['index.html','boot.js','app.js','config.js','style.css','paused.css','paused.html'])await cp(`public/${name}`,`docs/${name}`);
await writeFile('docs/.nojekyll','');
console.log('Built GitHub Pages site in docs/. Only the public Supabase URL and publishable key are included.');
