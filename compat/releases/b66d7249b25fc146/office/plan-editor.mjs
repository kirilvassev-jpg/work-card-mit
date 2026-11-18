import {operations,plannedMaterials} from './plan-model.mjs';
const groups=[['filter','Филтър','брой'],['oil','Масло','литри'],['antifreeze','Антифриз','литри'],['bulb','Крушка','брой'],['quick_coupling','Бърза връзка','брой'],['teeth','Зъб','брой'],['other','Друг материал','брой']];
function element(tag,props={},text){const node=document.createElement(tag);Object.assign(node,props);if(text!=null)node.textContent=text;return node;}
export function mount(container,record={}){
  container.replaceChildren();container.classList.add('work-plan');
  container.append(element('h3',{},'Планирани дейности и материали'));
  container.append(element('p',{className:'wp-muted'},'Показват се като предложения. Механикът потвърждава действително извършеното и вложеното.'));
  const label=element('label',{},'Дейности — по една на ред');
  const activity=element('textarea',{rows:3,placeholder:'Смяна на масло\nПроверка за течове',value:operations(record.planned_operations).join('\n')});label.append(activity);container.append(label);
  const rows=element('div',{className:'wp-editor-materials'});container.append(rows);
  function addMaterial(value={category:'filter',item_type:'',quantity:1,unit:'брой'}){
    const row=element('div',{className:'wp-editor-row'});
    const category=element('select',{'ariaLabel':'Категория материал'});
    groups.forEach(([key,name])=>category.add(new Option(name,key)));category.value=value.category;
    const name=element('input',{type:'text',placeholder:'Наименование на материал',maxLength:200,value:value.item_type,ariaLabel:'Наименование на материал'});
    const quantity=element('input',{type:'number',min:'0.01',max:'1000000',step:'0.1',value:String(value.quantity),ariaLabel:'Планирано количество'});
    const unit=element('select',{ariaLabel:'Мерна единица'});['брой','литри','кг','м'].forEach(name=>unit.add(new Option(name,name)));unit.value=value.unit;
    category.addEventListener('change',()=>{unit.value=groups.find(group=>group[0]===category.value)[2];});
    const remove=element('button',{type:'button'},'Премахни');remove.addEventListener('click',()=>row.remove());
    row.append(category,name,quantity,unit,remove);row.read=()=>({category:category.value,item_type:name.value,quantity:Number(quantity.value),unit:unit.value});rows.append(row);
  }
  plannedMaterials(record.planned_materials).forEach(addMaterial);
  const add=element('button',{type:'button'},'+ Предложи материал');add.addEventListener('click',()=>addMaterial());container.append(add);
  const editor={read:()=>({planned_operations:operations(activity.value.split('\n').map(value=>value.trim()).filter(Boolean)),planned_materials:plannedMaterials([...rows.children].map(row=>row.read()))}),clear:()=>{activity.value='';rows.replaceChildren();}};
  container.editor=editor;return editor;
}
if(typeof window!=='undefined'){
  window.WC_PLAN_EDITOR={mount};
  document.addEventListener('DOMContentLoaded',()=>{const container=document.getElementById('requestPlanEditor');if(container)mount(container);});
}
