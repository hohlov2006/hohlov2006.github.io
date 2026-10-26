'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const MK = require('../public/js/core.js');

const DEMO_PARTNERS = MK.DEMO_PARTNERS;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  return db;
}

function seedPartners(db) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM partners').get().n;
  if (n > 0) return 0;
  const ins = db.prepare('INSERT INTO partners (name, category, address, lat, lng, radius_m, promo_code, offer_text) VALUES (?,?,?,?,?,?,?,?)');
  DEMO_PARTNERS.forEach(function (p) { ins.run(p.name, p.category, p.address, p.lat, p.lng, p.radius_m, p.promo_code, p.offer_text); });
  return DEMO_PARTNERS.length;
}

// Наполнение демо-данными (помечаются demo=1 и удаляются одной кнопкой)
function seedDemo(db, count) {
  count = count || 400;
  const rows = MK.generateDemoRows(count, Date.now());
  const insClient = db.prepare('INSERT OR IGNORE INTO clients (id, prefs_json, created_at, last_seen, demo) VALUES (?,?,?,?,1)');
  const insReq = db.prepare(`INSERT INTO requests
    (client_id, created_at, request_text, prompt, response_text, category, activity, emoji, source, model, latency_ms, rating, rated_at, accepted, demo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`);
  db.exec('BEGIN');
  try {
    const seen = {};
    rows.forEach(function (r) {
      if (!seen[r.client_id]) {
        seen[r.client_id] = 1;
        insClient.run(r.client_id, JSON.stringify(r.prefs_obj), r.created_at, r.created_at);
      }
      insReq.run(r.client_id, r.created_at, r.request_text, null, r.response_text, r.category, r.activity, r.emoji, r.source,
        r.source === 'ai' ? 'demo' : null, r.source === 'ai' ? 700 + Math.floor(Math.random() * 1500) : null,
        r.rating, r.rating ? r.created_at : null, r.accepted);
    });
    // Предложения партнёров
    const partners = db.prepare('SELECT id, category FROM partners').all();
    const clientIds = Object.keys(seen);
    const insOffer = db.prepare('INSERT INTO offers_log (client_id, partner_id, reason, created_at, copied, demo) VALUES (?,?,?,?,?,1)');
    if (partners.length) {
      for (let i = 0; i < Math.round(count / 9); i++) {
        const p = partners[Math.floor(Math.random() * partners.length)];
        const when = new Date(Date.now() - Math.floor(Math.random() * 14 * 86400000)).toISOString();
        insOffer.run(clientIds[Math.floor(Math.random() * clientIds.length)], p.id, Math.random() < 0.6 ? 'near' : 'frequent', when, Math.random() < 0.32 ? 1 : 0);
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return rows.length;
}

function clearDemo(db) {
  db.exec('BEGIN');
  db.exec('DELETE FROM offers_log WHERE demo = 1');
  db.exec('DELETE FROM requests WHERE demo = 1');
  db.exec('DELETE FROM clients WHERE demo = 1');
  db.exec('COMMIT');
}

module.exports = { openDb, seedPartners, seedDemo, clearDemo, DEMO_PARTNERS };
