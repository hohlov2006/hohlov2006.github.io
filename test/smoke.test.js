'use strict';
// Сквозной тест: запускает сервер на свободном порту с базой в памяти и проходит основной сценарий.
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server.js');
const MK = require('../public/js/core.js');

let app, base;
test.before(async function () {
  delete process.env.AI_API_KEY; // проверяем запасной генератор
  app = createApp({ dbFile: ':memory:', adminLogin: 'dev', adminPassword: 'secret-pass', secret: 'test-secret', autoSeed: false });
  await new Promise(function (r) { app.server.listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + app.server.address().port;
});
test.after(function () { app.close(); });

async function post(path, body, token) {
  const r = await fetch(base + path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
async function get(path, token) {
  const r = await fetch(base + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  const type = r.headers.get('content-type') || '';
  return { status: r.status, body: type.includes('json') ? await r.json() : await r.text(), type: type };
}

test('health и статика', async function () {
  const h = await get('/api/health');
  assert.strictEqual(h.body.ok, true);
  assert.strictEqual(h.body.ai, false);
  assert.strictEqual((await get('/../server.js')).status, 404);
  assert.strictEqual((await get('/js/core.js')).status, 200);
});

test('генерация → оценка → «пойду» → история', async function () {
  const clientId = 'testclient-0001';
  const g = await post('/api/generate', { clientId: clientId, prefs: { categories: ['sport', 'walk'], company: 'friends', budget: 'free', energy: 'high' }, ctx: { hour: 18, weekday: 6, month: 9 } });
  assert.strictEqual(g.status, 200);
  assert.ok(g.body.text.length > 10);
  assert.strictEqual(g.body.source, 'local');
  assert.ok(MK.CAT_BY_ID[g.body.category]);

  assert.strictEqual((await post('/api/rate', { clientId: clientId, id: g.body.id, rating: 5 })).status, 200);
  assert.strictEqual((await post('/api/rate', { clientId: clientId, id: g.body.id, rating: 9 })).status, 400);
  assert.strictEqual((await post('/api/rate', { clientId: 'someone-else-1', id: g.body.id, rating: 1 })).status, 404, 'чужую запись оценить нельзя');
  assert.strictEqual((await post('/api/accept', { clientId: clientId, id: g.body.id })).status, 200);

  const hist = await get('/api/history?clientId=' + clientId);
  assert.strictEqual(hist.body.items[0].rating, 5);
  assert.strictEqual(hist.body.items[0].accepted, 1);
});

test('валидация входных данных', async function () {
  assert.strictEqual((await post('/api/generate', { clientId: '<script>' })).status, 400);
  assert.strictEqual((await post('/api/generate', { clientId: 'testclient-0002', prefs: { categories: ['hack'], company: 'x' } })).status, 200, 'мусор в prefs игнорируется');
});

test('геолокация: рядом со спортзалом приходит промокод', async function () {
  const clientId = 'testclient-geo-1';
  const near = await post('/api/generate', { clientId: clientId, prefs: {}, location: { lat: 53.3478, lng: 83.7787 } });
  assert.ok(near.body.offer, 'ожидали предложение партнёра');
  assert.strictEqual(near.body.offer.code, 'mneskuchno');
  const far = await post('/api/generate', { clientId: 'testclient-geo-2', prefs: {}, location: { lat: 59.9343, lng: 30.3351 } });
  assert.strictEqual(far.body.offer, null);
  assert.strictEqual((await post('/api/offer/copy', { clientId: clientId, logId: near.body.offer.logId })).status, 200);
});

test('режим разработчика: защита и статистика', async function () {
  assert.strictEqual((await get('/api/admin/stats')).status, 401);
  assert.strictEqual((await post('/api/admin/login', { login: 'dev', password: 'wrong' })).status, 401);
  const login = await post('/api/admin/login', { login: 'dev', password: 'secret-pass' });
  assert.strictEqual(login.status, 200);
  const token = login.body.token;

  assert.strictEqual((await get('/api/admin/stats', token + 'x')).status, 401, 'подделанный токен не проходит');

  assert.strictEqual((await post('/api/admin/seed', {}, token)).status, 200);
  const st = await get('/api/admin/stats', token);
  assert.strictEqual(st.status, 200);
  assert.ok(st.body.totals.requests >= 400);
  assert.ok(st.body.favourite.length > 0);
  assert.ok(st.body.partners.length > 0);
  const onlyReal = await get('/api/admin/stats?demo=0', token);
  assert.ok(onlyReal.body.totals.requests < st.body.totals.requests);

  const log = await get('/api/admin/log?limit=5&source=local', token);
  assert.strictEqual(log.body.rows.length, 5);
  const csv = await get('/api/admin/export.csv', token);
  assert.ok(csv.type.includes('text/csv'));
  assert.ok(csv.body.split('\n').length > 100);

  assert.strictEqual((await post('/api/admin/partners', { name: 'Тест', category: 'food', lat: 1, lng: 1, radius_m: 100, promo_code: 'a', offer_text: 'x' }, token)).status, 400);
  const pr = await post('/api/admin/partners', { name: 'Тест', category: 'food', lat: 1, lng: 1, radius_m: 100, promo_code: 'TEST-1', offer_text: 'Скидка' }, token);
  assert.strictEqual(pr.status, 200);

  const del = await fetch(base + '/api/admin/demo', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
  assert.strictEqual(del.status, 200);
  const after = await get('/api/admin/stats', token);
  assert.strictEqual(after.body.extra.demo_rows, 0);
});

test('статистика: пример «5% / 94% / 1%» считается корректно', function () {
  const rows = [];
  for (let i = 0; i < 100; i++) {
    const cat = i < 5 ? 'walk' : i < 99 ? 'food' : 'food';
    rows.push({ client_id: 'u' + i, category: cat, activity: i === 99 ? 'ростикс' : cat === 'walk' ? 'прогулка' : 'кафе', source: 'ai', rating: 5, accepted: 1, created_at: new Date().toISOString(), prefs: [] });
  }
  const s = MK.computeStats(rows, []);
  const walk = s.favourite.find(function (f) { return f.id === 'walk'; });
  assert.strictEqual(walk.share, 5);
  const ros = s.topActivities.find(function (a) { return a.activity === 'ростикс'; });
  assert.strictEqual(ros.share, 1);
});

test('ИИ-модуль: разбор ответа и обращение к OpenAI-совместимому API (мок)', async function () {
  const http = require('node:http');
  const ai = require('../src/ai.js');
  // разбор «грязного» ответа
  const p = ai.parseAnswer('Вот идея:\n```json\n{"category":"sport","activity":"Тренировка в зале!","emoji":"🏋️","text":"Может, сегодня потренируемся? Час в зале поднимет настроение."}\n```');
  assert.strictEqual(p.category, 'sport');
  assert.strictEqual(p.activity, 'тренировка в зале');
  assert.throws(function () { ai.parseAnswer('без json'); });
  assert.strictEqual(ai.parseAnswer('{"category":"unknown","activity":"x","emoji":"abc","text":"Какой-то нормальный текст идеи"}').category, 'home');

  // мок-сервер
  let seenAuth = null, seenBody = null;
  const mock = http.createServer(function (req, res) {
    seenAuth = req.headers.authorization;
    let b = ''; req.on('data', function (c) { b += c; });
    req.on('end', function () {
      seenBody = JSON.parse(b);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: '{"category":"walk","activity":"прогулка в парке","emoji":"🌳","text":"Сегодня отличный день, чтобы выйти на прогулку!"}' } }] }));
    });
  });
  await new Promise(function (r) { mock.listen(0, '127.0.0.1', r); });
  process.env.AI_API_KEY = 'k-test'; process.env.AI_BASE_URL = 'http://127.0.0.1:' + mock.address().port; process.env.AI_MODEL = 'm-test';
  try {
    const gen = await post('/api/generate', { clientId: 'testclient-ai-01', prefs: { categories: ['walk'] } });
    assert.strictEqual(gen.body.source, 'ai');
    assert.strictEqual(gen.body.activity, 'прогулка в парке');
    assert.strictEqual(seenAuth, 'Bearer k-test');
    assert.strictEqual(seenBody.model, 'm-test');
    // ИИ упал → запасной генератор + причина в журнале
    mock.close();
    process.env.AI_TIMEOUT_MS = '500';
    const fb = await post('/api/generate', { clientId: 'testclient-ai-01', prefs: {} });
    assert.strictEqual(fb.body.source, 'local');
    const row = app.db.prepare('SELECT error FROM requests WHERE id = ?').get(fb.body.id);
    assert.ok(row.error, 'ошибка ИИ записана');
  } finally { delete process.env.AI_API_KEY; delete process.env.AI_BASE_URL; delete process.env.AI_MODEL; delete process.env.AI_TIMEOUT_MS; }
});
