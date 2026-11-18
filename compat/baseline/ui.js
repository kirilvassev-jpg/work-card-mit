/* ============================================================
   Ар Си Техник — общи помощни функции за интерфейса
   UI.icon('wrench')      → SVG иконка (низ HTML)
   UI.toast('Текст', 'success' | 'error' | 'info')
   Елементи с data-icon="име" получават иконката автоматично.
   ============================================================ */
(function () {
    var P = {
        wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
        clip: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
        users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
        user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
        cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
        chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
        list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
        check: '<path d="M5 12l5 5L20 7"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        alert: '<path d="M12 3l10 18H2zM12 10v5M12 18h.01"/>',
        bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
        back: '<path d="M15 5l-7 7 7 7"/>',
        next: '<path d="M9 5l7 7-7 7"/>',
        out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
        flame: '<path d="M12 3s5 4.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 1.5-4S9 12 11 12c0-3 1-6 1-9z"/>',
        bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
        filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
        box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
        note: '<path d="M4 4h16v12H8l-4 4z"/>',
        drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
        thermo: '<path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z"/>',
        bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
        link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
        cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
        truck: '<path d="M1 6h13v10H1zM14 10h4l3 3v3h-7"/><circle cx="5.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>',
        play: '<path d="M7 4l13 8-13 8z"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        sound: '<path d="M11 5L6 9H3v6h3l5 4zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
        dot: '<circle cx="12" cy="12" r="4" fill="currentColor"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
        edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
        trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
        file: '<path d="M14 3H6v18h12V7zM14 3v4h4"/>',
        photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 16l-5-5-8 8"/>'
    };

    function icon(name, cls) {
        return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[name] || P.dot) + '</svg>';
    }

    var toastEl = null, toastTimer = null;
    function toast(msg, type) {
        type = type || 'info';
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.className = 'ui-toast';
            toastEl.setAttribute('role', 'status');
            document.body.appendChild(toastEl);
        }
        var ic = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'bell';
        toastEl.className = 'ui-toast ' + type;
        toastEl.innerHTML = icon(ic) + '<span></span>';
        toastEl.querySelector('span').textContent = msg;
        void toastEl.offsetWidth;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, type === 'error' ? 9000 : 6000);
    }

    function hydrate(root) {
        (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
            if (el.dataset.iconDone) return;
            el.dataset.iconDone = '1';
            el.innerHTML = icon(el.dataset.icon, el.dataset.iconClass || '');
        });
    }

    window.UI = { icon: icon, toast: toast, hydrate: hydrate };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { hydrate(); });
    else hydrate();
})();
