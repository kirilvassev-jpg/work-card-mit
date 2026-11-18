/*
 * auth.js – общ модул за достъп до api-proxy (Работни карти)
 *
 * Прикача пропуск към всяка заявка към api-proxy:
 *   • таблет (механици) – пропуск на регистрираното устройство (x-device-token)
 *   • офис (MSAL)       – Microsoft пропускът (token) и автоматично го подновява
 * Включва се във всяка страница ПРЕДИ останалите скриптове.
 */
(function () {
  var WC = window.WC_AUTH = {
    CLIENT_ID: '62029787-9853-404f-9a43-eff6e9762d13',
    TENANT_ID: '0b822811-c53c-4f5e-9444-350c2fb3f935',
    DEVICE_KEY: 'wc_device_token',
    DEVICE_NAME_KEY: 'wc_device_name',
    MSAL_SRC: 'https://alcdn.msauth.net/browser/2.38.0/js/msal-browser.min.js'
  };

  WC.isMechanic = function () { return sessionStorage.getItem('workcard_role') === 'mechanic'; };
  WC.deviceToken = function () { try { return localStorage.getItem(WC.DEVICE_KEY); } catch (e) { return null; } };
  WC.deviceName = function () { try { return localStorage.getItem(WC.DEVICE_NAME_KEY); } catch (e) { return null; } };
  WC.officeToken = function () { return sessionStorage.getItem('workcard_token'); };

  WC.goLogin = function (msg) {
    if (msg) sessionStorage.setItem('workcard_login_msg', msg);
    sessionStorage.removeItem('workcard_auth');
    if (!/login\.html$/.test(location.pathname)) location.href = 'login.html';
  };

  // ── Подновяване на Microsoft пропуска (без нов вход) ──
  var msalApp = null;
  function loadMsal() {
    if (window.msal) return Promise.resolve();
    return new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = WC.MSAL_SRC; s.onload = ok; s.onerror = fail;
      document.head.appendChild(s);
    });
  }
  WC.refreshOfficeToken = function () {
    return loadMsal().then(function () {
      if (!msalApp) {
        msalApp = new msal.PublicClientApplication({
          auth: {
            clientId: WC.CLIENT_ID,
            authority: 'https://login.microsoftonline.com/' + WC.TENANT_ID,
            redirectUri: location.origin + location.pathname.replace(/\/[^\/]*$/, '/login.html')
          },
          cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false }
        });
        return msalApp.initialize();
      }
    }).then(function () {
      var acc = msalApp.getAllAccounts()[0];
      if (!acc) throw new Error('no_account');
      return msalApp.acquireTokenSilent({ scopes: ['User.Read'], account: acc });
    }).then(function (r) {
      sessionStorage.setItem('workcard_token', r.accessToken);
      return r.accessToken;
    });
  };

  // ── Без пропуск няма достъп до страниците (освен login.html) ──
  var page = location.pathname.split('/').pop() || 'index.html';
  if (page !== 'login.html' && !WC.deviceToken() && !WC.officeToken()) {
    WC.goLogin('Нужен е вход с Microsoft или регистрирано устройство.');
    return;
  }

  // ── Прихващане на заявките към api-proxy ──
  var origFetch = window.fetch.bind(window);

  function withAuth(opts) {
    opts = Object.assign({}, opts || {});
    var headers = Object.assign({}, opts.headers || {});
    if (WC.isMechanic()) {
      var dt = WC.deviceToken();
      if (dt) headers['x-device-token'] = dt;
    } else {
      var ot = WC.officeToken();
      if (ot && typeof opts.body === 'string') {
        try {
          var b = JSON.parse(opts.body);
          if (b && typeof b === 'object' && !b.token) { b.token = ot; opts.body = JSON.stringify(b); }
        } catch (e) { /* не е JSON – оставяме както е */ }
      }
    }
    opts.headers = headers;
    return opts;
  }

  window.fetch = function (url, opts) {
    var u = typeof url === 'string' ? url : (url && url.url) || '';
    if (u.indexOf('/functions/v1/api-proxy') === -1) return origFetch(url, opts);

    return origFetch(url, withAuth(opts)).then(function (res) {
      if (res.status !== 401) return res;
      // Пропускът е невалиден
      if (WC.isMechanic()) {
        try { localStorage.removeItem(WC.DEVICE_KEY); } catch (e) {}
        WC.goLogin('Устройството не е регистрирано или регистрацията е изтекла.');
        return res;
      }
      if (!WC.officeToken()) return res;
      // Офис: опит за подновяване на Microsoft пропуска и повторение на заявката
      return WC.refreshOfficeToken().then(function (tok) {
        var o = Object.assign({}, opts || {});
        if (typeof o.body === 'string') {
          try { var b = JSON.parse(o.body); b.token = tok; o.body = JSON.stringify(b); } catch (e) {}
        }
        return origFetch(url, withAuth(o));
      }).catch(function () {
        WC.goLogin('Сесията е изтекла. Влезте отново.');
        return res;
      });
    });
  };
})();
