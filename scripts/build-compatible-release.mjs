import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {hardenPage} from './harden-pages.mjs';

const root=new URL('../',import.meta.url);
const baselineRoot=new URL('compat/baseline/',root);
export const pages=['login.html','requests.html','assign.html','schedule.html','history.html','dashboard.html','index.html','tablet.html'];
const officeAssets=['app-config.js','auth.js','login.js','draft-store.js','drafts.js','plan-model.mjs','plan-editor.mjs','request-plan.mjs','work-plan.css','theme.css','ui.js','datepicker.js','Repairs.png','icons/icon-192.png','icons/icon-512.png'];
const sharedAssets=['draft-store.js','drafts.js','plan-model.mjs','request-plan.mjs','work-plan.css','safe-render.js','legacy-submit.js'];
const apiUrl='https://wcsdjfsohqanxcppcvvk.supabase.co/functions/v1/api-proxy-v2';
const digest=data=>createHash('sha256').update(data).digest('hex');

export function routerSource(prefix){
  return `(async function () {
  var page=location.pathname.split('/').pop() || 'index.html';
  var pages=${JSON.stringify(pages)};
  if (!pages.includes(page)) page='login.html';
  try {
    var role=sessionStorage.getItem('workcard_role');
    var office=page==='login.html' ? sessionStorage.getItem('wc_office_login_pending')==='1' : ['admin','manager','coordinator','office'].includes(role);
    // This only selects a screen. The office API independently verifies identity and role.
    var url=new URL(${JSON.stringify(prefix)}+(office?'office/':'legacy/')+page, location.href);
    var response=await fetch(url.href);
    if (!response.ok) throw Error('Неуспешно зареждане на страницата.');
    var html=await response.text();
    document.open(); document.write(html); document.close();
  } catch (error) {
    document.getElementById('loadStatus').textContent='Страницата не се зареди. Провери връзката и натисни „Опитай отново“.';
    document.getElementById('retry').hidden=false;
  }
})();\n`;
}

function bridgeSource(){
  return `// Office sign-in uses the existing login.html address; mechanic handlers stay unchanged.
window.loginMSAL = function () {
  if (!['admin','manager','coordinator'].includes(selectedRole)) return;
  sessionStorage.setItem('wc_office_login_pending','1');
  sessionStorage.setItem('wc_office_login_auto','1');
  sessionStorage.setItem('wc_office_login_role',selectedRole);
  location.reload();
};\n`;
}

function officePage(source,prefix){
  let html=source.toString('utf8');
  html=html.replace(/\s*<link\b[^>]*rel="manifest"[^>]*>/g,'');
  html=html.replace(/if\s*\(\s*['"]serviceWorker['"]\s+in\s+navigator\s*\)\s*\{\s*navigator\.serviceWorker\.register\(['"]sw\.js['"]\)\.catch\([^\n]*\);\s*\}/g,'');
  if(/navigator\.serviceWorker\.register\(/.test(html))throw Error('Unexpected service worker registration; review before release');
  html=html.replace(/\b(src|href)="([^"#?]+)"/g,(match,attribute,file)=>officeAssets.includes(file)?attribute+'="'+prefix+'office/'+file+'"':match);
  return hardenPage(html,prefix);
}

export function legacyWorkCard(source,prefix){
  let html=source.toString('utf8');
  const replace=(before,after)=>{if(html.split(before).length!==2)throw Error('Legacy work card changed; review integration: '+before.slice(0,55));html=html.replace(before,after);};
  replace('</head>','<link rel="stylesheet" href="'+prefix+'shared/work-plan.css">\n<script>window.WC_CONFIG={storageScope:"https://wcsdjfsohqanxcppcvvk.supabase.co/functions/v1/api-proxy",legacyDrafts:true};</script>\n<script src="'+prefix+'shared/draft-store.js"></script>\n<script src="'+prefix+'shared/drafts.js"></script>\n<script type="module" src="'+prefix+'shared/request-plan.mjs"></script>\n</head>');
  replace('        checkForRequest();','        checkForRequest();\n        await WC_REQUEST_PLAN.init({apiUrl:API_URL,requestId:window._currentRequestId});\n        WC_DRAFTS.init();');
  replace("    if (!confirm('Сигурен ли си, че искаш да запишеш тази работна карта?')) return;",'');
  replace("        const result = await supabaseInsert('work_cards', cardData);","        const prepared=WC_REQUEST_PLAN.prepare(cardData,hasMaterials?collectMaterials():[]);\n        if(!confirm(WC_REQUEST_PLAN.review(prepared.card,prepared.materials))) return;\n        if(!WC_DRAFTS.save()) throw Error('Черновата не е запазена. Провери паметта на устройството.');\n        const result = await supabaseInsert('work_cards', prepared.card);");
  replace('if (hasMaterials) { const materials = collectMaterials();','if (hasMaterials) { const materials = prepared.materials;');
  replace('        resetForm();','        WC_DRAFTS.clear();\n        WC_REQUEST_PLAN.clear();\n        resetForm();');
  replace('</head>','<script src="'+prefix+'shared/legacy-submit.js"></script>\n</head>');
  replace('    if (!validate()) return;','    if (!WC_DRAFTS.legacyPending() && !validate()) return;');
  replace('        const prepared=WC_REQUEST_PLAN.prepare(cardData,hasMaterials?collectMaterials():[]);','        const resumed=WC_DRAFTS.legacyPending();\n        const prepared=resumed?{card:resumed.card,materials:resumed.materials}:WC_REQUEST_PLAN.prepare(cardData,hasMaterials?collectMaterials():[]);');
  const start=html.indexOf('        const result = await supabaseInsert(\'work_cards\', prepared.card);');
  const end=html.indexOf('        // Карта без заявка, отворена от таблото',start);
  if(start<0||end<0)throw Error('Legacy submit changed; review resume integration');
  html=html.slice(0,start)+`        const pending=WC_DRAFTS.legacySubmission(prepared.card,prepared.materials);
        await WC_LEGACY_SUBMIT.submit(API_URL,pending);
        showStatus('✓ Картата и материалите са записани.', 'success');
        if (pending.card.request_id) {
            sessionStorage.removeItem('workcard_request_id');
            sessionStorage.removeItem('workcard_request_data');
            window._currentRequestId = null;
            setTimeout(() => { window.location.href = 'tablet.html'; }, 2000);
        }

`+html.slice(end);
  return html;
}

export async function renderCompatibleRelease(){
  const source=JSON.parse(await readFile(new URL('source.json',baselineRoot),'utf8'));
  const legacy=new Map(),modern=new Map();
  for(const file of source.files){
    const data=await readFile(new URL(file,baselineRoot));
    if(source.sha256?.[file]!==digest(data))throw Error('Legacy baseline changed: '+file);
    legacy.set(file,data);
  }
  for(const file of new Set([...pages,...officeAssets,...sharedAssets]))modern.set(file,await readFile(new URL(file,root)));
  const config={apiUrl,demo:false,legacyMechanicLogin:true,deviceRegistration:false};
  modern.set('app-config.js',Buffer.from(modern.get('app-config.js').toString('utf8')+'\nObject.assign(window.WC_CONFIG,'+JSON.stringify(config)+');\n'));
  let officeLogin=modern.get('login.html').toString('utf8');
  officeLogin=officeLogin.replace(/<div id="deviceCodeWrap">[\s\S]*?<\/div>/,'');
  officeLogin=officeLogin.replaceAll('С регистрирано устройство','Вход за механици').replaceAll('Регистриран таблет','Сегашен вход');
  modern.set('login.html',Buffer.from(officeLogin));
  const version=digest(Buffer.concat([...legacy.values(),...modern.values(),await readFile(fileURLToPath(import.meta.url)),await readFile(new URL('./harden-pages.mjs',import.meta.url))])).slice(0,16);
  const prefix='compat/releases/'+version+'/';
  const files=new Map(legacy);
  for(const page of pages){
    let old=legacy.get(page).toString('utf8');
    if(page==='login.html')old=old.replace('</body>','<script src="'+prefix+'office-bridge.js"></script>\n</body>');
    if(page==='index.html')old=legacyWorkCard(old,prefix);
    files.set(prefix+'legacy/'+page,Buffer.from(hardenPage(old,prefix)));
    files.set(prefix+'office/'+page,Buffer.from(officePage(modern.get(page),prefix)));
    files.set(page,Buffer.from('<!doctype html>\n<html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Работни карти</title></head><body><p id="loadStatus">Зареждане…</p><button id="retry" hidden onclick="location.reload()">Опитай отново</button><noscript>Включи JavaScript, за да отвориш приложението.</noscript><script src="'+prefix+'router.js"></script></body></html>\n'));
  }
  for(const asset of officeAssets)files.set(prefix+'office/'+asset,modern.get(asset));
  for(const asset of sharedAssets)files.set(prefix+'shared/'+asset,modern.get(asset));
  files.set(prefix+'router.js',Buffer.from(routerSource(prefix)));
  files.set(prefix+'office-bridge.js',Buffer.from(bridgeSource()));
  const metadata={version,prefix,baselineCommit:source.commit,baselineTree:source.tree,apiUrl,changedRootPages:pages,
    preservedRootAssets:source.files.filter(file=>!pages.includes(file)),
    files:Object.fromEntries([...files].map(([file,data])=>[file,digest(data)]))};
  files.set('compat/release.json',Buffer.from(JSON.stringify(metadata,null,2)+'\n'));
  return {files,metadata};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const release=await renderCompatibleRelease();
  const output=path.resolve(fileURLToPath(root),'.cache','compatible-release',release.metadata.version);
  for(const [file,data] of release.files){const target=path.join(output,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data);}
  console.log(JSON.stringify({output,files:release.files.size,version:release.metadata.version,baselineCommit:release.metadata.baselineCommit}));
}
