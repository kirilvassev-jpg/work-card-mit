import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { authorizePath, validateCard, HttpError, assert } from '../supabase/functions/api-proxy/policy.mjs';

export function createDemoApi() {
  const today = new Date().toISOString().slice(0, 10), now = new Date().toISOString();
  const sessions = new Map(), devices = [];
  const nomenclatures = [];
  for (const [group, values] of Object.entries({ mechanics: ['Демо механик', 'Втори механик'], activity_types: ['ТО / ППП', 'РЕМОНТ', 'ГАРАНЦИОНЕН РЕМОНТ'], services: ['Маслен филтър', 'Въздушен филтър'], repair_systems: ['Двигател', 'Ходова част'], repair_types: ['Текущ ремонт'], oils: ['Двигателно масло'], antifreezes: ['Антифриз'], bulbs: ['Крушка H7'], quick_couplings: ['Бърза връзка'], teeth: ['Зъб'] })) {
    values.forEach((value, i) => nomenclatures.push({ id: randomUUID(), group_name: group, value, label: value, sort_order: i, is_active: true }));
  }
  const tables = { nomenclatures, work_cards: [], work_card_materials: [], request_log: [], work_card_log: [], service_requests: [
    { id: randomUUID(), request_number: 'DEMO-001', client_name: 'Примерен клиент', client_type: 'ФЛ', client_phone: '0000000000', brand: 'Демо', model: 'Машина', vehicle: 'Демо Машина', reg_number: 'ДЕМО-01', description: 'Примерно техническо обслужване', activity_type: ['ТО / ППП'], status: 'Разпределена', priority: 'Нормален', assigned_mechanics: ['Демо механик'], responsible_mechanic: 'Демо механик', scheduled_at: today + 'T08:00:00', desired_date: today, estimated_hours: 2, created_at: now, assigned_at: now, updated_at: now, created_by: 'Демо координатор' },
    { id: randomUUID(), request_number: 'DEMO-002', client_name: 'Примерна фирма', client_type: 'ЮЛ', company_name: 'Демо сервиз ООД', vehicle: 'Демо Багер', brand: 'Демо', model: 'Багер', reg_number: 'ДЕМО-02', description: 'Примерна проверка на ходова част', activity_type: ['РЕМОНТ'], status: 'Нова', priority: 'Спешен', assigned_mechanics: [], created_at: now, updated_at: now, created_by: 'Демо координатор' }
  ] };
  const submissions = new Map();
  const identities = Object.fromEntries(['admin','manager','coordinator','Демо механик','Втори механик'].map(k => [k, randomUUID()]));
  const digest = s => createHash('sha256').update(s).digest('hex');
  const log = (table, fields) => tables[table].push({ id: randomUUID(), created_at: new Date().toISOString(), ...fields });
  function matches(row, key, filter) {
    let value = key === 'work_cards.work_date' ? tables.work_cards.find(c => c.id === row.work_card_id)?.work_date : row[key];
    const dot = filter.indexOf('.'), op = filter.slice(0,dot), arg = filter.slice(dot+1);
    if (op === 'eq') return String(value) === arg;
    if (op === 'is') return arg === 'null' ? value == null : String(value) === arg;
    if (op === 'in') return arg.slice(1,-1).split(',').includes(String(value));
    if (op === 'cs') { const values = arg.startsWith('[') ? JSON.parse(arg) : JSON.parse('[' + arg.slice(1,-1) + ']'); return values.every(v => Array.isArray(value) && value.includes(v)); }
    if (op === 'gte') return value != null && value >= arg;
    if (op === 'gt') return value != null && value > arg;
    if (op === 'lte') return value != null && value <= arg;
    if (op === 'lt') return value != null && value < arg;
    if (op === 'ilike') return new RegExp('^' + arg.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*') + '$','i').test(value || '');
    throw new HttpError(400, 'Неподдържан демо филтър: ' + op);
  }
  return async function demoApi(input, headers = {}) {
    try {
      if (input.action === 'demo_bootstrap') return { status: 200, data: structuredClone(nomenclatures.filter(n => n.group_name === 'mechanics')) };
      if (input.action === 'demo_login') {
        assert(['admin','manager','coordinator','mechanic'].includes(input.role), 400, 'Избери роля.');
        assert(input.role !== 'mechanic' || ['Демо механик','Втори механик'].includes(input.mechanic), 400, 'Избери механик.');
        const user = { id: identities[input.mechanic || input.role], role: input.role, name: input.role === 'mechanic' ? input.mechanic : 'Демо ' + input.role, ...(input.role === 'mechanic' ? { mechanic: input.mechanic } : {}) };
        const token = randomBytes(32).toString('hex'); sessions.set(token, user);
        return { status: 200, data: { user, token } };
      }
      const token = (headers.authorization || '').replace(/^Bearer /,'');
      let user = sessions.get(token);
      if (headers['x-device-token']) {
        const device = devices.find(d => d.token_hash === digest(headers['x-device-token']) && !d.revoked_at && new Date(d.expires_at) > new Date());
        user = device && { id: device.id, role: 'mechanic', name: device.mechanic, mechanic: device.mechanic, deviceName: device.name };
      }
      assert(user, 401, 'Влез в демо профил.');
      if (input.action === 'session') return { status: 200, data: user };
      if (['list_devices','register_device','revoke_device'].includes(input.action)) {
        assert(['manager','admin'].includes(user.role), 403, 'Нужен е ръководител.');
        if (input.action === 'list_devices') return { status: 200, data: devices.map(({token_hash, ...rest}) => rest) };
        if (input.action === 'register_device') {
          assert(typeof input.name === 'string' && input.name.trim() && identities[input.mechanic], 400, 'Въведи име и механик.');
          const code = randomBytes(32).toString('hex');
          const device = { id: randomUUID(), name: input.name, mechanic: input.mechanic, created_at: new Date().toISOString(), expires_at: new Date(Date.now()+90*86400000).toISOString(), token_hash: digest(code) };
          devices.push(device); return { status: 201, data: { id: device.id, token: code, expires_at: device.expires_at } };
        }
        const device = devices.find(d => d.id === input.id); assert(device,404,'Няма такова устройство.'); device.revoked_at = new Date().toISOString();
        return { status: 200, data: { ok: true } };
      }
      if (input.action === 'start_task') {
        assert(['mechanic','manager','admin'].includes(user.role),403,'Няма право.');
        const mechanic = user.mechanic || input.mechanic;
        const task = tables.service_requests.find(r => r.id === input.id);
        assert(task && task.assigned_mechanics.includes(mechanic),403,'Не си назначен.');
        assert(['Разпределена','В изпълнение'].includes(task.status),409,'Задачата е приключена.');
        if (task.status !== 'В изпълнение') {
          task.status='В изпълнение'; task.started_at=new Date().toISOString();
          log('request_log',{request_id:task.id,action:'started',performed_by:user.name,details:'Задачата е започната'});
        }
        return { status:200, data:{ok:true} };
      }
      if (input.action === 'submit_work_card' || input.action === 'update_work_card') {
        assert(['mechanic','manager','admin'].includes(user.role),403,'Няма право за запис.');
        const {card,materials}=validateCard(input.card,input.materials || []);
        const payload=JSON.stringify({card,materials});
        if (input.action === 'submit_work_card' && submissions.has(input.submissionId)) {
          const saved=submissions.get(input.submissionId);
          assert(saved.actor===user.id && saved.payload===payload,409,'Този идентификатор вече е използван.');
          return {status:200,data:{id:saved.id,replayed:true}};
        }
        const task = card.request_id && tables.service_requests.find(r=>r.id===card.request_id);
        if (user.role==='mechanic') {
          assert(input.action === 'submit_work_card' && card.mechanic.includes(user.mechanic),403,'Можеш да записваш само свои карти.');
          assert(task ? task.assigned_mechanics.includes(user.mechanic) && card.mechanic.every(m=>task.assigned_mechanics.includes(m)) : card.mechanic.length===1,403,'Не си назначен към заявката.');
        }
        if (card.request_id && input.action === 'submit_work_card') assert(task && !task.work_card_id && ['Разпределена','В изпълнение'].includes(task.status),409,'Заявката вече е приключена.');
        let result;
        if (input.action === 'update_work_card') {
          result=tables.work_cards.find(c=>c.id===input.id); assert(result,404,'Картата липсва.');
          assert((card.request_id || null)===(result.request_id || null),400,'Свързаната заявка не може да се сменя.');
          Object.assign(result,card);
          tables.work_card_materials=tables.work_card_materials.filter(m=>m.work_card_id!==result.id);
        } else {
          assert(typeof input.submissionId==='string',400,'Липсва идентификатор.');
          result={id:randomUUID(),created_at:new Date().toISOString(),...card}; tables.work_cards.push(result);
          submissions.set(input.submissionId,{id:result.id,actor:user.id,payload});
          if(task){task.status='Изпълнена';task.completed_at=new Date().toISOString();task.work_card_id=result.id;log('request_log',{request_id:task.id,action:'completed',performed_by:user.name,details:'Картата е записана'});}
        }
        materials.forEach(m=>tables.work_card_materials.push({id:randomUUID(),work_card_id:result.id,...m}));
        log('work_card_log',{work_card_id:result.id,action:input.action==='update_work_card'?'edited':'created',performed_by:user.name,details:'Работна карта'});
        return {status:200,data:{id:result.id,replayed:false}};
      }
      assert(!input.action,400,'Непозната операция.');
      if (input.method === 'DELETE' && input.path?.startsWith('work_cards?')) {
        assert(['admin','manager'].includes(user.role),403,'Няма право за изтриване.');
        const filter=new URLSearchParams(input.path.split('?')[1]).get('id');
        assert(filter?.startsWith('eq.'),400,'Нужна е конкретна карта.');
        const id=filter.slice(3), card=tables.work_cards.find(c=>c.id===id);
        assert(card,404,'Картата липсва.');
        tables.work_cards=tables.work_cards.filter(c=>c.id!==id);
        tables.work_card_materials=tables.work_card_materials.filter(m=>m.work_card_id!==id);
        tables.work_card_log.forEach(l=>{if(l.work_card_id===id)l.work_card_id=null;});
        tables.service_requests.filter(r=>r.work_card_id===id).forEach(r=>{r.work_card_id=null;r.completed_at=null;r.status='В изпълнение';});
        log('work_card_log',{work_card_id:null,action:'deleted',performed_by:user.name,details:'Изтрита карта: '+id});
        return {status:200,data:{ok:true}};
      }
      const allowed=authorizePath(input,user), url=new URL(allowed.path,'http://demo.invalid');
      let rows=tables[allowed.table].filter(row=>[...url.searchParams].every(([k,v])=>['select','order','limit','offset'].includes(k) || matches(row,k,v)));
      if(allowed.method==='POST'){
        const row={id:randomUUID(),created_at:new Date().toISOString(),...allowed.body};tables[allowed.table].push(row);return {status:200,data:[row]};
      }
      if(allowed.method==='PATCH'){rows.forEach(r=>Object.assign(r,allowed.body));return {status:200,data:rows};}
      if(allowed.method==='DELETE'){tables[allowed.table]=tables[allowed.table].filter(r=>!rows.includes(r));return {status:200,data:rows};}
      if(url.searchParams.get('order')){
        const parts=url.searchParams.get('order').split(',').map(x=>x.split('.'));
        rows.sort((a,b)=>{for(const [key,dir] of parts){const c=String(a[key]||'').localeCompare(String(b[key]||''));if(c)return dir==='desc'?-c:c;}return 0;});
      }
      const offset=Number(url.searchParams.get('offset')||0);rows=rows.slice(offset,offset+Number(url.searchParams.get('limit')||10000));
      if(allowed.table==='work_card_materials' && url.searchParams.get('select')?.includes('work_cards!inner')) rows=rows.map(m=>({...m,work_cards:{work_date:tables.work_cards.find(c=>c.id===m.work_card_id)?.work_date}}));
      return {status:200,data:structuredClone(rows)};
    } catch(err) { return { status:err instanceof HttpError?err.status:500,data:{error:err.message} }; }
  };
}
