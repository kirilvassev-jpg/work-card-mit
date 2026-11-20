const categories=new Set(['filter','oil','antifreeze','bulb','quick_coupling','teeth','other']);
const units=new Set(['брой','литри','кг','м']);
const text=(value,max=200)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
export function operations(value){
  if(value==null)return [];
  if(!Array.isArray(value)||value.length>40||!value.every(item=>text(item)))throw Error('Невалиден списък с дейности (до 40 позиции).');
  const result=value.map(item=>item.trim());
  if(new Set(result.map(item=>item.toLocaleLowerCase('bg-BG'))).size!==result.length)throw Error('Има повтарящи се дейности.');
  return result;
}
export function material(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['category','item_type','quantity','unit'].includes(key)))throw Error('Невалидни данни за материал.');
  if(!categories.has(value.category)||!text(value.item_type)||!units.has(value.unit)||typeof value.quantity!=='number'||!Number.isFinite(value.quantity)||value.quantity<=0||value.quantity>1000000)throw Error('Провери материала, мерната единица и количеството.');
  if(value.unit==='брой'&&!Number.isInteger(value.quantity))throw Error('Количеството в брой трябва да е цяло число.');
  return {...value,item_type:value.item_type.trim()};
}
export function materialKey(value){return JSON.stringify([value.category,value.item_type.trim().toLocaleLowerCase('bg-BG'),value.unit]);}
export function plannedMaterials(value){
  if(value==null)return [];
  if(!Array.isArray(value)||value.length>80)throw Error('Позволени са до 80 предложени материала.');
  const result=value.map(material);
  if(new Set(result.map(materialKey)).size!==result.length)throw Error('Има повтарящи се предложени материали.');
  return result;
}
export function mergeMaterials(existing,confirmed){
  const result=new Map();
  for(const row of [...existing,...confirmed]){
    const value=material(row),key=materialKey(value),old=result.get(key);
    if(old&&old.quantity!==value.quantity)throw Error('Материалът „'+value.item_type+'“ е въведен два пъти с различни количества. Остави го само на едно място.');
    result.set(key,value);
  }
  return [...result.values()];
}
export function actualCard(card,existing,selectedOperations,confirmedMaterials){
  const done=operations(selectedOperations),confirmed=plannedMaterials(confirmedMaterials);
  if(confirmed.length&&!card.has_materials)throw Error('Има потвърдени материали. Избери „Да“ за вложени материали или махни отметките.');
  const materials=mergeMaterials(existing,confirmed);
  if(!card.has_materials&&materials.length)throw Error('Материалите не съответстват на картата.');
  const notes=[card.notes||'',done.length?'Извършени дейности по заявката:\n'+done.map(item=>'• '+item).join('\n'):''].filter(Boolean).join('\n\n');
  return {card:{...card,notes:notes||null},materials};
}
export function reviewText(card,materials,done){
  return ['Провери работната карта преди запис:',card.vehicle+' · '+card.reg_number,'Човекочасове: '+card.work_hours,
    done.length?'\nИзвършени дейности:\n'+done.map(item=>'• '+item).join('\n'):'',
    '\nВложени материали:\n'+(materials.length?materials.map(item=>'• '+item.item_type+' — '+item.quantity+' '+item.unit).join('\n'):'Няма'),
    '\nНепотвърдените предложения не се отчитат.\nДа запиша ли картата?'].filter(Boolean).join('\n');
}
