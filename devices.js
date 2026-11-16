async function loadDevices() {
  var rows = await WC_AUTH.call({ action: 'list_devices' });
  var list = document.getElementById('devices'); list.replaceChildren();
  rows.forEach(function (device) {
    var item = document.createElement('li');
    item.textContent = device.name + ' — ' + device.mechanic + ' — до ' + new Date(device.expires_at).toLocaleDateString('bg-BG') + (device.revoked_at ? ' — отписано' : ' ');
    if (!device.revoked_at) {
      var button = document.createElement('button'); button.textContent = 'Отпиши';
      button.onclick = async function () {
        if (!confirm('Да отпиша устройството „' + device.name + '“?')) return;
        try { await WC_AUTH.call({ action: 'revoke_device', id: device.id }); await loadDevices(); }
        catch (err) { document.getElementById('message').textContent = err.message; }
      }; item.appendChild(button);
    }
    list.appendChild(item);
  });
}
document.addEventListener('DOMContentLoaded', async function () {
  try {
    var user = await WC_AUTH.ready;
    if (!user || !['admin','manager'].includes(user.role)) { location.replace('login.html'); return; }
    var rows = await WC_AUTH.call({ path: 'nomenclatures?group_name=eq.mechanics&is_active=eq.true&order=sort_order', method: 'GET' });
    rows.forEach(function (m) { document.getElementById('mechanic').add(new Option(m.label, m.value)); });
    await loadDevices();
  } catch (err) { document.getElementById('message').textContent = err.message; }
});
document.getElementById('deviceForm').addEventListener('submit', async function (event) {
  event.preventDefault(); var button = event.target.querySelector('button'); button.disabled = true;
  try {
    var result = await WC_AUTH.call({ action: 'register_device', name: document.getElementById('deviceName').value, mechanic: document.getElementById('mechanic').value });
    document.getElementById('result').textContent = 'Копирай кода сега и го въведи при вход на таблета като механик. Кодът няма да се показва отново: ' + result.token;
    await loadDevices();
  } catch (err) { document.getElementById('message').textContent = err.message; }
  finally { button.disabled = false; }
});
