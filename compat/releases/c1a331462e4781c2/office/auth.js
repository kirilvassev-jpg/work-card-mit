/* Shared authentication. Browser role flags are for navigation; the API enforces permissions. */
(function () {
  var config = window.WC_CONFIG;
  config.storageScope = config.demo ? 'demo' : config.apiUrl;
  var environment = JSON.stringify([config.storageScope, config.clientId, config.tenantId]);
  if (sessionStorage.getItem('workcard_environment') !== environment) {
    Object.keys(sessionStorage).filter(function (k) { return k.indexOf('workcard_') === 0; }).forEach(function (k) { sessionStorage.removeItem(k); });
    sessionStorage.setItem('workcard_environment', environment);
  }
  var WC = window.WC_AUTH = {
    CLIENT_ID: config.clientId, TENANT_ID: config.tenantId,
    DEVICE_KEY: config.demo ? 'wc_demo_device_token' : 'wc_device_token', DEVICE_NAME_KEY: config.demo ? 'wc_demo_device_name' : 'wc_device_name',
    MSAL_SRC: 'compat/releases/c1a331462e4781c2/vendor/msal-browser-2.38.0/msal-browser.min.js'
  };
  var rawFetch = window.fetch.bind(window), msalApp, refreshPromise;
  WC.escapeHTML = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]; });
  };
  WC.isMechanic = function () { return sessionStorage.getItem('workcard_role') === 'mechanic'; };
  WC.deviceToken = function () { try { return localStorage.getItem(WC.DEVICE_KEY); } catch (err) { return null; } };
  WC.deviceName = function () { try { return localStorage.getItem(WC.DEVICE_NAME_KEY); } catch (err) { return null; } };
  WC.officeToken = function () { return sessionStorage.getItem('workcard_token'); };
  WC.goLogin = function (message) {
    if (config.legacyMechanicLogin) sessionStorage.setItem('wc_office_login_pending', '1');
    if (message) sessionStorage.setItem('workcard_login_msg', message);
    sessionStorage.removeItem('workcard_auth');
    if (!/login\.html$/.test(location.pathname)) location.replace('login.html');
  };
  WC.logout = function () {
    // Preserve device registration and unsent drafts on this device.
    Object.keys(sessionStorage).filter(function (k) { return k.indexOf('workcard_') === 0; }).forEach(function (k) { sessionStorage.removeItem(k); });
    ['wc_office_login_pending','wc_office_login_auto','wc_office_login_role'].forEach(function (key) { sessionStorage.removeItem(key); });
    location.href = 'login.html';
  };
  WC.setSession = function (user) {
    sessionStorage.setItem('workcard_role', user.role);
    sessionStorage.setItem('workcard_db_role', user.role);
    sessionStorage.setItem('workcard_user', user.name);
    sessionStorage.setItem('workcard_identity', user.id);
    sessionStorage.setItem('workcard_email', user.email || '');
    sessionStorage.setItem('workcard_auth', 'true');
    WC.user = user;
    return user;
  };
  WC.refreshOfficeToken = function () {
    if (config.demo) return Promise.reject(new Error('Демо сесията е изтекла. Влез отново.'));
    if (refreshPromise) return refreshPromise;
    refreshPromise = Promise.resolve().then(function () {
      if (window.msal) return;
      return new Promise(function (ok, fail) {
        var script = document.createElement('script'); script.src = WC.MSAL_SRC;
        script.onload = ok; script.onerror = fail; document.head.appendChild(script);
      });
    }).then(async function () {
      if (!msalApp) {
        msalApp = new msal.PublicClientApplication({
        auth: { clientId: config.clientId, authority: 'https://login.microsoftonline.com/' + config.tenantId, redirectUri: location.origin + location.pathname.replace(/\/[^\/]*$/, '/login.html') },
        cache: { cacheLocation: 'sessionStorage' }
        });
        if (msalApp.initialize) await msalApp.initialize();
      }
      var account = msalApp.getAllAccounts()[0];
      if (!account) throw new Error('Нужен е нов вход.');
      return msalApp.acquireTokenSilent({ scopes: [config.apiScope], account: account });
    }).then(function (response) {
      sessionStorage.setItem('workcard_token', response.accessToken);
      return response.accessToken;
    }).finally(function () { refreshPromise = null; });
    return refreshPromise;
  };
  function optionsWithAuth(options) {
    var opts = Object.assign({}, options), headers = new Headers(opts.headers || {});
    var device = WC.deviceToken(), token = WC.officeToken();
    if (WC.isMechanic() && device) headers.set('x-device-token', device);
    else if (token) headers.set('Authorization', 'Bearer ' + token);
    opts.headers = headers;
    return opts;
  }
  WC.request = async function (input, options) {
    var opts = Object.assign({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(30000) }, options || {});
    var response = await rawFetch(config.apiUrl, optionsWithAuth(opts));
    if (response.status === 401 && !WC.isMechanic() && WC.officeToken() && !config.demo) {
      try { await WC.refreshOfficeToken(); response = await rawFetch(config.apiUrl, optionsWithAuth(opts)); }
      catch (err) { WC.goLogin('Сесията е изтекла. Влез отново.'); throw err; }
    }
    if (response.status === 401 && !/login\.html$/.test(location.pathname)) WC.goLogin('Нужен е нов вход или регистрация на устройството.');
    return response;
  };
  WC.call = async function (input) {
    var response = await WC.request(input);
    var data = await response.json();
    if (!response.ok) { var error = new Error(data.error || 'Грешка при връзка със сървъра.'); error.status = response.status; throw error; }
    return data;
  };
  WC.validateSession = async function () { return WC.setSession(await WC.call({ action: 'session' })); };
  WC.demoLogin = async function (role, mechanic) {
    if (!config.demo) throw new Error('Демо входът е изключен.');
    var response = await rawFetch(config.apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'demo_login', role: role, mechanic: mechanic }) });
    var data = await response.json();
    if (!response.ok) throw new Error(data.error);
    sessionStorage.setItem('workcard_token', data.token);
    return WC.setSession(data.user);
  };
  var page = location.pathname.split('/').pop() || 'index.html';
  WC.ready = page === 'login.html' ? Promise.resolve() : WC.validateSession().catch(function (err) {
    // Offline access restores a draft only; no server permissions are granted.
    if (!navigator.onLine && page === 'index.html' && sessionStorage.getItem('workcard_identity') && sessionStorage.getItem('workcard_auth') === 'true') {
      return { id: sessionStorage.getItem('workcard_identity'), name: sessionStorage.getItem('workcard_user'), role: sessionStorage.getItem('workcard_role'), offline: true };
    }
    WC.goLogin(err.message); return null;
  });
  window.fetch = async function (url, opts) {
    var u = typeof url === 'string' ? url : url.url;
    if (u !== config.apiUrl) return rawFetch(url, opts);
    if (page !== 'login.html') {
      var user = await WC.ready;
      if (!user) return new Response(JSON.stringify({ error: 'Нужен е вход.' }), { status: 401 });
    }
    return WC.request(JSON.parse(opts.body));
  };
  document.addEventListener('DOMContentLoaded', function () {
    if (config.demo) {
      var banner = document.createElement('div');
      banner.textContent = 'ДЕМО — само примерни данни. Промените се нулират при рестарт на сървъра.';
      banner.style.cssText = 'background:#fff3cd;color:#674900;padding:10px;text-align:center;font:14px sans-serif;position:relative;z-index:1000';
      document.body.prepend(banner);
    }
    WC.ready.then(function (user) {
      if (user && config.deviceRegistration !== false && ['admin','manager'].includes(user.role)) {
        var nav = document.querySelector('#bottomNav');
        if (nav && !nav.querySelector('[href="devices.html"]')) {
          var link = document.createElement('a'); link.href = 'devices.html'; link.textContent = 'Устройства'; nav.appendChild(link);
        }
      }
    });
  });
})();
