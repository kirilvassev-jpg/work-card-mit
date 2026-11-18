/* ============================================================
   Общ календар — български, седмицата започва с ПОНЕДЕЛНИК
   Автоматично заменя всички <input type="date"> в страницата,
   включително полета, добавени по-късно (модали, филтри).
   Стойността остава във формат ГГГГ-ММ-ДД, както преди.
   ============================================================ */
(function () {
    var CSS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.css';
    var JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.js';

    var BG = {
        weekdays: {
            shorthand: ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
            longhand: ['Неделя', 'Понеделник', 'Вторник', 'Сряда', 'Четвъртък', 'Петък', 'Събота']
        },
        months: {
            shorthand: ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'],
            longhand: ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември']
        },
        firstDayOfWeek: 1,
        rangeSeparator: ' до ',
        weekAbbreviation: 'Седм.',
        time_24hr: true
    };

    var nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

    function enhance(input) {
        if (input.dataset.dpReady || !window.flatpickr) return;
        input.dataset.dpReady = '1';
        var syncing = false;

        var fp = window.flatpickr(input, {
            locale: BG,
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'd.m.Y',
            allowInput: false,
            disableMobile: true,          // винаги нашия календар, и на телефон
            minDate: input.getAttribute('min') || null,
            maxDate: input.getAttribute('max') || null,
            onChange: function () {
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        // Копира стила на оригиналното поле към видимото
        if (fp.altInput) {
            fp.altInput.className = input.className;
            fp.altInput.style.cssText = input.style.cssText;
            fp.altInput.placeholder = input.placeholder || 'дд.мм.гггг';
            if (input.id) fp.altInput.setAttribute('aria-label', input.id);
        }

        // Ако кодът смени стойността програмно (input.value = ...), календарът се обновява
        Object.defineProperty(input, 'value', {
            configurable: true,
            get: function () { return nativeValue.get.call(input); },
            set: function (v) {
                nativeValue.set.call(input, v);
                if (syncing) return;
                var cur = fp.selectedDates[0] ? fp.formatDate(fp.selectedDates[0], 'Y-m-d') : '';
                if ((v || '') === cur) return;          // записано от самия календар
                syncing = true;
                try { v ? fp.setDate(v, false) : fp.clear(false); } finally { syncing = false; }
            }
        });
    }

    function enhanceAll(root) {
        (root || document).querySelectorAll('input[type="date"]').forEach(enhance);
    }

    function start() {
        enhanceAll(document);
        new MutationObserver(function (muts) {
            muts.forEach(function (m) {
                m.addedNodes.forEach(function (n) {
                    if (n.nodeType !== 1) return;
                    if (n.matches && n.matches('input[type="date"]')) enhance(n);
                    else if (n.querySelectorAll) enhanceAll(n);
                });
            });
        }).observe(document.body, { childList: true, subtree: true });
    }

    var css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = CSS_URL;
    document.head.appendChild(css);

    var style = document.createElement('style');
    style.textContent =
        '.flatpickr-calendar{font-family:inherit;border-radius:12px;box-shadow:0 10px 30px rgba(13,31,82,.2)}' +
        '.flatpickr-day.selected,.flatpickr-day.selected:hover{background:#1a3a8f;border-color:#1a3a8f}' +
        '.flatpickr-day.today{border-color:#e41e2b}' +
        '.flatpickr-months .flatpickr-month,.flatpickr-current-month{color:#1a3a8f;font-weight:700}' +
        'span.flatpickr-weekday{color:#1a3a8f;font-weight:700}' +
        'input.flatpickr-input[readonly]{cursor:pointer;background-color:#f8fafc}';
    document.head.appendChild(style);

    var js = document.createElement('script');
    js.src = JS_URL;
    js.onload = function () {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    };
    document.head.appendChild(js);
})();
