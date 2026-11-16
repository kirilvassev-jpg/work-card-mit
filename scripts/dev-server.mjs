import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createDemoApi } from './demo-api.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
export async function createDevServer({backend=false,apiUrl=process.env.WC_API_URL || 'http://127.0.0.1:54321/functions/v1/api-proxy'}={}) {
  const demo=createDemoApi();
  const publicFiles=new Set((await readdir(root)).filter(f=>/\.(html|js|css|png)$/.test(f)).concat('manifest.json'));
  const mimes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png'};
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try {
      const url=new URL(req.url,'http://localhost');
      let file=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^work-card-mit\//,'');
      if(!file)file='login.html';
      if(!['GET','HEAD'].includes(req.method) && !(req.method==='POST' && file==='__demo/api' && !backend)){res.writeHead(405);res.end();return;}
      if(file==='__demo/api' && !backend){
        // No listening on the LAN and no cross-origin browser access to demo sessions.
        const origin=req.headers.origin;
        if(origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)){res.writeHead(403);res.end();return;}
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>6000000){res.writeHead(413);res.end();return;}}
        let input;try{input=JSON.parse(raw);}catch{res.writeHead(400);res.end('{"error":"Невалиден JSON"}');return;}
        const result=await demo(input,req.headers);res.writeHead(result.status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(result.data));return;
      }
      if(file==='app-config.js'){
        const base=await readFile(path.join(root,file),'utf8');
        const settings={apiUrl:backend?apiUrl:'/__demo/api',demo:!backend,...(process.env.WC_ENTRA_CLIENT_ID?{clientId:process.env.WC_ENTRA_CLIENT_ID}:{}),...(process.env.WC_ENTRA_TENANT_ID?{tenantId:process.env.WC_ENTRA_TENANT_ID}:{}),...(process.env.WC_ENTRA_SCOPE?{apiScope:process.env.WC_ENTRA_SCOPE}:{})};
        res.writeHead(200,{'Content-Type':mimes['.js']});res.end(base+'\nObject.assign(window.WC_CONFIG,'+JSON.stringify(settings)+');');return;
      }
      if(!publicFiles.has(file) && !/^icons\/icon-(192|512)\.png$/.test(file)){res.writeHead(404);res.end('Not found');return;}
      const data=await readFile(path.join(root,file));res.writeHead(200,{'Content-Type':mimes[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:data);
    }catch(err){res.writeHead(err.code==='ENOENT'?404:500);res.end('Unable to serve this file');}
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const backend=process.argv.includes('--backend');
  const server=await createDevServer({backend});
  server.on('error',err=>{console.error(err.code==='EADDRINUSE'?'Портът е зает. Спри другия сървър или задай PORT.':err.message);process.exitCode=1;});
  server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log(`Работни карти: http://localhost:${server.address().port}/login.html\nРежим: ${backend?'Supabase backend (виж WC_API_URL)':'ДЕМО — само примерни данни, нулират се при рестарт'}\nСпиране: Ctrl+C`));
}
