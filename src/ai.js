'use strict';
/*
 * Подключение ИИ. Работает с любым OpenAI-совместимым API:
 * DeepSeek, OpenRouter, Polza.ai, локальный Ollama и т.д.
 * Настраивается переменными AI_API_KEY, AI_BASE_URL, AI_MODEL.
 */
const MK = require('../public/js/core.js');

function config() {
  return {
    key: (process.env.AI_API_KEY || '').trim(),
    base: (process.env.AI_BASE_URL || 'https://api.deepseek.com').trim().replace(/\/+$/, ''),
    model: (process.env.AI_MODEL || 'deepseek-v4-flash').trim(),
    timeout: Number(process.env.AI_TIMEOUT_MS) || 20000
  };
}

function isConfigured() { return !!config().key; }

const SYSTEM_PROMPT = [
  'Ты — модуль рекомендаций сервиса «Мне скучно». Пользователю скучно, и твоя задача — предложить ОДНО конкретное занятие, которое можно начать сегодня.',
  'Тон: дружелюбный, живой, обращение на «ты», без канцелярита и нравоучений. Примеры интонации: «Сегодня отличный день, чтобы выйти с друзьями на прогулку!», «Может, сегодня потренируемся?».',
  'Учитывай время суток, день недели, сезон, интересы, бюджет, компанию и настроение пользователя. Не повторяй то, что уже предлагали. Опирайся на оценки прошлых идей: больше того, что нравилось, меньше того, что не нравилось.',
  'Не предлагай ничего опасного, незаконного, 18+ или связанного с алкоголем. Не выдумывай названия конкретных заведений и акций.',
  'Верни СТРОГО один JSON-объект без пояснений и без markdown-разметки:',
  '{"category":"<одно из: ' + MK.CATEGORIES.map(function (c) { return c.id; }).join(', ') + '>","activity":"<название занятия, 2–4 слова, строчными>","emoji":"<один подходящий эмодзи>","text":"<сообщение пользователю, 1–2 предложения, до 220 символов>"}'
].join('\n');

function buildMessages(prefs, ctx, history, extra) {
  extra = extra || {};
  const tod = MK.timeOfDay(ctx.hour);
  const lines = [];
  lines.push('Сейчас: ' + MK.TOD_NAMES[tod] + ' (' + ctx.hour + ':00), ' + MK.WEEKDAYS[ctx.weekday] + ', ' + MK.MONTHS[ctx.month] + '.');
  lines.push('Любимые категории: ' + (prefs.categories.length ? prefs.categories.map(function (c) { return MK.CAT_BY_ID[c].name; }).join(', ') : 'не указаны (подбери разнообразно)') + '.');
  lines.push('Компания: ' + MK.COMPANY[prefs.company] + '. Бюджет: ' + MK.BUDGET[prefs.budget] + '. Настроение: ' + MK.ENERGY[prefs.energy] + '.');
  const liked = history.filter(function (h) { return h.rating >= 4; }).slice(0, 5).map(function (h) { return h.activity; });
  const disliked = history.filter(function (h) { return h.rating && h.rating <= 2; }).slice(0, 5).map(function (h) { return h.activity; });
  const recent = history.slice(0, 5).map(function (h) { return h.activity; });
  if (liked.length) lines.push('Раньше понравилось (оценка 4–5): ' + liked.join('; ') + '.');
  if (disliked.length) lines.push('Раньше не понравилось (оценка 1–2): ' + disliked.join('; ') + '.');
  if (recent.length) lines.push('Недавно уже предлагали, не повторяй: ' + recent.join('; ') + '.');
  if (extra.forceCategory && MK.CAT_BY_ID[extra.forceCategory]) lines.push('Категория обязательна: ' + extra.forceCategory + '.');
  lines.push('Предложи занятие.');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: lines.join('\n') }
  ];
}

function parseAnswer(raw) {
  const s = String(raw || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b <= a) throw new Error('В ответе ИИ нет JSON');
  let obj;
  try { obj = JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error('ИИ вернул некорректный JSON'); }
  const text = String(obj.text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (text.length < 8) throw new Error('ИИ вернул пустой текст');
  let category = String(obj.category || '').trim().toLowerCase();
  if (!MK.CAT_BY_ID[category]) category = 'home';
  let activity = MK.cleanActivity(obj.activity);
  if (!activity) activity = MK.CAT_BY_ID[category].name.toLowerCase();
  // эмодзи: берём первый символ-графему, иначе эмодзи категории
  let emoji = '';
  try {
    const seg = new Intl.Segmenter('ru', { granularity: 'grapheme' });
    const first = Array.from(seg.segment(String(obj.emoji || '')))[0];
    emoji = first ? first.segment : '';
  } catch (e) { emoji = ''; }
  if (!emoji || !/\p{Extended_Pictographic}/u.test(emoji)) emoji = MK.CAT_BY_ID[category].emoji;
  return { category: category, activity: activity, emoji: emoji, text: text };
}

async function suggest(prefs, ctx, history, extra) {
  const cfg = config();
  if (!cfg.key) throw new Error('AI_API_KEY не задан');
  const messages = buildMessages(prefs, ctx, history, extra);
  const body = { model: cfg.model, messages: messages, temperature: 1.1, max_tokens: 400, stream: false };
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, cfg.timeout);
  const t0 = Date.now();
  try {
    const res = await fetch(cfg.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const t = await res.text().catch(function () { return ''; });
      throw new Error('HTTP ' + res.status + ' ' + t.slice(0, 160).replace(/\s+/g, ' '));
    }
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const parsed = parseAnswer(content);
    return { result: parsed, prompt: JSON.stringify(messages), model: cfg.model, latency: Date.now() - t0 };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Таймаут ' + cfg.timeout + ' мс');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isConfigured, suggest, buildMessages, parseAnswer, config };
