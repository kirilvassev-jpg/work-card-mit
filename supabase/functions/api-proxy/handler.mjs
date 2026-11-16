import { assert, HttpError, UUID, authorizePath, validateCard } from './policy.mjs';
const encoder = new TextEncoder();
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), x => x.toString(16).padStart(2, '0')).join('');
export function createHandler(config, deps = {}) {
  const fetcher = deps.fetch || fetch;
  let jwks = null, jwksAt = 0;
  const json = (value, status, cors) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  async function db(path, method = 'GET', body) {
    const response = await fetcher(config.supabaseUrl + '/rest/v1/' + path, {
      method, headers: { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (['22023', '23514', '22P02', '23502'].includes(err.code)) throw new HttpError(400, 'Невалидни данни.');
      if (['23505', 'P0001'].includes(err.code)) throw new HttpError(409, 'Записът вече съществува или заявката е променена. Обнови страницата.');
      if (err.code === '42501') throw new HttpError(403, 'Няма право за тази операция.');
      console.error('Database error', response.status, err.code);
      throw new HttpError(503, 'Базата не е достъпна или миграциите не са приложени.');
    }
    return response.status === 204 ? null : response.json();
  }
  async function verifyMicrosoft(token) {
    if (deps.verifyMicrosoft) return deps.verifyMicrosoft(token);
    try {
      const parts = token.split('.');
      assert(parts.length === 3, 401, 'Невалиден Microsoft токен.');
      const bytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      const decode = s => JSON.parse(new TextDecoder().decode(bytes(s)));
      const header = decode(parts[0]), claims = decode(parts[1]), now = Date.now() / 1000;
      assert(header.alg === 'RS256' && typeof header.kid === 'string', 401, 'Невалиден подпис.');
      assert(claims.iss === `https://login.microsoftonline.com/${config.tenantId}/v2.0` && claims.tid === config.tenantId && claims.aud === config.clientId, 401, 'Токенът е за друго приложение или организация.');
      assert(Number.isFinite(claims.exp) && claims.exp > now && (!claims.nbf || claims.nbf <= now + 30) && UUID.test(claims.oid || ''), 401, 'Изтекъл или невалиден токен.');
      assert(typeof claims.scp === 'string' && claims.scp.split(' ').includes('access_as_user'), 403, 'Липсва право access_as_user.');
      if (!jwks || Date.now() - jwksAt > 3600000 || !jwks.keys.some(k => k.kid === header.kid)) {
        const response = await fetcher(`https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`, { signal: AbortSignal.timeout(10000) });
        assert(response.ok, 503, 'Microsoft временно не е достъпен.');
        jwks = await response.json(); jwksAt = Date.now();
      }
      const jwk = jwks.keys.find(k => k.kid === header.kid && k.kty === 'RSA' && k.use === 'sig');
      assert(jwk, 401, 'Непознат подпис.');
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      assert(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(parts[2]), encoder.encode(parts[0] + '.' + parts[1])), 401, 'Невалиден подпис.');
      return claims;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(401, 'Невалиден Microsoft токен. Влез отново.');
    }
  }
  async function identity(req) {
    const deviceToken = req.headers.get('x-device-token');
    if (deviceToken) {
      assert(/^[a-f0-9]{64}$/.test(deviceToken), 401, 'Невалидна регистрация на устройство.');
      const rows = await db('registered_devices?token_hash=eq.' + await hash(deviceToken) + '&revoked_at=is.null&expires_at=gt.' + new Date().toISOString() + '&select=id,mechanic,name&limit=1');
      assert(rows?.length === 1, 401, 'Устройството е отписано или регистрацията е изтекла.');
      const active = await db('nomenclatures?group_name=eq.mechanics&is_active=eq.true&value=eq.' + encodeURIComponent(rows[0].mechanic) + '&select=value&limit=1');
      assert(active.length === 1, 403, 'Механикът не е активен.');
      return { role: 'mechanic', name: rows[0].mechanic, mechanic: rows[0].mechanic, id: rows[0].id, deviceName: rows[0].name };
    }
    const bearer = req.headers.get('authorization') || '';
    assert(bearer.startsWith('Bearer ') && bearer.length < 20000, 401, 'Нужен е вход.');
    const claims = await verifyMicrosoft(bearer.slice(7));
    const rows = await db(`user_roles?microsoft_oid=eq.${claims.oid}&tenant_id=eq.${claims.tid}&is_active=eq.true&select=role,email&limit=2`);
    assert(rows.length === 1 && ['admin', 'manager', 'coordinator'].includes(rows[0].role), 403, 'Няма активна роля за този Microsoft потребител.');
    return { role: rows[0].role, name: claims.name || rows[0].email || claims.oid, email: rows[0].email, id: claims.oid };
  }
  return async function handler(req) {
    const origin = req.headers.get('origin');
    const cors = { 'Access-Control-Allow-Origin': config.origins.includes(origin) ? origin : '', 'Access-Control-Allow-Headers': 'content-type, authorization, x-device-token', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
    try {
      assert(config.origins.includes(origin), 403, 'Непозволен адрес на приложението.');
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      assert(req.method === 'POST', 405, 'Непозволен метод.');
      assert(config.serviceKey && config.supabaseUrl && config.clientId && config.tenantId, 503, 'Липсва сървърна конфигурация.');
      assert(Number(req.headers.get('content-length') || 0) <= 6000000, 413, 'Твърде голяма заявка.');
      const raw = await req.text();
      assert(raw.length <= 6000000, 413, 'Твърде голяма заявка.');
      let input;
      try { input = JSON.parse(raw); } catch { throw new HttpError(400, 'Невалиден JSON.'); }
      assert(input && typeof input === 'object' && !Array.isArray(input), 400, 'Невалидна заявка.');
      if (input.action === 'health') {
        await db('nomenclatures?select=id&limit=0');
        return json({ ok: true }, 200, cors);
      }
      const user = await identity(req);
      if (input.action === 'session') return json(user, 200, cors);
      if (input.action === 'register_device') {
        assert(['admin', 'manager'].includes(user.role), 403, 'Нужен е ръководител.');
        assert(typeof input.name === 'string' && input.name.trim().length > 0 && input.name.length <= 100, 400, 'Въведи име на устройството.');
        const mechanics = await db('nomenclatures?group_name=eq.mechanics&is_active=eq.true&value=eq.' + encodeURIComponent(input.mechanic) + '&select=value&limit=1');
        assert(mechanics.length === 1, 400, 'Невалиден механик.');
        const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
        const rows = await db('registered_devices', 'POST', { name: input.name.trim(), mechanic: input.mechanic, token_hash: await hash(token), created_by: user.id, expires_at: new Date(Date.now() + 90 * 86400000).toISOString() });
        return json({ id: rows[0].id, token, mechanic: input.mechanic, expires_at: rows[0].expires_at }, 201, cors);
      }
      if (input.action === 'list_devices' || input.action === 'revoke_device') {
        assert(['admin', 'manager'].includes(user.role), 403, 'Нужен е ръководител.');
        if (input.action === 'list_devices') return json(await db('registered_devices?select=id,name,mechanic,created_at,expires_at,revoked_at&order=created_at.desc'), 200, cors);
        assert(UUID.test(input.id || ''), 400, 'Невалидно устройство.');
        await db('registered_devices?id=eq.' + input.id, 'PATCH', { revoked_at: new Date().toISOString() });
        return json({ ok: true }, 200, cors);
      }
      if (input.action === 'start_task') {
        assert(['mechanic', 'manager', 'admin'].includes(user.role), 403, 'Няма право за започване на задача.');
        assert(UUID.test(input.id || ''), 400, 'Невалидна задача.');
        const mechanic = user.mechanic || input.mechanic;
        assert(typeof mechanic === 'string' && mechanic.length > 0 && mechanic.length < 200, 400, 'Липсва механик.');
        return json(await db('rpc/start_work_task', 'POST', { p_request_id: input.id, p_mechanic: mechanic, p_actor: user.name }), 200, cors);
      }
      if (input.action === 'submit_work_card' || input.action === 'update_work_card') {
        assert(['mechanic', 'admin', 'manager'].includes(user.role), 403, 'Няма право за запис на карта.');
        const { card, materials } = validateCard(input.card, input.materials || []);
        assert(user.role !== 'mechanic' || (input.action === 'submit_work_card' && card.mechanic.includes(user.mechanic)), 403, 'Можеш да записваш само свои карти.');
        assert(user.role !== 'mechanic' || (!card.external_service && !card.external_service_note), 403, 'Външна услуга се отбелязва от ръководител.');
        const active = await db('nomenclatures?group_name=eq.mechanics&is_active=eq.true&select=value');
        assert(card.mechanic.every(m => active.some(a => a.value === m)), 400, 'Избран е неактивен механик.');
        if (input.action === 'update_work_card') {
          assert(UUID.test(input.id || ''), 400, 'Невалидна карта.');
          return json(await db('rpc/update_work_card', 'POST', { p_id: input.id, p_card: card, p_materials: materials, p_actor: user.name }), 200, cors);
        }
        assert(UUID.test(input.submissionId || ''), 400, 'Липсва идентификатор на записа.');
        return json(await db('rpc/submit_work_card', 'POST', { p_card: card, p_materials: materials, p_submission_id: input.submissionId, p_actor: user.name, p_actor_id: user.id, p_mechanic: user.mechanic || null }), 200, cors);
      }
      assert(!input.action, 400, 'Непозната операция.');
      if (input.path?.startsWith('work_cards?') && input.method === 'DELETE') {
        assert(['admin', 'manager'].includes(user.role), 403, 'Няма право за изтриване.');
        const id = new URLSearchParams(input.path.split('?')[1]).get('id');
        assert(id?.startsWith('eq.') && UUID.test(id.slice(3)), 400, 'Невалидна карта.');
        return json(await db('rpc/delete_work_card', 'POST', { p_id: id.slice(3), p_actor: user.name }), 200, cors);
      }
      const allowed = authorizePath(input, user);
      return json(await db(allowed.path, allowed.method, allowed.body), 200, cors);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error('API request failed', err?.name);
      return json({ error: err instanceof HttpError ? err.message : 'Временна сървърна грешка.' }, err instanceof HttpError ? err.status : 500, cors);
    }
  };
}
