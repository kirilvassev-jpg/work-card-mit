/* Discoverable, user-scoped recovery records. No credentials or API responses are stored here. */
(function (root) {
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function list(storage,scope,identity,archived=false){
    if(!identity)return [];
    const prefix=(archived?'wc_recovery:v1:':'wc_draft:v1:')+scope+':'+identity+':',result=[];
    try{
      for(let i=0;i<storage.length;i++){
        const key=storage.key(i);if(!key?.startsWith(prefix))continue;
        try{
          const data=JSON.parse(storage.getItem(key)),card=data?.legacyPending?.card;
          if(data.version!==1||!uuid.test(card?.id)||card.request_id&&!uuid.test(card.request_id))continue;
          result.push({key,data,card,requestId:card.request_id||null});
        }catch(error){/* A corrupt draft does not hide other valid pending submissions. */}
      }
    }catch(error){return [];}
    return result.sort((a,b)=>String(b.data.savedAt||'').localeCompare(String(a.data.savedAt||'')));
  }
  function resume(session,item,identity){
    const card=item.card;
    if(!uuid.test(card.id)||card.request_id&&!uuid.test(card.request_id))throw Error('Невалиден незавършен запис.');
    session.removeItem('workcard_request_id');session.removeItem('workcard_request_data');
    if(card.request_id){
      session.setItem('workcard_request_id',card.request_id);
      session.setItem('workcard_request_data',JSON.stringify({client_name:card.client,vehicle:card.vehicle,reg_number:card.reg_number,km_hours:card.km_hours,assigned_mechanics:card.mechanic,responsible_mechanic:card.mechanic[0],activity_type:String(card.activity_type||'').split(',').map(s=>s.trim())}));
    }
    session.setItem('workcard_prefill_mechanic',identity);session.setItem('workcard_from_tablet','1');
  }
  function archive(storage,key,data,reason){
    if(!key?.startsWith('wc_draft:v1:')||!uuid.test(data?.legacyPending?.card?.id))throw Error('Няма незавършен запис за проверка.');
    const receipt={...data,version:1,terminal:true,reason:String(reason),savedAt:new Date().toISOString()};
    const archiveKey=key.replace('wc_draft:v1:','wc_recovery:v1:')+':'+receipt.legacyPending.card.id;
    // Keep the live draft if either storage operation fails.
    storage.setItem(archiveKey,JSON.stringify(receipt));
    storage.removeItem(key);
    return receipt;
  }
  root.WC_PENDING_CARDS={list,resume,archive};
})(globalThis);
