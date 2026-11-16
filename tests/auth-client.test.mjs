import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../auth.js',import.meta.url),'utf8');
function storage(initial={}) {
  const result={...initial};
  Object.defineProperties(result,{getItem:{value:k=>result[k]??null},setItem:{value:(k,v)=>{result[k]=String(v);}},removeItem:{value:k=>{delete result[k];}}});return result;
}
test('switching backend/demo invalidates old credentials and keeps device credentials separate',async()=>{
  const sessionStorage=storage({workcard_token:'real-token',workcard_role:'admin'}),localStorage=storage({wc_device_token:'real-device-secret'}),calls=[];
  const context={WC_CONFIG:{demo:true,apiUrl:'/__demo/api',clientId:'client',tenantId:'tenant'},sessionStorage,localStorage,location:{pathname:'/login.html'},navigator:{onLine:true},document:{addEventListener(){}},Headers,Response,AbortSignal,fetch:async(url,opts)=>{calls.push({url,opts});return Response.json({error:'login required'},{status:401});}};
  context.window=context;vm.createContext(context);vm.runInContext(source,context);
  assert.equal(context.WC_AUTH.escapeHTML('" onerror="x\' <script>&'), '&quot; onerror=&quot;x&#39; &lt;script&gt;&amp;');
  assert.equal(sessionStorage.getItem('workcard_token'),null);assert.equal(localStorage.getItem('wc_device_token'),'real-device-secret');assert.equal(context.WC_AUTH.deviceToken(),null);
  await context.WC_AUTH.request({action:'session'});
  assert.equal(calls[0].opts.headers.get('Authorization'),null);assert.equal(calls[0].opts.headers.get('x-device-token'),null);
});
