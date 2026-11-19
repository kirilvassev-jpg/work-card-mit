import {operations,plannedMaterials,actualCard,reviewText} from './plan-model.mjs';
function node(tag,props={},text){const value=document.createElement(tag);Object.assign(value,props);if(text!=null)value.textContent=text;return value;}
export function createPlanSession(record={}){
  let tasks=operations(record.planned_operations).map(name=>({name,done:false}));
  let materials=plannedMaterials(record.planned_materials).map(item=>({...item,used:false,plannedQuantity:item.quantity}));
  const required=tasks.length>0;
  return {
    get tasks(){return tasks;},get materials(){return materials;},
    snapshot:()=>({tasks:JSON.parse(JSON.stringify(tasks)),materials:JSON.parse(JSON.stringify(materials))}),
    restore(value){
      if(!value||!Array.isArray(value.tasks)||!Array.isArray(value.materials))return;
      const names=operations(value.tasks.map(item=>item.name));
      const normalized=plannedMaterials(value.materials.map(({used,plannedQuantity,...item})=>({...item,quantity:1})));
      tasks=names.map((name,index)=>({name,done:value.tasks[index].done===true}));
      materials=normalized.map((item,index)=>({...item,quantity:Number.isFinite(value.materials[index].quantity)?value.materials[index].quantity:0,used:value.materials[index].used===true,plannedQuantity:value.materials[index].plannedQuantity??null}));
    },
    addTask(name){const all=operations([...tasks.map(item=>item.name),name]);tasks.push({name:all.at(-1),done:true});},
    addMaterial(item){const all=plannedMaterials([...materials.map(({used,plannedQuantity,...item})=>({...item,quantity:1})),item]);materials.push({...all.at(-1),used:true,plannedQuantity:null});},
    prepare(card,existing){
      const done=tasks.filter(item=>item.done).map(item=>item.name);
      if(required&&!done.length)throw Error('Отбележи извършената дейност по заявката или добави действително извършената друга дейност.');
      return actualCard(card,existing,done,materials.filter(item=>item.used).map(({used,plannedQuantity,...item})=>item));
    },
    review:(card,mats)=>reviewText(card,mats,tasks.filter(item=>item.done).map(item=>item.name)),
    clear(){tasks.forEach(item=>item.done=false);materials.forEach(item=>item.used=false);}
  };
}

if(typeof window!=='undefined'){
  let session,container,ready=false;
  function changed(){window.WC_DRAFTS?.save();}
  function render(){
    if(!container||!session)return;
    container.replaceChildren();container.append(node('h3',{},'Чернова по заявката — предложения'));
    container.append(node('p',{className:'wp-muted'},'Потвърди само действително извършеното и вложеното. Количествата от заявката са предложения.'));
    for(const item of session.tasks){
      const row=node('div',{className:'wp-operation'}),label=node('label'),checkbox=node('input',{type:'checkbox',checked:item.done});
      const state=node('span',{className:'wp-state'},item.done?'Изпълнено':'Предложено');
      checkbox.addEventListener('change',()=>{item.done=checkbox.checked;state.textContent=item.done?'Изпълнено':'Предложено';state.classList.toggle('wp-done',item.done);changed();});
      label.style.cssText='display:flex;align-items:center;gap:8px;flex:1';label.append(checkbox,node('span',{},item.name));row.append(label,state);container.append(row);
    }
    const addOperation=node('div',{className:'wp-extra'}),operationName=node('input',{type:'text',placeholder:'Друга извършена дейност',maxLength:200,ariaLabel:'Друга извършена дейност'}),addTask=node('button',{type:'button'},'Добави');
    addTask.onclick=()=>{try{session.addTask(operationName.value);render();changed();}catch(error){alert(error.message);}};addOperation.append(operationName,addTask);container.append(addOperation);
    const heading=node('h3',{},'Предложени материали');heading.style.marginTop='16px';container.append(heading);
    for(const item of session.materials){
      const row=node('div',{className:'wp-material'}),label=node('label'),checkbox=node('input',{type:'checkbox',checked:item.used});
      const detail=node('span'),state=node('small',{className:'wp-state'},item.used?'Вложено':'Предложено');
      detail.append(node('span',{},item.item_type),document.createElement('br'),state);
      if(item.plannedQuantity!=null)detail.append(node('small',{className:'wp-muted'},' · По заявка: '+item.plannedQuantity+' '+item.unit));
      const quantity=node('input',{type:'number',min:'0.01',max:'1000000',step:item.unit==='брой'?'1':'0.1',value:String(item.quantity),ariaLabel:'Реално количество: '+item.item_type});
      quantity.addEventListener('input',()=>{item.quantity=Number(quantity.value);changed();});
      checkbox.addEventListener('change',()=>{item.used=checkbox.checked;state.textContent=item.used?'Вложено':'Предложено';state.classList.toggle('wp-done',item.used);if(item.used)window.toggleMaterials(true);changed();});
      label.append(checkbox,detail);row.append(label,quantity,node('span',{},item.unit));container.append(row);
    }
    const addMaterial=node('div',{className:'wp-extra'}),name=node('input',{type:'text',placeholder:'Друг вложен материал',maxLength:200,ariaLabel:'Друг вложен материал'}),qty=node('input',{type:'number',value:'1',min:'0.01',ariaLabel:'Количество на другия материал'}),unit=node('select',{ariaLabel:'Мерна единица'}),add=node('button',{type:'button'},'Добави');
    ['брой','литри','кг','м'].forEach(value=>unit.add(new Option(value,value)));qty.style.maxWidth='80px';
    add.onclick=()=>{try{session.addMaterial({category:'other',item_type:name.value,quantity:Number(qty.value),unit:unit.value});window.toggleMaterials(true);render();changed();}catch(error){alert(error.message);}};
    addMaterial.style.flexWrap='wrap';addMaterial.append(name,qty,unit,add);container.append(addMaterial);
  }
  window.WC_REQUEST_PLAN={
    async init({apiUrl,requestId}){
      ready=false;
      let record={},warning='';
      container=node('section',{className:'section work-plan'});container.dataset.step='2';container.id='workRequestPlan';
      document.getElementById('workCardForm').append(container);
      if(requestId){
        try{
          const response=await fetch(apiUrl,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({path:'service_requests?id=eq.'+requestId+'&select=id,planned_operations,planned_materials',method:'GET'})});
          if(!response.ok)throw Error('Планът не е зареден. Можеш да попълниш действително извършеното ръчно.');
          record=(await response.json())[0]||{};
        }catch(error){warning=error.message;}
      }
      try{session=createPlanSession(record);render();}catch(error){session=createPlanSession();render();container.prepend(node('p',{className:'wp-error'},'Провери плана на заявката: '+error.message));}
      if(warning)container.prepend(node('p',{className:'wp-error'},warning));
      ready=true;
      window.goStep(typeof currentStep==='number'?currentStep:1,true);
    },
    prepare(card,materials){try{if(!ready)throw Error('Изчакай зареждането на предложенията по заявката.');return session?session.prepare(card,materials):{card,materials};}catch(error){window.goStep(2,true);throw error;}},
    review:(card,materials)=>session?session.review(card,materials):reviewText(card,materials,[]),
    snapshot:()=>session?.snapshot(),
    restore(value){if(session&&value){session.restore(value);render();}},
    clear(){if(session){session.clear();render();}}
  };
}
