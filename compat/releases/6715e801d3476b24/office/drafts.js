(function () {
  var timer, store, status, suspended = false, pendingPayload = null, legacyPending = null, cleared = false;
  var submissionId = crypto.randomUUID();
  function lockPending() { document.getElementById('workCardForm').inert = !!(pendingPayload || legacyPending); }
  function notice(text) { if (status) status.textContent = text; }
  function fields() {
    return Array.from(document.querySelectorAll('#workCardForm input, #workCardForm select, #workCardForm textarea')).filter(function (el) { return el.id || el.name || el.dataset.group; });
  }
  function fieldKey(el) { return el.id ? 'id:' + el.id : el.dataset.group ? 'qty:' + el.dataset.group + ':' + el.dataset.value : 'name:' + el.name + ':' + el.value; }
  function snapshot() {
    var values = {};
    fields().forEach(function (el) { values[fieldKey(el)] = /checkbox|radio/.test(el.type) ? el.checked : el.value; });
    return { values: values, mechanics: Array.from(document.querySelectorAll('#mechanicOptions .ms-option.selected')).map(function (el) { return el.dataset.value; }), hasMaterials: hasMaterials, step: currentStep, submissionId: submissionId, pendingPayload: pendingPayload, legacyPending: legacyPending,requestPlan:window.WC_REQUEST_PLAN?.snapshot() };
  }
  function save() {
    if (!store || suspended || cleared) return false;
    try { store.write(snapshot()); notice(pendingPayload || legacyPending ? 'Има подготвен запис. При повторен опит се изпращат същите данни.' : navigator.onLine ? 'Черновата е запазена на това устройство.' : 'Без интернет — черновата е запазена на това устройство.'); return true; }
    catch (err) { notice('Черновата НЕ е запазена — паметта е пълна или недостъпна.'); return false; }
  }
  function schedule(event) {
    if (!store || suspended || (event && event.target && event.target.id === 'clearDraftButton')) return;
    cleared = false; clearTimeout(timer); timer = setTimeout(save, 300);
  }
  function restore(data) {
    suspended = true;
    fields().forEach(function (el) {
      var value = data.values[fieldKey(el)]; if (value === undefined) return;
      if (/checkbox|radio/.test(el.type)) el.checked = value; else el.value = value;
    });
    document.querySelectorAll('#mechanicOptions .ms-option').forEach(function (el) {
      var selected = data.mechanics.includes(el.dataset.value); el.classList.toggle('selected', selected); el.querySelector('input').checked = selected;
    });
    updateMechanicUI(); onActivityChange();
    window.WC_REQUEST_PLAN?.restore(data.requestPlan);
    if (data.hasMaterials === true || data.hasMaterials === false) toggleMaterials(data.hasMaterials);
    document.querySelectorAll('.material-item').forEach(function (el) { var cb = el.querySelector('input[type="checkbox"]'); el.querySelector('.item-qty').style.display = cb.checked ? 'flex' : 'none'; });
    goStep(data.step || 1, true);
    submissionId = data.submissionId || crypto.randomUUID(); pendingPayload = data.pendingPayload || null; legacyPending = data.legacyPending || null;
    lockPending();
    suspended = false; notice('Възстановена чернова от ' + new Date(data.savedAt).toLocaleString('bg-BG') + '.');
  }
  window.WC_DRAFTS = {
    init: function () {
      var identity = sessionStorage.getItem('workcard_identity') || (window.WC_CONFIG?.legacyDrafts ? sessionStorage.getItem('workcard_user') : null);
      if (!identity) return;
      store = WC_DRAFT_STORE(localStorage, 'wc_draft:v1:' + (WC_CONFIG.storageScope || (WC_CONFIG.demo ? 'demo' : 'real')) + ':' + identity + ':' + (window._currentRequestId || 'new'));
      status = document.createElement('div'); status.setAttribute('role', 'status'); status.style.cssText = 'font-size:13px;padding:10px;color:#475569';
      document.getElementById('workCardForm').prepend(status);
      var data = store.read();
      if (data && data.values && Array.isArray(data.mechanics)) restore(data);
      else notice('Черновата се запазва автоматично на това устройство.');
      var discard = document.createElement('button'); discard.id = 'clearDraftButton'; discard.type = 'button'; discard.textContent = 'Изчисти черновата';
      discard.style.cssText = 'margin:0 10px 10px;padding:8px;border:1px solid #cbd5e1;border-radius:8px;background:white';
      discard.onclick = function () {
        if (legacyPending) { notice('Има започнат запис. Натисни „Запиши“, за да го довършиш, преди да започнеш друга карта.'); return; }
        if (confirm('Да изчистя попълнената карта и черновата?')) { window.WC_DRAFTS.clear(); location.reload(); }
      };
      status.insertAdjacentElement('afterend', discard);
      ['input','change','click'].forEach(function (name) { document.getElementById('workCardForm').addEventListener(name, schedule); });
      window.addEventListener('pagehide', save);
      window.addEventListener('offline', save);
    },
    save: save,
    flush: function () { return cleared || !store ? true : save(); },
    legacySubmission: function (card, materials) {
      if (!legacyPending) {
        var id = crypto.randomUUID(), performer = card.mechanic.join(', ');
        legacyPending = {card:Object.assign({},card,{id:id}),materials:materials.map(function(m){return Object.assign({},m,{id:crypto.randomUUID(),work_card_id:id});}),completedAt:new Date().toISOString(),
          cardLog:{id:crypto.randomUUID(),work_card_id:id,action:'created',performed_by:performer,details:'Нова работна карта'},
          requestLog:{id:crypto.randomUUID(),request_id:card.request_id,action:'completed',performed_by:performer,details:'Работна карта попълнена. ID: '+id}};
      }
      if (!save()) throw new Error('Записът не е изпратен: черновата не може да се запази на устройството.');
      lockPending();
      return legacyPending;
    },
    legacyPending: function () { return legacyPending; },
    submission: function (card, materials) {
      // An ambiguous network result must be retried with the SAME key AND payload.
      // Editing afterwards cannot silently turn that retry into a second card.
      if (pendingPayload && JSON.stringify({card:card,materials:materials}) !== JSON.stringify({card:pendingPayload.card,materials:pendingPayload.materials})) {
        throw new Error('Предишният опит още не е потвърден. Възстанови страницата и изпрати същата карта, за да проверим записа.');
      }
      if (!pendingPayload) pendingPayload = { action: 'submit_work_card', submissionId: submissionId, card: card, materials: materials };
      if (!save()) { pendingPayload = null; throw new Error('Записът не е изпратен: черновата не може да се запази на устройството.'); }
      lockPending();
      return pendingPayload;
    },
    reject: function () { pendingPayload = null; submissionId = crypto.randomUUID(); lockPending(); save(); },
    clear: function () {
      clearTimeout(timer); if (store) store.clear();
      cleared = true;
      pendingPayload = null; legacyPending = null; submissionId = crypto.randomUUID();
      lockPending();
      notice('Картата е записана. Няма неизпратена чернова.');
    }
  };
})();
