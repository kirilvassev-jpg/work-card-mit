import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {renderCompatibleRelease} from '../scripts/build-compatible-release.mjs';
const release=await renderCompatibleRelease();
const html=release.files.get(release.metadata.prefix+'legacy/index.html').toString();
const code=html.slice(html.indexOf('async function submitForm()'),html.indexOf('function showStatus(msg, type)'));
test('a terminal legacy conflict returns to the tablet so the next card cannot reuse the previous request draft key',async()=>{
  for(const archiveFails of [false,true]){
    const requestId=randomUUID(),pending={card:{id:randomUUID(),request_id:requestId,mechanic:['Механик']},materials:[]};
    const elements=new Map(),removed=[],messages=[];
    const element=id=>{if(!elements.has(id))elements.set(id,{value:'2',disabled:false,inert:false,remove(){}});return elements.get(id);};
    let archived=0,reset=0,planCleared=0,receipts=0;
    const context={navigator:{onLine:true},document:{getElementById:element,querySelectorAll:()=>[{dataset:{value:'Механик'}}]},
      getActivities:()=>['ТО / ППП'],hasTO:()=>true,hasRepair:()=>false,hasMaterials:false,getCheckedValues:()=>[],
      confirm:()=>true,WC_REQUEST_PLAN:{review:()=>'',clear(){planCleared++;}},
      WC_DRAFTS:{legacyPending:()=>pending,save:()=>true,legacySubmission:()=>pending,archivePending(reason){if(archiveFails)throw Error('full');archived++;return {legacyPending:pending,reason};}},
      WC_LEGACY_SUBMIT:{async submit(){const error=Error('Конфликт');error.terminal=true;throw error;}},WC_LEGACY_RESUME:{receipt(){receipts++;}},
      API_URL:'/mock',sessionStorage:{removeItem(key){removed.push(key);},getItem:()=>null},resetForm(){reset++;},showStatus(text){messages.push(text);},console:{error(){}},window:{_currentRequestId:requestId,location:{}}};
    vm.runInNewContext(code,context);await context.submitForm();
    if(archiveFails){
      assert.equal(context.window.location.href,undefined);assert.equal(reset,0);assert.equal(removed.length,0);assert.match(messages.at(-1),/освободи памет/);
    }else{
      assert.equal(context.window.location.href,'tablet.html');assert.equal(archived,1);assert.equal(reset,1);assert.equal(receipts,1);assert.equal(planCleared,1);
      assert.equal(context.window._currentRequestId,null);assert.ok(removed.includes('workcard_request_id'));assert.equal(element('workCardForm').inert,true);
    }
  }
});
