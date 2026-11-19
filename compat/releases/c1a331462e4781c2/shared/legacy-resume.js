(function (root) {
  function node(tag,text){const el=document.createElement(tag);if(text)el.textContent=text;return el;}
  function section(title){const el=node('section');el.style.cssText='margin:12px auto;padding:14px;max-width:900px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;';el.append(node('h3',title));return el;}
  function receipt(data){
    const box=section('Запис за проверка от ръководителя');box.setAttribute('role','status');
    box.append(node('p',data.reason),node('p','ID на картата: '+data.legacyPending.card.id),node('p','Данните са запазени на това устройство. Можеш да започнеш следваща карта от таблото.'));
    const link=node('a','Към таблото');link.href='tablet.html';box.append(link);
    const form=document.getElementById('workCardForm');form.before(box);
  }
  root.WC_LEGACY_RESUME={receipt};
  document.addEventListener('DOMContentLoaded',function(){
    if(!document.getElementById('screenTasks')||sessionStorage.getItem('workcard_role')!=='mechanic')return;
    const identity=sessionStorage.getItem('workcard_user');
    const scope=typeof API_URL==='string'?API_URL:'';
    const pending=WC_PENDING_CARDS.list(localStorage,scope,identity),archived=WC_PENDING_CARDS.list(localStorage,scope,identity,true);
    if(!pending.length&&!archived.length)return;
    const box=section('Записи за довършване и проверка');box.id='pendingCards';
    for(const item of pending){
      const row=node('div');row.style.cssText='padding:10px 0;border-bottom:1px solid #e2e8f0;';
      row.append(node('p',(item.card.vehicle||'Работна карта')+' — '+(item.card.reg_number||'')),node('p','ID: '+item.card.id));
      const button=node('button','Продължи същата карта');button.type='button';button.style.cssText='padding:10px;border:0;border-radius:8px;background:#1a3a8f;color:white;';
      button.onclick=function(){WC_PENDING_CARDS.resume(sessionStorage,item,identity);location.href='index.html';};row.append(button);box.append(row);
    }
    if(archived.length){
      box.append(node('h4','За проверка от ръководителя'));
      for(const item of archived){
        const details=node('details');details.append(node('summary',(item.card.reg_number||'Карта')+' · ID: '+item.card.id));
        details.append(node('p',item.data.reason));
        for(const [label,value] of [['Машина',item.card.vehicle],['Клиент',item.card.client],['Механици',(item.card.mechanic||[]).join(', ')],['Човекочасове',item.card.work_hours],['Дейности и бележки',item.card.notes]])if(value!=null&&value!=='')details.append(node('p',label+': '+value));
        for(const material of item.data.legacyPending.materials||[])details.append(node('p',material.item_type+' — '+material.quantity+' '+material.unit));
        box.append(details);
      }
    }
    document.getElementById('screenTasks').prepend(box);
  });
})(globalThis);
