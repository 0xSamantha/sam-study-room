import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
const root=resolve('docs');
const server=http.createServer(async(req,res)=>{
 try{const u=new URL(req.url,'http://localhost');const pathname=decodeURIComponent(u.pathname).replace(/^\/sam-study-room(?=\/|$)/,'');const file=resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403).end();return;}
 const data=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream','Cache-Control':'no-store','Permissions-Policy':'camera=(), microphone=()'}).end(data);
 }catch{res.writeHead(404).end('Not found');}
});
server.listen(8787,'127.0.0.1',()=>console.log('Static preview: http://localhost:8787/sam-study-room/ (backend: Supabase)'));
