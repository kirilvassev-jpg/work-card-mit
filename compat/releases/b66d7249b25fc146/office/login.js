var selectedRole = null;
var msalInstance = null;
function showError(message) { var el = document.getElementById('errorMsg'); el.textContent = message; el.classList.add('show'); }
function destination(user) {
  ['wc_office_login_pending','wc_office_login_auto','wc_office_login_role'].forEach(function (key) { sessionStorage.removeItem(key); });
  location.href = ({ mechanic: 'tablet.html', coordinator: 'requests.html', manager: 'assign.html', admin: 'dashboard.html' })[user.role] || 'login.html';
}
async function selectRole(role) {
  if (role === 'mechanic' && WC_CONFIG.legacyMechanicLogin) { WC_AUTH.logout(); return; }
  selectedRole = role;
  document.querySelectorAll('.role-btn').forEach(function (el) { el.classList.toggle('selected', el.id === 'role-' + role); });
  document.getElementById('msalSection').classList.toggle('visible', role !== 'mechanic');
  document.getElementById('mechanicSection').classList.toggle('visible', role === 'mechanic');
  document.getElementById('errorMsg').classList.remove('show');
  if (role === 'mechanic') await loadMechanics();
}
async function initMsal() {
  if (msalInstance) return msalInstance;
  if (!window.msal) await new Promise(function (resolve, reject) {
    var script = document.createElement('script'); script.src = WC_AUTH.MSAL_SRC;
    script.onload = resolve; script.onerror = function () { reject(new Error('Microsoft входът не е достъпен. Провери интернет връзката.')); }; document.head.appendChild(script);
  });
  msalInstance = new msal.PublicClientApplication({
    auth: { clientId: WC_CONFIG.clientId, authority: 'https://login.microsoftonline.com/' + WC_CONFIG.tenantId, redirectUri: location.origin + location.pathname.replace(/\/[^\/]*$/, '/login.html') },
    cache: { cacheLocation: 'sessionStorage' }
  });
  if (msalInstance.initialize) await msalInstance.initialize();
  return msalInstance;
}
async function loginMSAL() {
  try {
    if (WC_CONFIG.demo) { destination(await WC_AUTH.demoLogin(selectedRole)); return; }
    document.getElementById('loading').classList.add('show');
    if (WC_CONFIG.legacyMechanicLogin) sessionStorage.setItem('wc_office_login_pending', '1');
    var app = await initMsal();
    await app.loginRedirect({ scopes: [WC_CONFIG.apiScope], prompt: 'select_account' });
  } catch (err) { showError(err.message); document.getElementById('loading').classList.remove('show'); }
}
async function loadMechanics() {
  var select = document.getElementById('mechanicSelect');
  select.replaceChildren();
  if (WC_CONFIG.demo) {
    var response = await fetch(WC_CONFIG.apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'demo_bootstrap' }) });
    var mechanics = await response.json();
    mechanics.forEach(function (m) { select.add(new Option(m.label, m.value)); });
    select.style.display = ''; document.getElementById('deviceCodeWrap').style.display = 'none';
  } else {
    select.style.display = 'none';
    document.getElementById('deviceCodeWrap').style.display = '';
    document.getElementById('deviceHint').textContent = WC_AUTH.deviceToken() ? 'Устройството е регистрирано. Натисни „Продължи“.' : 'Въведи кода, издаден от ръководителя в „Устройства“.';
  }
  document.getElementById('btnContinue').disabled = false;
}
async function loginMechanic() {
  var button = document.getElementById('btnContinue'); button.disabled = true;
  var previous = WC_AUTH.deviceToken();
  try {
    if (WC_CONFIG.demo) { destination(await WC_AUTH.demoLogin('mechanic', document.getElementById('mechanicSelect').value)); return; }
    var code = document.getElementById('deviceCode').value.trim();
    if (code && !/^[a-f0-9]{64}$/.test(code)) throw new Error('Кодът трябва да съдържа 64 знака.');
    if (code) localStorage.setItem(WC_AUTH.DEVICE_KEY, code);
    if (!WC_AUTH.deviceToken()) throw new Error('Нужен е код за регистрация.');
    sessionStorage.setItem('workcard_role', 'mechanic');
    var user = await WC_AUTH.validateSession();
    localStorage.setItem(WC_AUTH.DEVICE_NAME_KEY, user.deviceName || user.name);
    destination(user);
  } catch (err) {
    if (previous) localStorage.setItem(WC_AUTH.DEVICE_KEY, previous); else localStorage.removeItem(WC_AUTH.DEVICE_KEY);
    showError(err.message);
  } finally { button.disabled = false; }
}
document.addEventListener('DOMContentLoaded', async function () {
  var message = sessionStorage.getItem('workcard_login_msg');
  if (message) { showError(message); sessionStorage.removeItem('workcard_login_msg'); }
  var pendingRole = sessionStorage.getItem('wc_office_login_role');
  if (WC_CONFIG.legacyMechanicLogin && ['coordinator','manager','admin'].includes(pendingRole)) await selectRole(pendingRole);
  if (WC_CONFIG.demo) {
    document.querySelector('#msalSection button').textContent = 'Влез в демо профила';
    return;
  }
  try {
    // Do not trust a role saved in sessionStorage to establish a session.
    if (WC_CONFIG.legacyMechanicLogin || location.hash.includes('code=') || location.hash.includes('error=') || location.search.includes('code=')) {
      var app = await initMsal();
      var response = await app.handleRedirectPromise();
      if (response) {
        var access = response.accessToken || (await app.acquireTokenSilent({ scopes: [WC_CONFIG.apiScope], account: response.account })).accessToken;
        sessionStorage.setItem('workcard_token', access);
        sessionStorage.setItem('workcard_role', 'office');
        destination(await WC_AUTH.validateSession());
      } else if (WC_CONFIG.legacyMechanicLogin) {
        if (sessionStorage.getItem('wc_office_login_auto') === '1') {
          sessionStorage.removeItem('wc_office_login_auto');
          await loginMSAL();
        }
      }
    }
  } catch (err) { showError(err.message); }
});
