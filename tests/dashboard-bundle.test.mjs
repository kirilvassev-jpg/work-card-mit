import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {renderDashboardBundle,dashboardBundleUrl} from '../scripts/build-dashboard-bundle.mjs';

test('Dashboard bundle matches reviewed sources and keeps authentication mandatory without external imports',async()=>{
  const code=await readFile(dashboardBundleUrl,'utf8');
  assert.equal(code,await renderDashboardBundle(),'Rebuild the Dashboard artifact after editing its modular sources.');
  assert.doesNotMatch(code,/^\s*(import|export)\s/m);
  let handler;const calls=[];
  const env={SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only-server-key',WC_ENTRA_CLIENT_ID:'11111111-1111-4111-8111-111111111111',WC_ENTRA_TENANT_ID:'22222222-2222-4222-8222-222222222222',WC_ALLOWED_ORIGINS:'http://localhost:3000',ALLOWED_ORIGINS:'https://legacy.invalid'};
  const context=vm.createContext({Deno:{env:{get:name=>env[name]},serve:fn=>{handler=fn;}},crypto,atob,URL,Request,Response,TextEncoder,TextDecoder,AbortSignal,console,
    fetch:async(url,options)=>{calls.push({url,options});return Response.json([]);}});
  new vm.Script(code,{filename:'api-proxy-v2.ts'}).runInContext(context);
  const request=body=>new Request('https://edge.invalid',{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify(body)});
  const denied=await handler(request({path:'work_cards',method:'GET',role:'admin'}));
  assert.equal(denied.status,401);assert.equal(calls.length,0);
  const health=await handler(request({action:'health',path:'user_roles'}));
  assert.equal(health.status,200);assert.deepEqual(await health.json(),{ok:true});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://db.invalid/rest/v1/nomenclatures?select=id&limit=0');
  const legacyOrigin=await handler(new Request('https://edge.invalid',{method:'POST',headers:{Origin:'https://legacy.invalid'},body:JSON.stringify({action:'health'})}));
  assert.equal(legacyOrigin.status,403);assert.equal(calls.length,1);
});
