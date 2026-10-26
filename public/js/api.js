/*
 * api.js — единый клиентский слой.
 * Если рядом работает сервер (/api/health отвечает) — ходим на него.
 * Если нет (например, GitHub Pages) — включается демо-режим: всё хранится в localStorage,
 * идеи берутся из встроенного набора. Интерфейс при этом не меняется.
 */
(function () {
  'use strict';

  var mode = 'local';
  var aiEnabled = false;
  var adminToken = null;
  var LOCAL_ADMIN = { login: 'admin', password: 'mneskuchno' };

  /* ---------- Идентификатор клиента ---------- */
  function clientId() {
    var id = null;
    try { id = localStorage.getItem('mk_client'); } catch (e) { /* приватный режим */ }
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      var a = new Uint8Array(12);
      (self.crypto || window.crypto).getRandomValues(a);
      id = 'c' + Array.prototype.map.call(a, function (b) { return b.toString(36).padStart(2, '0'); }).join('');
      try { localStorage.setItem('mk_client', id); } catch (e) { /* ничего */ }
    }
    return id;
  }

  /* ---------- Запросы к серверу ---------- */
  function call(method, url, body, auth) {
    var headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && adminToken) headers.Authorization = 'Bearer ' + adminToken;
    return fetch(url, { method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined })
      .then(function (r) {
        var isJson = (r.headers.get('content-type') || '').indexOf('json') !== -1;
        return (isJson ? r.json() : r.text()).then(function (data) {
          if (!r.ok) { var err = new Error((data && data.error) || 'Ошибка ' + r.status); err.status = r.status; throw err; }
          return data;
        });
      });
  }

  function detect() {
    return fetch('api/health', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok || (r.headers.get('content-type') || '').indexOf('json') === -1) throw new Error('нет сервера');
        return r.json();
      })
      .then(function (j) { if (!j.ok) throw new Error('нет сервера'); mode = 'server'; aiEnabled = !!j.ai; })
      .catch(function () { mode = 'local'; aiEnabled = false; })
      .then(function () { return { mode: mode, ai: aiEnabled }; });
  }

  /* ---------- Локальная «база» (демо-режим) ---------- */
  function ldb() {
    var db = null;
    try { db = JSON.parse(localStorage.getItem('mk_local_db') || 'null'); } catch (e) { db = null; }
    if (!db || !db.requests) {
      db = { seq: 0, offerSeq: 0, requests: [], offers: [], pings: [],
        partners: MK.DEMO_PARTNERS.map(function (p, i) { return Object.assign({ id: i + 1, active: 1 }, p); }) };
      var demo = MK.generateDemoRows(300, Date.now());
      demo.forEach(function (r) { db.seq++; db.requests.push(Object.assign({ id: db.seq, demo: 1 }, r)); });
      lsave(db);
    }
    return db;
  }
  function lsave(db) { try { localStorage.setItem('mk_local_db', JSON.stringify(db)); } catch (e) { /* переполнено */ } }

  function lGenerate(p) {
    var db = ldb(), cid = clientId();
    var prefs = MK.normalizePrefs(p.prefs), ctx = MK.normalizeCtx(p.ctx);
    var nowIso = new Date().toISOString();
    var history = db.requests.filter(function (r) { return r.client_id === cid; }).slice(-8).reverse();

    var cand = null;
    var loc = p.location && isFinite(p.location.lat) && isFinite(p.location.lng)
      ? { lat: Math.round(p.location.lat * 1000) / 1000, lng: Math.round(p.location.lng * 1000) / 1000 } : null;
    if (loc) {
      var since = new Date(Date.now() - 30 * 86400000).toISOString();
      var mine = db.pings.filter(function (g) { return g.client_id === cid; });
      var recentPings = mine.filter(function (g) { return g.created_at >= since; });
      var last = mine[mine.length - 1];
      if (!last || Date.now() - Date.parse(last.created_at) > 10 * 60000) db.pings.push({ client_id: cid, lat: loc.lat, lng: loc.lng, created_at: nowIso });
      cand = MK.findOffer(db.partners, loc, recentPings);
      if (cand) {
        var dayAgo = new Date(Date.now() - 86400000).toISOString();
        var shown = db.offers.filter(function (o) { return o.client_id === cid && o.partner_id === cand.partner.id && o.created_at >= dayAgo; }).length;
        if (shown >= 3) cand = null;
      }
    }
    var out = MK.localSuggestion(prefs, ctx, history, { forceCategory: cand && Math.random() < 0.7 ? cand.partner.category : null });
    db.seq++;
    db.requests.push({
      id: db.seq, client_id: cid, created_at: nowIso, request_text: MK.describeRequest(prefs, ctx), response_text: out.text,
      category: out.category, activity: out.activity, emoji: out.emoji, source: 'local', rating: null, accepted: 0, prefs: prefs.categories, demo: 0
    });
    var offer = null;
    if (cand) {
      db.offerSeq++;
      db.offers.push({ id: db.offerSeq, client_id: cid, partner_id: cand.partner.id, partner_name: cand.partner.name, request_id: db.seq, reason: cand.reason, created_at: nowIso, copied: 0, demo: 0 });
      offer = { logId: db.offerSeq, name: cand.partner.name, address: cand.partner.address || '', code: cand.partner.promo_code, text: cand.partner.offer_text, distance: cand.dist, reason: cand.reason };
    }
    lsave(db);
    return { id: db.seq, category: out.category, categoryName: MK.CAT_BY_ID[out.category].name, activity: out.activity, emoji: out.emoji, text: out.text, source: 'local', offer: offer };
  }

  function lFind(db, id) { return db.requests.filter(function (r) { return r.id === id && r.client_id === clientId(); })[0]; }

  function lRows(db, includeDemo) {
    return db.requests.filter(function (r) { return includeDemo || !r.demo; });
  }

  function lFilter(rows, f) {
    f = f || {};
    return rows.filter(function (r) {
      if (f.category && r.category !== f.category) return false;
      if (f.source && r.source !== f.source) return false;
      if (f.rating === 'none') return !r.rating;
      if (f.rating && Number(f.rating) !== r.rating) return false;
      return true;
    });
  }

  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /* ---------- Публичный интерфейс ---------- */
  var api = {
    init: detect,
    get mode() { return mode; },
    get ai() { return aiEnabled; },
    clientId: clientId,
    localAdminHint: LOCAL_ADMIN,

    generate: function (p) {
      var payload = { clientId: clientId(), prefs: p.prefs, ctx: p.ctx, location: p.location || undefined };
      return mode === 'server' ? call('POST', 'api/generate', payload) : Promise.resolve().then(function () { return lGenerate(p); });
    },
    rate: function (id, rating) {
      if (mode === 'server') return call('POST', 'api/rate', { clientId: clientId(), id: id, rating: rating });
      var db = ldb(), r = lFind(db, id); if (!r) return Promise.reject(new Error('Запись не найдена'));
      r.rating = rating; lsave(db); return Promise.resolve({ ok: true });
    },
    accept: function (id) {
      if (mode === 'server') return call('POST', 'api/accept', { clientId: clientId(), id: id });
      var db = ldb(), r = lFind(db, id); if (r) { r.accepted = 1; lsave(db); } return Promise.resolve({ ok: true });
    },
    offerCopy: function (logId) {
      if (mode === 'server') return call('POST', 'api/offer/copy', { clientId: clientId(), logId: logId });
      var db = ldb(); db.offers.forEach(function (o) { if (o.id === logId) o.copied = 1; }); lsave(db); return Promise.resolve({ ok: true });
    },
    history: function () {
      if (mode === 'server') return call('GET', 'api/history?clientId=' + encodeURIComponent(clientId()));
      var db = ldb(), cid = clientId();
      var items = db.requests.filter(function (r) { return r.client_id === cid; }).slice(-10).reverse().map(function (r) {
        return { id: r.id, created_at: r.created_at, emoji: r.emoji, activity: r.activity, text: r.response_text, category: r.category, rating: r.rating, accepted: r.accepted };
      });
      return Promise.resolve({ items: items });
    },
    demoLocation: function () {
      if (mode === 'server') return call('GET', 'api/demo-location');
      var p = ldb().partners[0] || MK.DEMO_PARTNERS[0];
      return Promise.resolve({ lat: p.lat, lng: p.lng, name: p.name });
    },

    /* --- Режим разработчика --- */
    adminLogin: function (login, password) {
      if (mode === 'server') {
        return call('POST', 'api/admin/login', { login: login, password: password }).then(function (r) {
          adminToken = r.token; try { sessionStorage.setItem('mk_admin', adminToken); } catch (e) { /* ничего */ } return true;
        });
      }
      if (login === LOCAL_ADMIN.login && password === LOCAL_ADMIN.password) {
        adminToken = 'local'; try { sessionStorage.setItem('mk_admin', 'local'); } catch (e) { /* ничего */ }
        return Promise.resolve(true);
      }
      return Promise.reject(Object.assign(new Error('Неверный логин или пароль'), { status: 401 }));
    },
    adminRestore: function () {
      try { adminToken = sessionStorage.getItem('mk_admin'); } catch (e) { adminToken = null; }
      if (adminToken === 'local' && mode !== 'local') adminToken = null;
      return !!adminToken;
    },
    adminLogout: function () { adminToken = null; try { sessionStorage.removeItem('mk_admin'); } catch (e) { /* ничего */ } },

    adminStats: function (includeDemo) {
      if (mode === 'server') return call('GET', 'api/admin/stats' + (includeDemo ? '' : '?demo=0'), undefined, true);
      var db = ldb(), rows = lRows(db, includeDemo);
      var offers = db.offers.filter(function (o) { return includeDemo || !o.demo; });
      var s = MK.computeStats(rows.map(function (r) { return { client_id: r.client_id, category: r.category, activity: r.activity, source: r.source, rating: r.rating, accepted: r.accepted, created_at: r.created_at, prefs: r.prefs || [] }; }), offers);
      s.extra = { ai_enabled: false, model: null, ai_errors: 0, ai_latency: null,
        demo_rows: db.requests.filter(function (r) { return r.demo; }).length, real_rows: db.requests.filter(function (r) { return !r.demo; }).length };
      return Promise.resolve(s);
    },
    adminLog: function (f) {
      f = f || {};
      if (mode === 'server') {
        var q = [];
        ['category', 'source', 'rating'].forEach(function (k) { if (f[k]) q.push(k + '=' + encodeURIComponent(f[k])); });
        if (!f.includeDemo) q.push('demo=0');
        q.push('limit=' + (f.limit || 50)); q.push('offset=' + (f.offset || 0));
        return call('GET', 'api/admin/log?' + q.join('&'), undefined, true);
      }
      var rows = lFilter(lRows(ldb(), f.includeDemo), f).slice().reverse();
      var off = f.offset || 0, lim = f.limit || 50;
      return Promise.resolve({ total: rows.length, rows: rows.slice(off, off + lim) });
    },
    adminCsv: function (f) {
      f = f || {};
      if (mode === 'server') {
        var q = [];
        ['category', 'source', 'rating'].forEach(function (k) { if (f[k]) q.push(k + '=' + encodeURIComponent(f[k])); });
        if (!f.includeDemo) q.push('demo=0');
        return call('GET', 'api/admin/export.csv' + (q.length ? '?' + q.join('&') : ''), undefined, true);
      }
      var rows = lFilter(lRows(ldb(), f.includeDemo), f);
      var head = ['id', 'время', 'клиент', 'запрос', 'ответ', 'категория', 'занятие', 'источник', 'оценка', 'принято'];
      var lines = [head.map(csvCell).join(';')].concat(rows.map(function (r) {
        return [r.id, r.created_at, r.client_id, r.request_text, r.response_text, r.category, r.activity, r.source, r.rating, r.accepted].map(csvCell).join(';');
      }));
      return Promise.resolve('\ufeff' + lines.join('\r\n'));
    },
    adminSeed: function () {
      if (mode === 'server') return call('POST', 'api/admin/seed', {}, true);
      var db = ldb(); MK.generateDemoRows(300, Date.now()).forEach(function (r) { db.seq++; db.requests.push(Object.assign({ id: db.seq, demo: 1 }, r)); });
      lsave(db); return Promise.resolve({ ok: true });
    },
    adminClearDemo: function () {
      if (mode === 'server') return call('DELETE', 'api/admin/demo', undefined, true);
      var db = ldb(); db.requests = db.requests.filter(function (r) { return !r.demo; }); db.offers = db.offers.filter(function (o) { return !o.demo; });
      lsave(db); return Promise.resolve({ ok: true });
    },
    partners: function () {
      if (mode === 'server') return call('GET', 'api/admin/partners', undefined, true);
      var db = ldb();
      return Promise.resolve({ items: db.partners.map(function (p) {
        var of = db.offers.filter(function (o) { return o.partner_id === p.id; });
        return Object.assign({}, p, { offered: of.length, copied: of.filter(function (o) { return o.copied; }).length });
      }) });
    },
    addPartner: function (p) {
      if (mode === 'server') return call('POST', 'api/admin/partners', p, true);
      var db = ldb();
      var name = String(p.name || '').trim(), code = String(p.promo_code || '').trim();
      if (!name || !MK.CAT_BY_ID[p.category] || !isFinite(Number(p.lat)) || !isFinite(Number(p.lng))) return Promise.reject(new Error('Проверьте поля формы'));
      if (!/^[A-Za-z0-9_-]{3,30}$/.test(code)) return Promise.reject(new Error('Промокод: 3–30 символов, латиница, цифры, - и _'));
      db.partners.push({ id: Math.max.apply(null, db.partners.map(function (x) { return x.id; }).concat([0])) + 1, name: name, category: p.category, address: p.address || '',
        lat: Number(p.lat), lng: Number(p.lng), radius_m: Number(p.radius_m) || 300, promo_code: code, offer_text: p.offer_text || '', active: 1 });
      lsave(db); return api.partners();
    },
    togglePartner: function (id) {
      if (mode === 'server') return call('POST', 'api/admin/partners/' + id + '/toggle', {}, true);
      var db = ldb(); db.partners.forEach(function (p) { if (p.id === id) p.active = p.active ? 0 : 1; }); lsave(db); return api.partners();
    },
    deletePartner: function (id) {
      if (mode === 'server') return call('DELETE', 'api/admin/partners/' + id, undefined, true);
      var db = ldb(); db.partners = db.partners.filter(function (p) { return p.id !== id; }); lsave(db); return api.partners();
    }
  };

  window.MKApi = api;
})();
