/* Small storage adapter, shared by the form and its regression tests. */
(function (root) {
  function createDraftStore(storage, key) {
    return {
      read: function () {
        try { var data = JSON.parse(storage.getItem(key)); return data && data.version === 1 ? data : null; }
        catch (err) { return null; }
      },
      write: function (value) {
        // Never report success when storage is blocked or full.
        storage.setItem(key, JSON.stringify(Object.assign({}, value, { version: 1, savedAt: new Date().toISOString() })));
      },
      clear: function () { storage.removeItem(key); }
    };
  }
  root.WC_DRAFT_STORE = createDraftStore;
})(globalThis);
