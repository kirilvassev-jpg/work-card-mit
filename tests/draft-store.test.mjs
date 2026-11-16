import test from 'node:test';
import assert from 'node:assert/strict';
import '../draft-store.js';
test('drafts survive reloads, remain separated by user/request, and clear after success',()=>{
  const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const store=WC_DRAFT_STORE(storage,'user1:request1');
  store.write({values:{vehicle:'Попълнена машина'},submissionId:'retry-id',pendingPayload:{card:{vehicle:'Попълнена машина'}}});
  assert.equal(WC_DRAFT_STORE(storage,'user1:request1').read().submissionId,'retry-id');
  assert.equal(WC_DRAFT_STORE(storage,'user2:request1').read(),null);
  assert.equal(WC_DRAFT_STORE(storage,'user1:request2').read(),null);
  store.clear();assert.equal(store.read(),null);
});
test('corrupt storage is ignored; full/blocked storage cannot report a successful save',()=>{
  const store=WC_DRAFT_STORE({getItem:()=>'{',setItem:()=>{throw new Error('quota');}},'x');
  assert.equal(store.read(),null);assert.throws(()=>store.write({values:{}}),/quota/);
});
