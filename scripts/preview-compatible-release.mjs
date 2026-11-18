import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {renderCompatibleRelease} from './build-compatible-release.mjs';
import {createDemoApi} from './demo-api.mjs';

// Default preview uses isolated data. Real-backend mode is explicit and keeps production credentials unchanged.
export async function createCompatibilityPreview({backend=false}={}){
  const release=await renderCompatibleRelease(),demo=createDemoApi();
  const legacyReader=(await demo({action:'demo_login',role:'manager'})).data.token;
  const legacyUrl='https://wcsdjfsohqanxcppcvvk.supabase.co/functions/v1/api-proxy';
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png'};
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try {
      const url=new URL(req.url,'http://localhost');
      let file=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^work-card-mit\//,'');
      if(!file)file='login.html';
      if(req.method==='POST'&&['__demo/api','__legacy/api'].includes(file)){
        if(backend){res.writeHead(405);res.end();return;}
        if(req.headers.origin&&!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(req.headers.origin)){res.writeHead(403);res.end();return;}
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>6000000){res.writeHead(413);res.end();return;}}
        let input;try{input=JSON.parse(raw);}catch{res.writeHead(400);res.end();return;}
        let result;
        if(file==='__demo/api')result=await demo(input,req.headers);
        else if((input.method||'GET')==='GET'){
          result=await demo(input,{authorization:'Bearer '+legacyReader});
        }else result={status:403,data:{error:'В тази проба старият API е само за преглед.'}};
        res.writeHead(result.status,{'Content-Type':mime['.json']});res.end(JSON.stringify(result.data));return;
      }
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      let data=release.files.get(file);
      if(!data){res.writeHead(404);res.end('Not found');return;}
      if(!backend&&file.endsWith('/office/app-config.js'))data=Buffer.from(data.toString('utf8')+'\nObject.assign(window.WC_CONFIG,{demo:true,apiUrl:"/__demo/api"});\n');
      // Simulate an already-enrolled legacy device in memory, only in this isolated preview.
      if(!backend&&file==='auth.js')data=Buffer.from(data.toString('utf8').replace('return localStorage.getItem(WC.DEVICE_KEY);',"return 'preview-only-existing-device';"));
      if(file.endsWith('.html')){
        let html=data.toString('utf8');
        if(!backend)html=html.replaceAll(legacyUrl,'/__legacy/api');
        const banner=backend?'ЛОКАЛНА ПРОВЕРКА — РЕАЛНАТА БАЗА. Записите променят действителните данни.':'ЛОКАЛНА ПРОБА — само примерни данни';
        html=html.replace(/<body\b[^>]*>/,'$&<div style="padding:8px;background:#fff3cd;text-align:center">'+banner+'</div>');
        data=Buffer.from(html);
      }
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:data);
    }catch(err){res.writeHead(500);res.end('Preview failed');}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const backend=process.argv.includes('--backend');
  const server=await createCompatibilityPreview({backend});
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  server.listen(Number(process.env.PORT||(backend?3000:3002)),'127.0.0.1',()=>console.log('http://localhost:'+server.address().port+'/login.html — '+(backend?'REAL DATABASE: changes are saved in production':'DEMO: no production API calls')));
}
