/* Text and attribute encoding; database IDs never become executable strings. */
(function (root) {
  const entities = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
  root.WC_SAFE = {
    text(value) { return String(value ?? '').replace(/[&<>"']/g, ch => entities[ch]); },
    id(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value)) ? String(value) : ''; },
    image(value) {
      value = String(value ?? '');
      return /^(?:data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+|https:\/\/[^\s"'<>]+)$/.test(value) ? value : '';
    },
    clearCredentials() {
      const keys = [];
      for (let i = 0; i < root.localStorage.length; i++) keys.push(root.localStorage.key(i));
      for (const key of keys) if (/^(?:msal\.|workcard_(?:token|auth|identity)$)/i.test(key)) root.localStorage.removeItem(key);
    },
    logout() {
      // Persist before clearing identity; device registration and each user's drafts remain.
      if (root.WC_DRAFTS && !(root.WC_DRAFTS.flush ? root.WC_DRAFTS.flush() : root.WC_DRAFTS.save())) {
        if (!root.confirm('Черновата не може да се запази. Да излезеш въпреки това?')) return;
      }
      root.sessionStorage.clear();
      root.WC_SAFE.clearCredentials();
      root.location.href = 'login.html';
    }
  };
})(globalThis);
