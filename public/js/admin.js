/* admin.js — режим разработчика: вход и панель статистики. */
(function () {
  'use strict';
  var h = UI.h, clear = UI.clear, num = UI.num, cap = UI.cap;
  var root = document.getElementById('app');
  var PAGE = 25;

  var state = { includeDemo: true, filters: { category: '', source: '', rating: '' }, offset: 0, total: 0 };
  var els = {};

  /* ---------- Вход ---------- */
  function showLogin(message) {
    document.body.style.background = '';
    clear(root);
    var err = h('p', { class: 'form-error', role: 'alert', text: message || '' });
    var login = h('input', { id: 'lg', type: 'text', autocomplete: 'username', required: true, value: MKApi.mode === 'local' ? MKApi.localAdminHint.login : '' });
    var pass = h('input', { id: 'pw', type: 'password', autocomplete: 'current-password', required: true });
    var btn = h('button', { type: 'submit', class: 'btn primary', text: 'Войти' });
    var form = h('form', null, [
      h('div', { class: 'field' }, [h('label', { for: 'lg', text: 'Логин' }), login]),
      h('div', { class: 'field' }, [h('label', { for: 'pw', text: 'Пароль' }), pass]),
      err,
      h('div', { class: 'actions' }, [btn, h('a', { class: 'btn', href: './', text: 'На сайт' })])
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      btn.disabled = true; err.textContent = '';
      MKApi.adminLogin(login.value.trim(), pass.value)
        .then(loadDash)
        .catch(function (ex) { err.textContent = ex.message || 'Не удалось войти'; btn.disabled = false; pass.value = ''; pass.focus(); });
    });
    root.appendChild(h('div', { class: 'login-box' }, [
      h('h1', { text: 'Режим разработчика' }),
      h('p', { text: MKApi.mode === 'local'
        ? 'Демо-режим без сервера. Логин: admin, пароль: mneskuchno. Данные берутся из этого браузера.'
        : 'Статистика по ответам ИИ и предпочтениям пользователей. Нужна специальная учётная запись.' }),
      form
    ]));
    login.focus();
  }

  /* ---------- Каркас панели ---------- */
  function buildShell() {
    clear(root);
    els.verdict = h('div', { class: 'verdict none' });
    els.kpis = h('div', { class: 'kpis' });
    els.extra = h('p', { class: 'hint' });
    els.grid = h('div', { class: 'grid' });
    els.dataNote = h('span', { class: 'hint' });

    var demoCheck = h('input', { type: 'checkbox', id: 'incDemo' });
    demoCheck.checked = state.includeDemo;
    demoCheck.addEventListener('change', function () { state.includeDemo = demoCheck.checked; reload(); });

    var toolbar = h('div', { class: 'toolbar' }, [
      h('label', { class: 'check', for: 'incDemo' }, [demoCheck, 'Учитывать демо-данные']),
      h('button', { type: 'button', class: 'btn small', text: 'Обновить', onclick: reload }),
      h('button', { type: 'button', class: 'btn small', text: 'Добавить демо-данные', onclick: function () { run(MKApi.adminSeed()); } }),
      h('button', { type: 'button', class: 'btn small danger', text: 'Удалить демо-данные', onclick: function () {
        if (confirm('Удалить все демо-записи? Реальные запросы останутся.')) run(MKApi.adminClearDemo());
      } }),
      h('span', { class: 'spacer' }),
      els.dataNote
    ]);

    root.appendChild(h('div', { class: 'admin-head' }, [
      h('h1', { text: 'Режим разработчика' }),
      h('div', { class: 'links' }, [
        h('a', { class: 'btn small', href: './', text: 'На сайт' }),
        h('button', { type: 'button', class: 'btn small', text: 'Выйти', onclick: function () { MKApi.adminLogout(); showLogin(); } })
      ])
    ]));
    root.appendChild(toolbar);
    root.appendChild(els.verdict);
    root.appendChild(els.kpis);
    root.appendChild(els.extra);
    root.appendChild(els.grid);
  }

  function run(promise) {
    return promise.then(reload).catch(onError);
  }
  function onError(e) {
    if (e && e.status === 401) { MKApi.adminLogout(); showLogin('Сессия закончилась. Войдите снова.'); return; }
    alert(e && e.message ? e.message : 'Ошибка');
  }

  function loadDash() {
    buildShell();
    return reload();
  }

  function reload() {
    state.offset = 0;
    return Promise.all([MKApi.adminStats(state.includeDemo), MKApi.partners(), fetchLog(false)])
      .then(function (r) { render(r[0], r[1].items, r[2]); })
      .catch(onError);
  }

  /* ---------- Рендер ---------- */
  function bars(items, valueFn, labelFn, maxHint) {
    var max = maxHint || Math.max.apply(null, items.map(valueFn).concat([1]));
    return h('div', { class: 'bars' }, items.map(function (it) {
      var fill = h('div', { class: 'bar-fill' });
      fill.style.width = Math.max(0, Math.min(100, (valueFn(it) / max) * 100)) + '%';
      return h('div', { class: 'bar-row' }, [
        h('span', { class: 'name', text: labelFn(it) }),
        h('div', { class: 'bar-track' }, [fill]),
        h('span', { class: 'val', text: it._val })
      ]);
    }));
  }

  function panel(title, sub, body, wide) {
    return h('section', { class: 'panel' + (wide ? ' wide' : '') }, [h('h2', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null, body]);
  }
  function emptyNote() { return h('p', { class: 'empty', text: 'Пока нет данных.' }); }

  function render(s, partners, log) {
    var t = s.totals;
    // Вердикт
    els.verdict.className = 'verdict ' + s.verdict.level;
    clear(els.verdict);
    els.verdict.appendChild(h('strong', { text: 'Как справляется ИИ' }));
    els.verdict.appendChild(document.createTextNode(s.verdict.text));
    if (s.verdict.strong.length) els.verdict.appendChild(h('small', { text: 'Лучше всего получается: ' + s.verdict.strong.join(', ') + '.' }));
    if (s.verdict.weak.length) els.verdict.appendChild(h('small', { text: 'Слабые места (оценка ниже 3,3): ' + s.verdict.weak.join(', ') + '.' }));

    // KPI
    clear(els.kpis);
    [[num(t.requests, 0), 'запросов «Мне скучно»'], [num(t.users, 0), 'пользователей'], [num(t.avg, 2), 'средняя оценка из 5'],
      [num(t.positive) + '%', 'оценили на 4–5'], [num(t.negative) + '%', 'оценили на 1–2'], [num(t.rated_share) + '%', 'запросов получили оценку'],
      [num(t.accepted) + '%', 'нажали «Пойду!»']].forEach(function (k) {
      els.kpis.appendChild(h('div', { class: 'kpi' }, [h('div', { class: 'v', text: k[0] }), h('div', { class: 'l', text: k[1] })]));
    });
    var ex = s.extra || {};
    els.extra.textContent = (ex.ai_enabled ? 'ИИ подключён (модель ' + ex.model + '). ' : 'ИИ не подключён — работает запасной генератор. ') +
      (ex.ai_enabled ? 'Среднее время ответа: ' + (ex.ai_latency ? num(ex.ai_latency, 0) + ' мс' : '—') + '. Запросов, где ИИ не ответил: ' + num(ex.ai_errors, 0) + '. ' : '') +
      'Режим данных: ' + (MKApi.mode === 'server' ? 'сервер и база данных' : 'браузер (демо без сервера)') + '.';
    els.dataNote.textContent = 'Записей: ' + num(ex.real_rows, 0) + ' реальных, ' + num(ex.demo_rows, 0) + ' демо';

    clear(els.grid);

    // Предпочтения пользователей
    var fav = s.favourite.map(function (f) { f._val = num(f.share) + '%'; return f; });
    var favTop = s.favourite[0];
    els.grid.appendChild(panel('Предпочтения пользователей',
      favTop ? 'Доля пользователей, для которых категория любимая (по оценкам, принятым идеям и числу запросов). Чаще всего: ' + favTop.name.toLowerCase() + ' — ' + num(favTop.share) + '%.' : 'Доля пользователей по любимой категории.',
      fav.length ? bars(fav, function (f) { return f.share; }, function (f) { return f.emoji + ' ' + f.name; }, 100) : emptyNote()));

    // Что отметили в настройках
    var decl = s.declared.map(function (f) { f._val = num(f.share) + '%'; return f; });
    els.grid.appendChild(panel('Что пользователи отметили в настройках',
      'Доля пользователей, выбравших категорию (всего ' + num(s.declaredUsers, 0) + ' человек отметили интересы).',
      decl.length ? bars(decl, function (f) { return f.share; }, function (f) { return f.emoji + ' ' + f.name; }, 100) : emptyNote()));

    // Конкретные занятия
    var acts = s.topActivities.map(function (a) { a._val = num(a.share) + '%'; return a; });
    els.grid.appendChild(panel('Какие занятия предлагали чаще всего', 'Доля от всех запросов; в скобках — средняя оценка.',
      acts.length ? bars(acts, function (a) { return a.share; }, function (a) { return cap(a.activity) + (a.avg ? ' (' + num(a.avg, 1) + ')' : ''); }) : emptyNote()));

    // Распределение оценок
    var dist = [5, 4, 3, 2, 1].map(function (v) { return { v: v, n: s.distribution[v - 1], _val: num(s.distribution[v - 1], 0) }; });
    els.grid.appendChild(panel('Распределение оценок', 'Сколько раз ставили каждую оценку.',
      t.rated ? bars(dist, function (d) { return d.n; }, function (d) { return d.v + ' из 5'; }) : emptyNote()));

    // ИИ против запасного
    var srcRows = s.bySource.map(function (x) {
      return h('tr', null, [h('td', null, [h('span', { class: 'tag ' + x.source, text: x.name })]), h('td', { class: 'num', text: num(x.count, 0) }),
        h('td', { class: 'num', text: num(x.rated, 0) }), h('td', { class: 'num', text: num(x.avg, 2) }), h('td', { class: 'num', text: x.rated ? num(x.positive) + '%' : '—' })]);
    });
    els.grid.appendChild(panel('ИИ и запасной генератор', 'Сравнение качества: оценки пользователей по источнику идеи.',
      h('div', { class: 'table-wrap' }, [h('table', null, [
        h('thead', null, [h('tr', null, [h('th', { text: 'Источник' }), h('th', { class: 'num', text: 'Запросов' }), h('th', { class: 'num', text: 'Оценок' }), h('th', { class: 'num', text: 'Средняя' }), h('th', { class: 'num', text: '4–5' })])]),
        h('tbody', null, srcRows)])])));

    // Динамика
    var maxD = Math.max.apply(null, s.daily.map(function (d) { return d.count; }).concat([1]));
    var cols = s.daily.map(function (d) {
      var bar = h('div', { class: 'trend-bar', title: d.count + ' запросов, средняя оценка ' + num(d.avg, 2) });
      bar.style.height = Math.round((d.count / maxD) * 100) + '%';
      return h('div', { class: 'trend-col' }, [h('span', { class: 'n', text: d.count }), bar, h('span', { class: 'd', text: d.day.slice(8, 10) + '.' + d.day.slice(5, 7) })]);
    });
    els.grid.appendChild(panel('Запросы за 14 дней', 'Количество нажатий «Мне скучно» по дням.', h('div', { class: 'trend' }, cols)));

    // Категории
    var catRows = s.byCategory.map(function (c) {
      return h('tr', null, [h('td', { text: c.emoji + ' ' + c.name }), h('td', { class: 'num', text: num(c.count, 0) }), h('td', { class: 'num', text: num(c.share) + '%' }),
        h('td', { class: 'num', text: num(c.avg, 2) }), h('td', { class: 'num', text: c.rated ? num(c.positive) + '%' : '—' })]);
    });
    els.grid.appendChild(panel('Категории: что предлагали и как оценили', 'Если средняя оценка категории низкая, стоит поменять подсказки для ИИ в этой области.',
      catRows.length ? h('div', { class: 'table-wrap' }, [h('table', null, [
        h('thead', null, [h('tr', null, [h('th', { text: 'Категория' }), h('th', { class: 'num', text: 'Запросов' }), h('th', { class: 'num', text: 'Доля' }), h('th', { class: 'num', text: 'Средняя' }), h('th', { class: 'num', text: '4–5' })])]),
        h('tbody', null, catRows)])]) : emptyNote(), true));

    // Партнёры
    els.grid.appendChild(partnersPanel(s, partners));

    // Журнал
    els.grid.appendChild(logPanel(log));
  }

  /* ---------- Партнёры ---------- */
  function partnersPanel(s, partners) {
    var stat = {};
    (s.partners || []).forEach(function (p) { stat[p.id] = p; });
    var rows = partners.map(function (p) {
      var st = stat[p.id] || { offered: 0, copied: 0, conversion: 0 };
      return h('tr', null, [
        h('td', null, [h('strong', { text: p.name }), h('br'), h('span', { class: 'demo-mark', text: (MK.CAT_BY_ID[p.category] ? MK.CAT_BY_ID[p.category].name : p.category) + ' · радиус ' + p.radius_m + ' м' })]),
        h('td', null, [h('code', { text: p.promo_code })]),
        h('td', { class: 'num', text: num(st.offered, 0) }), h('td', { class: 'num', text: num(st.copied, 0) }), h('td', { class: 'num', text: num(st.conversion) + '%' }),
        h('td', null, [
          h('button', { type: 'button', class: 'btn small', text: p.active ? 'Выключить' : 'Включить', onclick: function () { run(MKApi.togglePartner(p.id)); } }), ' ',
          h('button', { type: 'button', class: 'btn small danger', text: 'Удалить', onclick: function () { if (confirm('Удалить партнёра «' + p.name + '»?')) run(MKApi.deletePartner(p.id)); } })
        ])
      ]);
    });

    var f = {};
    function field(key, label, attrs, full) {
      var input = h('input', Object.assign({ id: 'pf-' + key, required: true }, attrs || {}));
      f[key] = input;
      return h('div', { class: 'field' + (full ? ' full' : '') }, [h('label', { for: 'pf-' + key, text: label }), input]);
    }
    var sel = h('select', { id: 'pf-category' }, MK.CATEGORIES.map(function (c) { return h('option', { value: c.id, text: c.emoji + ' ' + c.name }); }));
    var formErr = h('p', { class: 'form-error', role: 'alert' });
    var form = h('form', { class: 'form-grid' }, [
      field('name', 'Название', { type: 'text', maxlength: '80', placeholder: 'Спортзал «Атлант»' }),
      h('div', { class: 'field' }, [h('label', { for: 'pf-category', text: 'Категория' }), sel]),
      field('address', 'Адрес', { type: 'text', required: false, maxlength: '120' }),
      field('lat', 'Широта', { type: 'number', step: 'any', placeholder: '53.3478' }),
      field('lng', 'Долгота', { type: 'number', step: 'any', placeholder: '83.7787' }),
      field('radius_m', 'Радиус, м', { type: 'number', min: '50', max: '5000', value: '300' }),
      field('promo_code', 'Промокод', { type: 'text', maxlength: '30', placeholder: 'mneskuchno' }),
      field('offer_text', 'Текст предложения', { type: 'text', maxlength: '200', placeholder: 'Скидка 50% на месячный абонемент' }, true),
      h('div', { class: 'full' }, [formErr, h('button', { type: 'submit', class: 'btn small primary', text: 'Добавить партнёра' })])
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); formErr.textContent = '';
      MKApi.addPartner({ name: f.name.value, category: sel.value, address: f.address.value, lat: f.lat.value, lng: f.lng.value,
        radius_m: Number(f.radius_m.value), promo_code: f.promo_code.value, offer_text: f.offer_text.value })
        .then(reload).catch(function (ex) { if (ex.status === 401) onError(ex); else formErr.textContent = ex.message; });
    });

    return panel('Партнёры и промокоды',
      'Предложение показывается, если пользователь сейчас в радиусе партнёра или за последние 30 дней как минимум в 2 разных дня бывал рядом. «Скопировано» — сколько раз взяли промокод.',
      h('div', null, [
        rows.length ? h('div', { class: 'table-wrap' }, [h('table', null, [
          h('thead', null, [h('tr', null, [h('th', { text: 'Партнёр' }), h('th', { text: 'Промокод' }), h('th', { class: 'num', text: 'Показов' }), h('th', { class: 'num', text: 'Скопировано' }), h('th', { class: 'num', text: 'Конверсия' }), h('th', { text: 'Действия' })])]),
          h('tbody', null, rows)])]) : emptyNote(),
        h('h3', { class: 'sub', text: 'Новый партнёр' }), form
      ]), true);
  }

  /* ---------- Журнал запросов ---------- */
  function fetchLog(append) {
    return MKApi.adminLog({ category: state.filters.category, source: state.filters.source, rating: state.filters.rating,
      includeDemo: state.includeDemo, limit: PAGE, offset: state.offset }).then(function (r) { state.total = r.total; return r; });
  }

  function logRow(r) {
    return h('tr', null, [
      h('td', { text: UI.fmtDate(r.created_at) }),
      h('td', { class: 'cell-text', text: r.request_text }),
      h('td', { class: 'cell-text' }, [h('strong', { text: r.emoji + ' ' + cap(r.activity) }), h('br'), r.response_text]),
      h('td', null, [h('span', { class: 'tag ' + r.source, text: r.source === 'ai' ? 'ИИ' : 'запасной' }),
        r.error ? h('div', { class: 'cell-err', text: 'ИИ не ответил: ' + r.error }) : null, r.demo ? h('div', { class: 'demo-mark', text: 'демо' }) : null]),
      h('td', { class: 'num rating-cell r' + (r.rating || 0), text: r.rating ? r.rating : '—' }),
      h('td', { class: 'num', text: r.accepted ? 'да' : '—' })
    ]);
  }

  function logPanel(first) {
    var tbody = h('tbody', null, first.rows.map(logRow));
    var more = h('button', { type: 'button', class: 'btn small', text: 'Показать ещё' });
    var count = h('span', { class: 'hint' });
    function refreshControls() {
      var shown = tbody.children.length;
      count.textContent = 'Показано ' + shown + ' из ' + state.total;
      more.hidden = shown >= state.total;
    }
    more.addEventListener('click', function () {
      state.offset = tbody.children.length;
      fetchLog(true).then(function (r) { r.rows.forEach(function (x) { tbody.appendChild(logRow(x)); }); refreshControls(); }).catch(onError);
    });

    function select(key, label, options) {
      var s = h('select', { id: 'lf-' + key }, options.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
      s.value = state.filters[key];
      s.addEventListener('change', function () {
        state.filters[key] = s.value;
        reload().then(function () { var e = document.getElementById('lf-' + key); if (e) e.focus(); });
      });
      return h('div', { class: 'field' }, [h('label', { for: 'lf-' + key, text: label }), s]);
    }
    var filters = h('div', { class: 'filters' }, [
      select('category', 'Категория', [['', 'Все']].concat(MK.CATEGORIES.map(function (c) { return [c.id, c.name]; }))),
      select('source', 'Источник', [['', 'Все'], ['ai', 'ИИ'], ['local', 'Запасной генератор']]),
      select('rating', 'Оценка', [['', 'Любая'], ['5', '5'], ['4', '4'], ['3', '3'], ['2', '2'], ['1', '1'], ['none', 'Без оценки']]),
      h('button', { type: 'button', class: 'btn small', text: 'Скачать CSV', onclick: function () {
        MKApi.adminCsv({ category: state.filters.category, source: state.filters.source, rating: state.filters.rating, includeDemo: state.includeDemo })
          .then(function (text) {
            var a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), download: 'mneskuchno-log.csv' });
            document.body.appendChild(a); a.click(); a.remove();
          }).catch(onError);
      } }),
      count
    ]);
    refreshControls();
    return panel('Журнал: запрос → ответ → оценка', 'Каждое нажатие кнопки записывается в базу вместе с оценкой пользователя.', h('div', null, [
      filters,
      first.rows.length ? h('div', { class: 'table-wrap' }, [h('table', null, [
        h('thead', null, [h('tr', null, [h('th', { text: 'Время' }), h('th', { text: 'Запрос' }), h('th', { text: 'Ответ' }), h('th', { text: 'Источник' }), h('th', { class: 'num', text: 'Оценка' }), h('th', { class: 'num', text: 'Пойду' })])]),
        tbody])]) : emptyNote(),
      more
    ]), true);
  }

  /* ---------- Старт ---------- */
  MKApi.init().then(function () {
    if (MKApi.adminRestore()) loadDash(); else showLogin();
  });
})();
