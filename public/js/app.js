/* app.js — главная страница «Мне скучно». */
(function () {
  'use strict';
  var h = UI.h, clear = UI.clear, cap = UI.cap;

  var $ = function (id) { return document.getElementById(id); };
  var SCALE = [
    { v: 1, face: '😖', label: 'Мимо' },
    { v: 2, face: '🙁', label: 'Не очень' },
    { v: 3, face: '😐', label: 'Нормально' },
    { v: 4, face: '🙂', label: 'Классно' },
    { v: 5, face: '🤩', label: 'Супер' }
  ];
  var SEGS = {
    company: { host: 'segCompany', opts: [['solo', 'Один'], ['friends', 'С друзьями'], ['any', 'Неважно']] },
    budget:  { host: 'segBudget',  opts: [['free', 'Бесплатно'], ['cheap', 'Недорого'], ['any', 'Неважно']] },
    energy:  { host: 'segEnergy',  opts: [['low', 'Спокойно'], ['high', 'Активно'], ['any', 'Неважно']] }
  };

  var prefs = loadPrefs();
  var busy = false;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Хранилище настроек ---------- */
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ничего */ } }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function loadPrefs() {
    try { return MK.normalizePrefs(JSON.parse(read('mk_prefs') || '{}')); } catch (e) { return MK.normalizePrefs({}); }
  }
  function savePrefs() { store('mk_prefs', JSON.stringify(prefs)); updateCount(); }

  /* ---------- Настройки подборки ---------- */
  function buildTune() {
    var chips = clear($('chips'));
    MK.CATEGORIES.forEach(function (c) {
      var input = h('input', { type: 'checkbox', value: c.id });
      input.checked = prefs.categories.indexOf(c.id) !== -1;
      input.addEventListener('change', function () {
        prefs.categories = MK.CATEGORIES.map(function (x) { return x.id; }).filter(function (id) {
          return id === c.id ? input.checked : prefs.categories.indexOf(id) !== -1;
        });
        savePrefs();
      });
      chips.appendChild(h('label', { class: 'chip' }, [input, h('span', { text: c.emoji + ' ' + c.name })]));
    });
    Object.keys(SEGS).forEach(function (key) {
      var host = clear($(SEGS[key].host));
      SEGS[key].opts.forEach(function (o) {
        var input = h('input', { type: 'radio', name: 'seg-' + key, value: o[0] });
        input.checked = prefs[key] === o[0];
        input.addEventListener('change', function () { if (input.checked) { prefs[key] = o[0]; savePrefs(); } });
        host.appendChild(h('label', { class: 'seg-opt' }, [input, h('span', { text: o[1] })]));
      });
    });
    updateCount();
  }
  function updateCount() {
    var n = (prefs.categories.length ? 1 : 0) + ['company', 'budget', 'energy'].filter(function (k) { return prefs[k] !== 'any'; }).length;
    $('tuneCount').textContent = n ? '· выбрано: ' + n : '';
  }

  /* ---------- Геолокация ---------- */
  function geoOn() { return read('mk_geo') === 'on'; }
  function setGeo(on) {
    store('mk_geo', on ? 'on' : 'off');
    $('geoToggle').checked = on;
  }
  function askGeo() {
    if (!navigator.geolocation) { setGeo(false); showError('Браузер не поддерживает геолокацию.'); return; }
    navigator.geolocation.getCurrentPosition(
      function () { setGeo(true); },
      function () { setGeo(false); showError('Доступ к геолокации не разрешён. Идеи будут без привязки к месту.'); },
      { timeout: 8000, maximumAge: 300000 }
    );
  }
  function getLocation() {
    if ($('demoGeo').checked) return MKApi.demoLocation().catch(function () { return null; });
    if (!geoOn() || !navigator.geolocation) return Promise.resolve(null);
    return new Promise(function (resolve) {
      navigator.geolocation.getCurrentPosition(
        function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
        function () { resolve(null); },
        { timeout: 5000, maximumAge: 300000 }
      );
    });
  }
  function initGeoUi() {
    $('geoToggle').checked = geoOn();
    $('demoGeo').checked = read('mk_demo_geo') === '1';
    $('geoToggle').addEventListener('change', function (e) { if (e.target.checked) askGeo(); else setGeo(false); });
    $('demoGeo').addEventListener('change', function (e) { store('mk_demo_geo', e.target.checked ? '1' : '0'); });
    var seen = read('mk_geo') !== null || read('mk_geo_later') === '1';
    $('geoBanner').hidden = seen || !navigator.geolocation;
    $('geoAllow').addEventListener('click', function () { $('geoBanner').hidden = true; askGeo(); });
    $('geoLater').addEventListener('click', function () { $('geoBanner').hidden = true; store('mk_geo_later', '1'); });
  }

  /* ---------- Ошибки ---------- */
  function showError(msg) { var e = $('errorBox'); e.textContent = msg; e.hidden = false; }
  function hideError() { $('errorBox').hidden = true; }

  /* ---------- Генерация ---------- */
  function setLoading(on) {
    var b = $('boredBtn');
    b.disabled = on;
    b.classList.toggle('loading', on);
    $('boredLabel').textContent = on ? 'Думаю…' : 'Мне скучно';
  }

  function generate() {
    if (busy) return;
    busy = true; setLoading(true); hideError();
    var now = new Date();
    var ctx = { hour: now.getHours(), weekday: now.getDay(), month: now.getMonth() };
    getLocation()
      .then(function (location) { return MKApi.generate({ prefs: prefs, ctx: ctx, location: location }); })
      .then(function (res) { renderResult(res, ctx); loadHistory(); })
      .catch(function (e) { showError(e.message || 'Не получилось придумать идею. Попробуй ещё раз.'); })
      .then(function () { busy = false; setLoading(false); });
  }

  function renderResult(res, ctx) {
    var cat = MK.CAT_BY_ID[res.category];
    document.body.classList.add('has-idea');
    document.body.style.setProperty('--tone', cat ? cat.tone : '#FFE066');
    $('boredBtn').classList.add('compact');
    $('lead').textContent = 'Сейчас ' + MK.TOD_NAMES[MK.timeOfDay(ctx.hour)] + ', ' + MK.WEEKDAYS[ctx.weekday] + '. Вот что мы придумали:';

    var msg = h('p', { class: 'rate-msg', 'aria-live': 'polite' });
    var buttons = SCALE.map(function (s) {
      var btn = h('button', { type: 'button', class: 'face', 'aria-label': s.v + ' из 5: ' + s.label, 'aria-pressed': 'false' }, [
        h('span', { class: 'face-emoji', 'aria-hidden': 'true', text: s.face }),
        h('span', { class: 'face-label', text: s.label })
      ]);
      btn.addEventListener('click', function () {
        buttons.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        btn.setAttribute('aria-pressed', 'true');
        msg.textContent = 'Сохраняем оценку…';
        MKApi.rate(res.id, s.v)
          .then(function () { msg.textContent = 'Спасибо! Оценка «' + s.v + ' из 5» записана — она поможет подбирать идеи точнее.'; loadHistory(); })
          .catch(function (e) { msg.textContent = 'Оценку не удалось сохранить: ' + e.message; btn.setAttribute('aria-pressed', 'false'); });
      });
      return btn;
    });

    var acceptBtn = h('button', { type: 'button', class: 'btn primary', text: 'Пойду!' });
    acceptBtn.addEventListener('click', function () {
      MKApi.accept(res.id).then(function () {
        acceptBtn.textContent = 'Отличный план! Хорошего занятия 🎉';
        acceptBtn.disabled = true; loadHistory();
      }).catch(function (e) { showError(e.message); });
    });
    var againBtn = h('button', { type: 'button', class: 'btn', text: 'Другую идею', onclick: generate });

    var title = h('h2', { class: 'idea-title', tabindex: '-1', text: cap(res.activity) });
    var card = h('article', { class: 'idea' }, [
      h('div', { class: 'idea-head' }, [
        h('div', { class: 'idea-emoji', 'aria-hidden': 'true', text: res.emoji }),
        h('div', null, [
          h('p', { class: 'idea-cat', text: res.categoryName }),
          title
        ])
      ]),
      h('p', { class: 'idea-text', text: res.text }),
      h('p', { class: 'idea-src', text: res.source === 'ai' ? 'Идею придумал ИИ' : 'Идея из встроенного набора' }),
      h('div', { class: 'rate' }, [
        h('p', { class: 'rate-q', text: 'Как тебе идея?' }),
        h('div', { class: 'scale', role: 'group', 'aria-label': 'Оценка идеи от 1 до 5' }, buttons),
        msg
      ]),
      h('div', { class: 'actions' }, [acceptBtn, againBtn]),
      res.offer ? buildOffer(res.offer) : null
    ]);
    clear($('resultHost')).appendChild(card);
    title.focus({ preventScroll: true });
    card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  }

  function buildOffer(o) {
    var why = o.reason === 'near' ? 'Ты сейчас совсем рядом — примерно в ' + o.distance + ' м.' : 'Ты часто бываешь неподалёку.';
    var copyBtn = h('button', { type: 'button', class: 'btn small', text: 'Скопировать' });
    var logged = false;
    copyBtn.addEventListener('click', function () {
      function done() {
        copyBtn.textContent = 'Скопировано ✓';
        if (!logged) { logged = true; MKApi.offerCopy(o.logId).catch(function () { /* не критично */ }); }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(o.code).then(done, function () { copyBtn.textContent = 'Выдели код и скопируй вручную'; });
      else copyBtn.textContent = 'Выдели код и скопируй вручную';
    });
    return h('aside', { class: 'coupon' }, [
      h('p', { class: 'coupon-title', text: 'Подарок от партнёра: ' + o.name }),
      h('p', { text: o.text }),
      h('p', { class: 'coupon-meta', text: why + (o.address ? ' Адрес: ' + o.address + '.' : '') }),
      h('div', { class: 'coupon-code' }, [h('code', { text: o.code }), copyBtn])
    ]);
  }

  /* ---------- История ---------- */
  function loadHistory() {
    MKApi.history().then(function (r) {
      var items = r.items || [];
      $('historyBox').hidden = !items.length;
      var ul = clear($('historyList'));
      items.forEach(function (it) {
        ul.appendChild(h('li', null, [
          h('span', { class: 'hi-emoji', 'aria-hidden': 'true', text: it.emoji }),
          h('span', { class: 'hi-main' }, [
            h('span', { class: 'hi-title', text: cap(it.activity) }),
            h('span', { class: 'hi-meta', text: UI.fmtDate(it.created_at) + (it.accepted ? ' · пошёл(ла)' : '') })
          ]),
          h('span', { class: 'hi-rate' + (it.rating ? '' : ' none'), text: it.rating ? it.rating + ' / 5' : 'без оценки' })
        ]));
      });
    }).catch(function () { /* история необязательна */ });
  }

  /* ---------- Запуск ---------- */
  function init() {
    buildTune();
    initGeoUi();
    $('boredBtn').addEventListener('click', generate);
    MKApi.init().then(function (st) {
      var note = st.mode === 'server'
        ? 'Идеи и оценки сохраняются в базе данных на сервере. ' + (st.ai ? 'Идеи придумывает ИИ.' : 'Ключ ИИ не подключён, поэтому идеи берутся из встроенного набора.')
        : 'Демо-режим без сервера: идеи берутся из встроенного набора, а оценки хранятся только в этом браузере.';
      $('modeNote').textContent = note;
      loadHistory();
    });
  }
  init();
})();
