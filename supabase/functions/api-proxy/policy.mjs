export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function assert(ok, status, message) {
  if (!ok) throw new HttpError(status, message);
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CARD_FIELDS = new Set(('mechanic work_date vehicle reg_number km_hours client activity_type services repair_systems repair_type repair_description has_materials work_hours other_materials km_traveled notes request_id external_service external_service_note').split(' '));
const REQUEST_FIELDS = new Set(('request_number description activity_type desired_date priority client_type client_name client_email client_phone company_name bulstat contact_person brand model vehicle reg_number year_of_manufacture frame_number km_hours photo_data status created_by assigned_mechanics responsible_mechanic scheduled_at estimated_hours assigned_at started_at completed_at updated_at work_card_id notes').split(' '));
const REQUEST_DETAIL_FIELDS = new Set(('description activity_type desired_date priority client_type client_name client_email client_phone company_name bulstat contact_person brand model vehicle reg_number year_of_manufacture frame_number km_hours photo_data notes updated_at').split(' '));
const TABLES = new Set(['nomenclatures', 'service_requests', 'work_cards', 'work_card_materials', 'request_log', 'work_card_log']);
export function pickFields(body, allowed) {
  assert(body && typeof body === 'object' && !Array.isArray(body), 400, 'Невалидни данни.');
  assert(Object.keys(body).every(k => allowed.has(k)), 400, 'Непозволено поле.');
  return { ...body };
}
export function validateCard(card, materials) {
  card = pickFields(card, CARD_FIELDS);
  assert(Array.isArray(card.mechanic) && card.mechanic.length > 0 && card.mechanic.length <= 20 && card.mechanic.every(m => typeof m === 'string' && m.length > 0 && m.length < 200), 400, 'Избери механик.');
  assert(['vehicle', 'reg_number', 'client', 'activity_type'].every(k => typeof card[k] === 'string' && card[k].trim()), 400, 'Попълни машина, номер, клиент и дейност.');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(card.work_date || '') && !isNaN(Date.parse(card.work_date)), 400, 'Невалидна дата.');
  assert(typeof card.work_hours === 'number' && Number.isFinite(card.work_hours) && card.work_hours > 0 && card.work_hours <= 1000, 400, 'Невалидни човекочасове.');
  assert(card.km_traveled == null || (Number.isInteger(card.km_traveled) && card.km_traveled >= 0), 400, 'Невалидни километри.');
  assert(typeof card.has_materials === 'boolean', 400, 'Посочи дали има материали.');
  assert(!card.request_id || UUID.test(card.request_id), 400, 'Невалидна заявка.');
  assert(Array.isArray(materials) && materials.length <= 200, 400, 'Невалидни материали.');
  assert(card.has_materials || materials.length === 0, 400, 'Материалите не съответстват на картата.');
  materials = materials.map(m => {
    const value = pickFields(m, new Set(['category', 'item_type', 'quantity', 'unit']));
    assert(['category', 'item_type', 'unit'].every(k => typeof value[k] === 'string' && value[k].trim()), 400, 'Невалиден материал.');
    assert(typeof value.quantity === 'number' && Number.isFinite(value.quantity) && value.quantity > 0, 400, 'Невалидно количество.');
    return value;
  });
  return { card, materials };
}
export function authorizePath(input, principal) {
  const { role, mechanic } = principal;
  const method = input.method || 'GET';
  assert(['GET', 'POST', 'PATCH', 'DELETE'].includes(method), 405, 'Непозволен метод.');
  assert(typeof input.path === 'string' && /^[a-z_]+(?:\?[^#\r\n]*)?$/.test(input.path), 400, 'Невалиден път.');
  const url = new URL(input.path, 'https://database.invalid/');
  const table = url.pathname.slice(1);
  assert(TABLES.has(table), 403, 'Няма достъп до тази таблица.');
  const query = url.searchParams, select = query.get('select');
  assert(['select','order','limit','offset'].every(k => query.getAll(k).length <= 1), 400, 'Повтарящ се параметър.');
  assert(!select || /^[a-z_*,]+$/.test(select) || (table === 'work_card_materials' && select === 'category,item_type,quantity,unit,work_card_id,work_cards!inner(work_date)'), 400, 'Непозволен избор на полета.');
  assert([...query.keys()].every(k => /^[a-z_]+(?:\.[a-z_]+)?$/.test(k) && !['or', 'and', 'not', 'on_conflict'].includes(k)), 400, 'Непозволен филтър.');
  if (role === 'mechanic') {
    assert(method === 'GET' && ['nomenclatures', 'service_requests', 'work_cards'].includes(table), 403, 'Механикът няма право за тази операция.');
    if (table === 'service_requests') query.set('assigned_mechanics', 'cs.{' + JSON.stringify(mechanic) + '}');
    if (table === 'work_cards') query.set('mechanic', 'cs.{' + JSON.stringify(mechanic) + '}');
  } else {
    assert(['admin', 'manager', 'coordinator'].includes(role), 403, 'Непозволена роля.');
    if (method !== 'GET') {
      assert(['service_requests', 'request_log', 'work_card_log'].includes(table), 403, 'Използвай операцията за запис на карта.');
      if (role === 'coordinator') {
        assert((method === 'POST' && ['service_requests', 'request_log'].includes(table)) || (method === 'PATCH' && table === 'service_requests'), 403, 'Няма право за тази промяна или изтриване.');
        if (method === 'PATCH') assert(input.body && Object.keys(input.body).every(k => REQUEST_DETAIL_FIELDS.has(k)), 403, 'Координаторът може да редактира само данните и бележките на заявката.');
      }
      if (table.endsWith('_log')) assert(method === 'POST', 403, 'Историята не може да се променя.');
    }
  }
  let body = input.body;
  if (method === 'PATCH' || method === 'DELETE') assert(query.get('id')?.startsWith('eq.') && UUID.test(query.get('id').slice(3)), 400, 'Нужен е конкретен запис.');
  if (method === 'POST' || method === 'PATCH') {
    if (table === 'service_requests') {
      body = pickFields(body, REQUEST_FIELDS);
      if (body.photo_data != null) {
        assert(typeof body.photo_data === 'string' && (/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(body.photo_data) || /^https:\/\/[^\s"'<>]+$/.test(body.photo_data)), 400, 'Невалидна снимка.');
      }
      if (method === 'POST') {
        body.status = 'Нова'; body.created_by = principal.name;
        for (const key of ['assigned_mechanics', 'responsible_mechanic', 'scheduled_at', 'estimated_hours', 'assigned_at', 'started_at', 'completed_at', 'work_card_id']) delete body[key];
        assert(['client_name', 'vehicle', 'reg_number', 'description'].every(k => typeof body[k] === 'string' && body[k].trim()), 400, 'Липсват данни за заявката.');
      }
      if (method === 'PATCH') assert(!('work_card_id' in body) && !('completed_at' in body) && body.status !== 'Изпълнена', 400, 'Приключването изисква работна карта.');
    } else {
      body = pickFields(body, new Set([table === 'request_log' ? 'request_id' : 'work_card_id', 'action', 'performed_by', 'details']));
      body.performed_by = principal.name;
    }
  }
  return { table, method, body, path: table + (query.size ? '?' + query.toString() : '') };
}
