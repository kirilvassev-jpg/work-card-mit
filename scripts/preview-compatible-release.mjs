import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {renderCompatibleRelease} from './build-compatible-release.mjs';
import {createDemoApi} from './demo-api.mjs';

// Default preview uses isolated data. Real-backend mode is explicit and keeps production credentials unchanged.
export async function createCompatibilityPreview({backend=false,offlineControls=false}={}){
  const release=await renderCompatibleRelease(),demo=createDemoApi();
  let offline=false;
  const legacyReader=(await demo({action:'demo_login',role:'manager'})).data.token;
  const legacyUrl='https://wcsdjfsohqanxcppcvvk.supabase.co/functions/v1/api-proxy';
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png'};
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try {
      const url=new URL(req.url,'http://localhost');
      let file=decodeURIComponent(url.pathname).replace(/^\//,'').replace(/^work-card-mit\//,'');
      if(!file)file='login.html';
      if(!backend&&offlineControls&&req.method==='POST'&&['__preview/offline','__preview/online'].includes(file)){
        if(req.headers.origin&&!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(req.headers.origin)){res.writeHead(403);res.end();return;}
        offline=file==='__preview/offline';res.writeHead(200,{'Content-Type':mime['.json']});res.end(JSON.stringify({offline}));return;
      }
      if(offline){req.socket.destroy();return;}
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
        if(!backend&&offlineControls){
          const controls=`<aside style="padding:12px;background:#fff3cd;position:fixed;right:8px;top:8px;z-index:9999;font:12px sans-serif;"><span id="previewWorkerStatus">Подготовка на офлайн файловете…</span> <button id="previewOffline" type="button"></button></aside>
<script>(function(){
var button=document.getElementById('previewOffline'),status=document.getElementById('previewWorkerStatus');
function label(){button.textContent=sessionStorage.getItem('wc_preview_offline')==='1'?'Върни връзката':'Проба без връзка';}
label();
button.onclick=async function(){var off=sessionStorage.getItem('wc_preview_offline')!=='1';await fetch('/__preview/'+(off?'offline':'online'),{method:'POST'});sessionStorage.setItem('wc_preview_offline',off?'1':'0');label();status.textContent=off?'Проба без връзка — само кеш':'Връзката е възстановена';};
if('serviceWorker' in navigator)navigator.serviceWorker.ready.then(function(){status.textContent='Офлайн файловете са готови';});
})();</script>`;
          const end=html.lastIndexOf('</body>');
          html=html.slice(0,end)+controls+html.slice(end);
        }
        data=Buffer.from(html);
      }
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:data);
    }catch(err){res.writeHead(500);res.end('Preview failed');}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const backend=process.argv.includes('--backend');
  const server=await createCompatibilityPreview({backend,offlineControls:process.argv.includes('--offline-controls')});
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  server.listen(Number(process.env.PORT||(backend?3000:3002)),'127.0.0.1',()=>console.log('http://localhost:'+server.address().port+'/login.html — '+(backend?'REAL DATABASE: changes are saved in production':'DEMO: no production API calls')));
}
