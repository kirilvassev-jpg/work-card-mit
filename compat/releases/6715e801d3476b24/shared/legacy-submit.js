/* Resume the original API workflow using preallocated UUID primary keys.
 * Persist all IDs BEFORE the first write. A lost response cannot create a second row.
 */
(function (root) {
  async function submit(apiUrl, pending, fetcher = root.fetch.bind(root)) {
    const call = async (path, method = 'GET', body) => {
      const response = await fetcher(apiUrl, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,method,body})});
      if (!response.ok) throw new Error('Записът не е завършен (' + response.status + '). Повтори „Запиши“, за да продължиш същата карта.');
      return response.status === 204 ? null : response.json();
    };
    async function ensure(table, row) {
      // Reading first also handles retries after a write succeeded but its response was lost.
      const existing = await call(table + '?id=eq.' + row.id);
      if (existing.length) { verify(existing[0], row); return; }
      try { await call(table, 'POST', row); }
      catch (error) {
        // A simultaneous retry can win the insert; only accept the exact same record.
        const found = await call(table + '?id=eq.' + row.id);
        if (!found.length) throw error;
        verify(found[0], row);
      }
    }
    function verify(actual, expected) {
      for (const key of Object.keys(expected)) {
        if (key.endsWith('_at')) continue; // PostgreSQL normalizes ISO timestamp spelling.
        const same = typeof expected[key] === 'number' ? Number(actual[key]) === expected[key] : JSON.stringify(actual[key] ?? null) === JSON.stringify(expected[key] ?? null);
        if (!same) throw new Error('Записът е променен. Не е създадена нова карта. Свържи се с ръководителя.');
      }
    }
    await ensure('work_cards', pending.card);
    for (const material of pending.materials) await ensure('work_card_materials', material);
    await ensure('work_card_log', pending.cardLog);
    if (pending.card.request_id) {
      const requests = await call('service_requests?id=eq.' + pending.card.request_id + '&select=id,work_card_id,status');
      if (requests.length !== 1 || (requests[0].work_card_id && requests[0].work_card_id !== pending.card.id)) throw new Error('Заявката е променена. Картата е запазена; свържи се с ръководителя.');
      await call('service_requests?id=eq.' + pending.card.request_id, 'PATCH', {status:'Изпълнена',work_card_id:pending.card.id,completed_at:pending.completedAt,updated_at:pending.completedAt});
      await ensure('request_log', pending.requestLog);
    }
    return pending.card.id;
  }
  root.WC_LEGACY_SUBMIT = {submit};
})(globalThis);
