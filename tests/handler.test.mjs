import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/api-proxy/handler.mjs';
const tenant='11111111-1111-4111-8111-111111111111',client='22222222-2222-4222-8222-222222222222',oid='33333333-3333-4333-8333-333333333333';
const config={supabaseUrl:'https://db.invalid',serviceKey:'server-secret',tenantId:tenant,clientId:client,origins:['http://localhost:3000']};
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key',use:'sig'};
async function token(overrides={},key=pair.privateKey){
  const base={iss:`https://login.microsoftonline.com/${tenant}/v2.0`,tid:tenant,aud:client,oid,exp:Math.floor(Date.now()/1000)+300,nbf:Math.floor(Date.now()/1000)-10,scp:'access_as_user',name:'Verified manager',...overrides};
  const body=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(base)).toString('base64url');
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(body));return body+'.'+Buffer.from(sig).toString('base64url');
}
function setup(role='manager'){
  const calls=[];
  const handler=createHandler(config,{fetch:async(url,opts={})=>{
    calls.push({url,opts});
    if(url.includes('/discovery/'))return Response.json({keys:[jwk]});
    if(url.includes('/user_roles?'))return Response.json([{role,email:'demo@example.invalid'}]);
    if(url.includes('/registered_devices?'))return Response.json([]);
    if(url.includes('/rpc/'))return Response.json({id:oid});
    if(url.includes('nomenclatures?'))return Response.json([{value:'Демо механик'}]);
    return Response.json([]);
  }});return {handler,calls};
}
const request=(body,access,headers={})=>new Request('http://api.invalid',{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{}),...headers},body:JSON.stringify(body)});
test('unauthenticated and body-only legacy tokens cannot reach business data',async()=>{
  const {handler,calls}=setup();
  for(const body of [{path:'work_cards'},{path:'work_cards',token:'fake',role:'admin'}])assert.equal((await handler(request(body))).status,401);
  assert.equal(calls.length,0);
});
test('genuine RSA signature is verified and role comes from the immutable Microsoft identity',async()=>{
  const {handler,calls}=setup();const access=await token();
  const response=await handler(request({action:'session',role:'admin'},access));
  assert.equal(response.status,200);assert.equal((await response.json()).role,'manager');
  assert.ok(calls.some(c=>c.url.includes('microsoft_oid=eq.'+oid)&&c.url.includes('tenant_id=eq.'+tenant)));
});
test('wrong audience, issuer, tenant, lifetime, scope and forged signatures are rejected',async()=>{
  for(const overrides of [{aud:'https://graph.microsoft.com'},{iss:'https://evil.invalid'},{tid:oid},{exp:0},{nbf:Math.floor(Date.now()/1000)+1000},{scp:'User.Read'},{oid:'x&role=admin'}]){
    const {handler,calls}=setup();const response=await handler(request({path:'work_cards'},await token(overrides)));
    assert.ok([401,403].includes(response.status));assert.equal(calls.filter(c=>c.url.includes('/rest/')).length,0);
  }
  const {handler}=setup();const access=await token();
  const parts=access.split('.');parts[1]=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(parts[1],'base64url')),name:'forged'})).toString('base64url');
  assert.equal((await handler(request({action:'session'},parts.join('.')))).status,401);
});
test('revoked device is rejected and raw device credential is never queried or returned',async()=>{
  const {handler,calls}=setup();const raw='a'.repeat(64);
  assert.equal((await handler(request({action:'session'},null,{'x-device-token':raw}))).status,401);
  assert.ok(calls[0].url.includes('token_hash=eq.'));assert.ok(!calls[0].url.includes(raw));
});
test('CORS preflight supports both credentials; foreign origins and malformed bodies are rejected',async()=>{
  const {handler}=setup();
  const pre=await handler(new Request('http://api.invalid',{method:'OPTIONS',headers:{Origin:'http://localhost:3000'}}));
  assert.equal(pre.status,204);assert.match(pre.headers.get('access-control-allow-headers'),/x-device-token/);
  assert.equal((await handler(request({},null,{Origin:'https://evil.invalid'}))).status,403);
  const response=await handler(new Request('http://api.invalid',{method:'POST',headers:{Origin:'http://localhost:3000'},body:'{'}));assert.equal(response.status,400);
});
test('a signed coordinator cannot use the transactional write endpoint',async()=>{
  const {handler,calls}=setup('coordinator');
  const response=await handler(request({action:'submit_work_card',card:{}},await token()));
  assert.equal(response.status,403);assert.equal(calls.filter(c=>c.url.includes('/rpc/')).length,0);
});

test('a signed coordinator can correct request details but cannot alter assignment or completion',async()=>{
  const {handler,calls}=setup('coordinator');
  const access=await token();
  const path='service_requests?id=eq.'+oid;
  assert.equal((await handler(request({path,method:'PATCH',body:{client_name:'Коригирано име',notes:'Коментар'}},access))).status,200);
  const writes=()=>calls.filter(c=>c.opts.method==='PATCH');
  assert.equal(writes().length,1);
  assert.equal(JSON.parse(writes()[0].opts.body).client_name,'Коригирано име');
  for(const body of [{status:'Разпределена'},{assigned_mechanics:['Механик']},{work_card_id:oid},{completed_at:new Date().toISOString()}]){
    assert.equal((await handler(request({path,method:'PATCH',body},access))).status,403);
  }
  assert.equal((await handler(request({path,method:'DELETE'},access))).status,403);
  assert.equal(writes().length,1);
});
test('database error details and the service key are never exposed to clients',async()=>{
  const handler=createHandler(config,{verifyMicrosoft:async()=>({oid,tid:tenant}),fetch:async()=>Response.json({code:'XX001',message:'secret internal error server-secret'},{status:500})});
  const response=await handler(request({action:'session'},'valid'));assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/server-secret|XX001|internal/);
});
test('registered devices are bound to one mechanic and cannot promote themselves or record external services',async()=>{
  const deviceId='44444444-4444-4444-8444-444444444444';
  const writes=[];
  const handler=createHandler(config,{fetch:async(url,opts={})=>{
    if(url.includes('registered_devices?'))return Response.json([{id:deviceId,mechanic:'Демо механик',name:'Таблет 1'}]);
    if(url.includes('nomenclatures?'))return Response.json([{value:'Демо механик'}]);
    if(opts.method==='POST'){writes.push(JSON.parse(opts.body));return Response.json({id:oid});}
    return Response.json([]);
  }});
  const header={'x-device-token':'b'.repeat(64)};
  const session=await handler(request({action:'session',role:'admin'},null,header));assert.equal(session.status,200);assert.equal((await session.json()).role,'mechanic');
  assert.equal((await handler(request({path:'service_requests?id=eq.'+oid,method:'PATCH',body:{status:'Разпределена'},role:'admin'},null,header))).status,403);
  const card={mechanic:['Демо механик'],work_date:'2026-11-12',vehicle:'Машина',reg_number:'ДЕМО',client:'Клиент',activity_type:'РЕМОНТ',has_materials:false,work_hours:2};
  assert.equal((await handler(request({action:'submit_work_card',submissionId:client,card:{...card,external_service:true},materials:[]},null,header))).status,403);
  const ok=await handler(request({action:'submit_work_card',submissionId:client,card,materials:[],mechanic:'Друг'},null,header));assert.equal(ok.status,200);assert.equal(writes[0].p_mechanic,'Демо механик');assert.equal(writes[0].p_actor_id,deviceId);
});
test('device enrollment stores only a digest and returns the original credential once',async()=>{
  let saved;
  const handler=createHandler(config,{verifyMicrosoft:async()=>({oid,tid:tenant,name:'Manager'}),fetch:async(url,opts={})=>{
    if(url.includes('user_roles?'))return Response.json([{role:'manager',email:'manager@example.invalid'}]);
    if(url.includes('nomenclatures?'))return Response.json([{value:'Демо механик'}]);
    if(url.endsWith('/registered_devices')){saved=JSON.parse(opts.body);return Response.json([{id:client,...saved}]);}
    if(url.includes('registered_devices?'))return Response.json([{id:client,name:saved.name,mechanic:saved.mechanic}]);
    throw Error('Unexpected DB query');
  }});
  const response=await handler(request({action:'register_device',name:'Таблет 1',mechanic:'Демо механик'},'access'));assert.equal(response.status,201);
  const data=await response.json();assert.match(data.token,/^[a-f0-9]{64}$/);assert.notEqual(saved.token_hash,data.token);assert.equal(saved.token,undefined);
  const listed=await handler(request({action:'list_devices'},'access'));assert.doesNotMatch(await listed.text(),new RegExp(data.token+'|'+saved.token_hash));
});
