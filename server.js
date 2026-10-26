'use strict';
/*
 * «Мне скучно» — сервер.
 * Без внешних зависимостей: только встроенные модули Node.js 22+ (http, sqlite, crypto, fetch).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MK = require('./public/js/core.js');
const dbm = require('./src/db.js');
const ai = require('./src/ai.js');

/* ---------- Мини-загрузчик .env ---------- */
function loadEnv(file) {
  try {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || process.env[m[1]] !== undefined) return;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* .env необязателен */ }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()'
};

function createApp(opts) {
  opts = opts || {};
  const publicDir = path.join(__dirname, 'public');
  const db = dbm.openDb(opts.dbFile || path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'mneskuchno.db'));
  dbm.seedPartners(db);
  if ((opts.autoSeed !== undefined ? opts.autoSeed : process.env.AUTO_SEED !== '0') && db.prepare('SELECT COUNT(*) AS n FROM requests').get().n === 0) {
    dbm.seedDemo(db, 400);
  }

  const adminLogin = opts.adminLogin || process.env.ADMIN_LOGIN || 'admin';
  let adminPassword = opts.adminPassword || process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    if (process.env.NODE_ENV === 'production') {
      adminPassword = crypto.randomBytes(9).toString('base64url');
      console.warn('[!] ADMIN_PASSWORD не задан. Временный пароль разработчика: ' + adminPassword);
    } else {
      adminPassword = 'mneskuchno';
      console.warn('[!] ADMIN_PASSWORD не задан. Для разработки используется пароль «mneskuchno».');
    }
  }
  const secret = opts.secret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

  /* ---------- Утилиты ---------- */
  const sha = function (s) { return crypto.createHash('sha256').update(String(s)).digest(); };
  const safeEqual = function (a, b) { return crypto.timingSafeEqual(sha(a), sha(b)); };

  function makeToken() {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 8 * 3600 * 1000, r: 'admin' })).toString('base64url');
    return payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  }
  function verifyToken(token) {
    if (!token) return false;
    const parts = String(token).split('.');
    if (parts.length !== 2) return false;
    const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest('base64url');
    if (!safeEqual(parts[1], expected)) return false;
    try { return JSON.parse(Buffer.from(parts[0], 'base64url').toString()).exp > Date.now(); } catch (e) { return false; }
  }
  function isAdmin(req) {
    const h = req.headers.authorization || '';
    return h.indexOf('Bearer ') === 0 && verifyToken(h.slice(7));
  }

  const hits = new Map();
  function limited(key, max, windowMs) {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter(function (t) { return now - t < windowMs; });
    if (arr.length >= max) { hits.set(key, arr); return true; }
    arr.push(now); hits.set(key, arr);
    return false;
  }
  const rateTimer = setInterval(function () {
    const now = Date.now();
    hits.forEach(function (arr, k) { if (!arr.length || now - arr[arr.length - 1] > 600000) hits.delete(k); });
  }, 60000);
  rateTimer.unref();

  function ipOf(req) {
    const xf = req.headers['x-forwarded-for'];
    return (xf ? String(xf).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
  }

  function send(res, code, body, headers) {
    const h = Object.assign({}, SECURITY_HEADERS, headers || {});
    res.writeHead(code, h);
    res.end(body);
  }
  function json(res, code, obj) {
    send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  }
  function readJson(req) {
    return new Promise(function (resolve, reject) {
      let size = 0; const chunks = [];
      req.on('data', function (c) {
        size += c.length;
        if (size > 20000) { reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', function () {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(Object.assign(new Error('Некорректный JSON'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }
  const bad = function (msg, status) { return Object.assign(new Error(msg), { status: status || 400 }); };

  function validClientId(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw bad('Некорректный clientId');
    return id;
  }
  function parseLocation(l) {
    if (!l || typeof l !== 'object') return null;
    const lat = Number(l.lat), lng = Number(l.lng);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    // округляем до ~100 м ради приватности
    return { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 };
  }

  /* ---------- Пользовательские маршруты ---------- */
  async function generate(req, res) {
    if (limited('gen:' + ipOf(req), 20, 60000)) throw bad('Слишком часто. Подожди минуту.', 429);
    const body = await readJson(req);
    const clientId = validClientId(body.clientId);
    const prefs = MK.normalizePrefs(body.prefs);
    const ctx = MK.normalizeCtx(body.ctx);
    const loc = parseLocation(body.location);
    const nowIso = new Date().toISOString();

    db.prepare(`INSERT INTO clients (id, prefs_json, created_at, last_seen) VALUES (?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET prefs_json = excluded.prefs_json, last_seen = excluded.last_seen`)
      .run(clientId, JSON.stringify(prefs), nowIso, nowIso);

    const history = db.prepare('SELECT category, activity, rating FROM requests WHERE client_id = ? ORDER BY id DESC LIMIT 8').all(clientId)
      .map(function (h) { return { category: h.category, activity: h.activity, rating: h.rating }; });

    // Партнёрские предложения по геопозиции
    let cand = null;
    if (loc) {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const pings = db.prepare('SELECT lat, lng, created_at FROM location_pings WHERE client_id = ? AND created_at >= ?').all(clientId, since);
      const last = db.prepare('SELECT created_at FROM location_pings WHERE client_id = ? ORDER BY id DESC LIMIT 1').get(clientId);
      if (!last || Date.now() - Date.parse(last.created_at) > 10 * 60000) {
        db.prepare('INSERT INTO location_pings (client_id, lat, lng, created_at) VALUES (?,?,?,?)').run(clientId, loc.lat, loc.lng, nowIso);
      }
      cand = MK.findOffer(db.prepare('SELECT * FROM partners WHERE active = 1').all(), loc, pings);
      if (cand) {
        const dayAgo = new Date(Date.now() - 86400000).toISOString();
        const shown = db.prepare('SELECT COUNT(*) AS n FROM offers_log WHERE client_id = ? AND partner_id = ? AND created_at >= ?').get(clientId, cand.partner.id, dayAgo).n;
        if (shown >= 3) cand = null;
      }
    }
    const forceCategory = cand && Math.random() < 0.7 ? cand.partner.category : null;

    // ИИ → при ошибке запасной генератор
    let out = null, source = 'local', prompt = null, model = null, latency = null, error = null;
    if (ai.isConfigured()) {
      try {
        const r = await ai.suggest(prefs, ctx, history, { forceCategory: forceCategory });
        out = r.result; source = 'ai'; prompt = r.prompt; model = r.model; latency = r.latency;
      } catch (e) { error = String(e.message || e).slice(0, 200); console.warn('[ai] ' + error); }
    }
    if (!out) out = MK.localSuggestion(prefs, ctx, history, { forceCategory: forceCategory });

    const info = db.prepare(`INSERT INTO requests
      (client_id, created_at, request_text, prompt, response_text, category, activity, emoji, source, model, latency_ms, error)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(clientId, nowIso, MK.describeRequest(prefs, ctx), prompt, out.text, out.category, out.activity, out.emoji, source, model, latency, error);
    const id = Number(info.lastInsertRowid);

    let offer = null;
    if (cand) {
      const oi = db.prepare('INSERT INTO offers_log (client_id, partner_id, request_id, reason, created_at) VALUES (?,?,?,?,?)')
        .run(clientId, cand.partner.id, id, cand.reason, nowIso);
      offer = {
        logId: Number(oi.lastInsertRowid), name: cand.partner.name, address: cand.partner.address || '',
        code: cand.partner.promo_code, text: cand.partner.offer_text, distance: cand.dist, reason: cand.reason
      };
    }
    json(res, 200, {
      id: id, category: out.category, categoryName: MK.CAT_BY_ID[out.category].name, activity: out.activity,
      emoji: out.emoji, text: out.text, source: source, offer: offer
    });
  }

  async function rate(req, res) {
    const b = await readJson(req);
    const clientId = validClientId(b.clientId);
    const rating = Number(b.rating), id = Number(b.id);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw bad('Оценка — число от 1 до 5');
    if (!Number.isInteger(id)) throw bad('Некорректный id');
    const r = db.prepare('UPDATE requests SET rating = ?, rated_at = ? WHERE id = ? AND client_id = ?').run(rating, new Date().toISOString(), id, clientId);
    if (!r.changes) throw bad('Запрос не найден', 404);
    json(res, 200, { ok: true });
  }

  async function accept(req, res) {
    const b = await readJson(req);
    const clientId = validClientId(b.clientId);
    const r = db.prepare('UPDATE requests SET accepted = 1 WHERE id = ? AND client_id = ?').run(Number(b.id), clientId);
    if (!r.changes) throw bad('Запрос не найден', 404);
    json(res, 200, { ok: true });
  }

  async function offerCopy(req, res) {
    const b = await readJson(req);
    const clientId = validClientId(b.clientId);
    db.prepare('UPDATE offers_log SET copied = 1 WHERE id = ? AND client_id = ?').run(Number(b.logId), clientId);
    json(res, 200, { ok: true });
  }

  function history(req, res, url) {
    const clientId = validClientId(url.searchParams.get('clientId'));
    const rows = db.prepare('SELECT id, created_at, emoji, activity, response_text AS text, category, rating, accepted FROM requests WHERE client_id = ? ORDER BY id DESC LIMIT 10').all(clientId);
    json(res, 200, { items: rows.map(function (r) { return Object.assign({}, r); }) });
  }

  /* ---------- Режим разработчика ---------- */
  async function adminLoginRoute(req, res) {
    if (limited('login:' + ipOf(req), 6, 300000)) throw bad('Слишком много попыток входа. Подождите 5 минут.', 429);
    const b = await readJson(req);
    const okLogin = safeEqual(b.login || '', adminLogin);
    const okPass = safeEqual(b.password || '', adminPassword);
    if (!(okLogin && okPass)) throw bad('Неверный логин или пароль', 401);
    json(res, 200, { token: makeToken() });
  }

  const demoFilter = function (url) { return url.searchParams.get('demo') === '0' ? ' WHERE r.demo = 0' : ''; };

  function adminStats(req, res, url) {
    const rows = db.prepare(`SELECT r.client_id, r.category, r.activity, r.source, r.rating, r.accepted, r.created_at, c.prefs_json
                             FROM requests r LEFT JOIN clients c ON c.id = r.client_id${demoFilter(url)} ORDER BY r.id`).all()
      .map(function (r) {
        let prefs = [];
        try { prefs = JSON.parse(r.prefs_json || '{}').categories || []; } catch (e) { prefs = []; }
        return { client_id: r.client_id, category: r.category, activity: r.activity, source: r.source, rating: r.rating, accepted: r.accepted, created_at: r.created_at, prefs: prefs };
      });
    const offers = db.prepare(`SELECT o.partner_id, p.name AS partner_name, o.copied, o.created_at FROM offers_log o JOIN partners p ON p.id = o.partner_id
                               ${url.searchParams.get('demo') === '0' ? 'WHERE o.demo = 0' : ''}`).all()
      .map(function (o) { return Object.assign({}, o); });
    const stats = MK.computeStats(rows, offers);
    const w = url.searchParams.get('demo') === '0' ? 'WHERE demo = 0' : '';
    const ex = db.prepare(`SELECT COUNT(CASE WHEN error IS NOT NULL THEN 1 END) AS ai_errors,
                                  ROUND(AVG(CASE WHEN source = 'ai' THEN latency_ms END)) AS ai_latency,
                                  COUNT(CASE WHEN demo = 1 THEN 1 END) AS demo_rows,
                                  COUNT(CASE WHEN demo = 0 THEN 1 END) AS real_rows FROM requests ${w}`).get();
    stats.extra = { ai_enabled: ai.isConfigured(), model: ai.isConfigured() ? ai.config().model : null,
      ai_errors: ex.ai_errors, ai_latency: ex.ai_latency, demo_rows: ex.demo_rows, real_rows: ex.real_rows };
    json(res, 200, stats);
  }

  function logQuery(url) {
    const where = [], args = [];
    const cat = url.searchParams.get('category'), src = url.searchParams.get('source'), rt = url.searchParams.get('rating');
    if (cat && MK.CAT_BY_ID[cat]) { where.push('category = ?'); args.push(cat); }
    if (src === 'ai' || src === 'local') { where.push('source = ?'); args.push(src); }
    if (rt === 'none') where.push('rating IS NULL');
    else if (rt && /^[1-5]$/.test(rt)) { where.push('rating = ?'); args.push(Number(rt)); }
    if (url.searchParams.get('demo') === '0') where.push('demo = 0');
    return { sql: where.length ? ' WHERE ' + where.join(' AND ') : '', args: args };
  }

  function adminLog(req, res, url) {
    const q = logQuery(url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const total = db.prepare('SELECT COUNT(*) AS n FROM requests' + q.sql).get(...q.args).n;
    const stmt = db.prepare('SELECT id, client_id, created_at, request_text, response_text, category, activity, emoji, source, model, latency_ms, error, rating, accepted, demo FROM requests' +
      q.sql + ' ORDER BY id DESC LIMIT ? OFFSET ?');
    const rows = stmt.all(...q.args, limit, offset).map(function (r) { return Object.assign({}, r); });
    json(res, 200, { total: total, rows: rows });
  }

  function csvCell(v) {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // защита от CSV-инъекций
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function adminCsv(req, res, url) {
    const q = logQuery(url);
    const stmt = db.prepare('SELECT id, created_at, client_id, request_text, response_text, category, activity, source, rating, accepted FROM requests' + q.sql + ' ORDER BY id');
    const rows = stmt.all(...q.args);
    const head = ['id', 'время', 'клиент', 'запрос', 'ответ', 'категория', 'занятие', 'источник', 'оценка', 'принято'];
    const lines = [head.map(csvCell).join(';')].concat(rows.map(function (r) {
      return [r.id, r.created_at, r.client_id, r.request_text, r.response_text, r.category, r.activity, r.source, r.rating, r.accepted].map(csvCell).join(';');
    }));
    send(res, 200, '\ufeff' + lines.join('\r\n'), {
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="mneskuchno-log.csv"', 'Cache-Control': 'no-store'
    });
  }

  function partnersList(res) {
    const rows = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM offers_log o WHERE o.partner_id = p.id) AS offered,
                             (SELECT COUNT(*) FROM offers_log o WHERE o.partner_id = p.id AND o.copied = 1) AS copied
                             FROM partners p ORDER BY p.id`).all().map(function (r) { return Object.assign({}, r); });
    json(res, 200, { items: rows });
  }

  async function partnerCreate(req, res) {
    const b = await readJson(req);
    const name = String(b.name || '').trim(), code = String(b.promo_code || '').trim(), text = String(b.offer_text || '').trim();
    const lat = Number(b.lat), lng = Number(b.lng), radius = Number(b.radius_m || 300);
    if (!name || name.length > 80) throw bad('Название: от 1 до 80 символов');
    if (!MK.CAT_BY_ID[b.category]) throw bad('Выберите категорию');
    if (!isFinite(lat) || Math.abs(lat) > 90 || !isFinite(lng) || Math.abs(lng) > 180) throw bad('Некорректные координаты');
    if (!Number.isInteger(radius) || radius < 50 || radius > 5000) throw bad('Радиус: от 50 до 5000 м');
    if (!/^[A-Za-z0-9_-]{3,30}$/.test(code)) throw bad('Промокод: 3–30 символов, латиница, цифры, - и _');
    if (!text || text.length > 200) throw bad('Текст предложения: от 1 до 200 символов');
    db.prepare('INSERT INTO partners (name, category, address, lat, lng, radius_m, promo_code, offer_text) VALUES (?,?,?,?,?,?,?,?)')
      .run(name, b.category, String(b.address || '').slice(0, 120), lat, lng, radius, code, text);
    partnersList(res);
  }

  /* ---------- Диспетчер ---------- */
  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname, m = req.method;

    if (p === '/api/health' && m === 'GET') return json(res, 200, { ok: true, mode: 'server', ai: ai.isConfigured() });
    if (p === '/api/generate' && m === 'POST') return generate(req, res);
    if (p === '/api/rate' && m === 'POST') return rate(req, res);
    if (p === '/api/accept' && m === 'POST') return accept(req, res);
    if (p === '/api/offer/copy' && m === 'POST') return offerCopy(req, res);
    if (p === '/api/history' && m === 'GET') return history(req, res, url);
    if (p === '/api/demo-location' && m === 'GET') {
      const d = db.prepare('SELECT lat, lng, name FROM partners WHERE active = 1 ORDER BY id LIMIT 1').get();
      return json(res, 200, d ? { lat: d.lat, lng: d.lng, name: d.name } : { lat: MK.DEMO_PARTNERS[0].lat, lng: MK.DEMO_PARTNERS[0].lng, name: MK.DEMO_PARTNERS[0].name });
    }
    if (p === '/api/admin/login' && m === 'POST') return adminLoginRoute(req, res);

    if (p.indexOf('/api/admin/') === 0) {
      if (!isAdmin(req)) throw bad('Нужен вход в режим разработчика', 401);
      if (p === '/api/admin/stats' && m === 'GET') return adminStats(req, res, url);
      if (p === '/api/admin/log' && m === 'GET') return adminLog(req, res, url);
      if (p === '/api/admin/export.csv' && m === 'GET') return adminCsv(req, res, url);
      if (p === '/api/admin/seed' && m === 'POST') { dbm.seedDemo(db, 400); return json(res, 200, { ok: true }); }
      if (p === '/api/admin/demo' && m === 'DELETE') { dbm.clearDemo(db); return json(res, 200, { ok: true }); }
      if (p === '/api/admin/partners' && m === 'GET') return partnersList(res);
      if (p === '/api/admin/partners' && m === 'POST') return partnerCreate(req, res);
      let mm = p.match(/^\/api\/admin\/partners\/(\d+)\/toggle$/);
      if (mm && m === 'POST') { db.prepare('UPDATE partners SET active = 1 - active WHERE id = ?').run(Number(mm[1])); return partnersList(res); }
      mm = p.match(/^\/api\/admin\/partners\/(\d+)$/);
      if (mm && m === 'DELETE') { db.prepare('DELETE FROM partners WHERE id = ?').run(Number(mm[1])); return partnersList(res); }
    }
    if (p.indexOf('/api/') === 0) throw bad('Не найдено', 404);

    if (m !== 'GET' && m !== 'HEAD') throw bad('Метод не поддерживается', 405);
    return serveStatic(p, res);
  }

  function serveStatic(p, res) {
    let rel = decodeURIComponent(p);
    if (rel === '/') rel = '/index.html';
    if (rel === '/admin') rel = '/admin.html';
    const file = path.normalize(path.join(publicDir, rel));
    if (file.indexOf(publicDir + path.sep) !== 0 || /(^|[\\/])\./.test(path.relative(publicDir, file))) throw bad('Не найдено', 404);
    fs.readFile(file, function (err, data) {
      if (err) return send(res, 404, 'Не найдено', { 'Content-Type': 'text/plain; charset=utf-8' });
      send(res, 200, data, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    });
  }

  const server = http.createServer(function (req, res) {
    route(req, res).catch(function (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      if (res.headersSent) return res.end();
      json(res, status, { error: status === 500 ? 'Внутренняя ошибка сервера' : e.message });
    });
  });

  return {
    server: server, db: db,
    close: function () { clearInterval(rateTimer); server.close(); try { db.close(); } catch (e) { /* уже закрыта */ } }
  };
}

if (require.main === module) {
  loadEnv(path.join(__dirname, '.env'));
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.server.listen(port, '0.0.0.0', function () {
    console.log('«Мне скучно» запущен: http://localhost:' + port);
    console.log('ИИ: ' + (ai.isConfigured() ? 'подключён (' + ai.config().model + ')' : 'ключ не задан — работает запасной генератор'));
  });
}

module.exports = { createApp: createApp };
