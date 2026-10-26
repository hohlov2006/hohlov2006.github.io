/*
 * core.js — общее ядро «Мне скучно».
 * Работает и в браузере (глобальный объект MK), и на сервере (require).
 * Здесь: категории, банк идей (запасной генератор), поиск партнёрских предложений
 * по геопозиции, расчёт статистики для режима разработчика, генерация демо-данных.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MK = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Категории ---------- */
  const CATEGORIES = [
    { id: 'walk',     name: 'Прогулки',          emoji: '🚶', tone: '#A8E6B0' },
    { id: 'sport',    name: 'Спорт',             emoji: '🏋️', tone: '#FFB366' },
    { id: 'food',     name: 'Кафе и еда',        emoji: '☕', tone: '#FFE066' },
    { id: 'culture',  name: 'Кино и культура',   emoji: '🎬', tone: '#C9B6FF' },
    { id: 'creative', name: 'Творчество',        emoji: '🎨', tone: '#FF9EC4' },
    { id: 'games',    name: 'Игры',              emoji: '🎮', tone: '#8FC7FF' },
    { id: 'learn',    name: 'Учёба и навыки',    emoji: '📚', tone: '#7FE0D4' },
    { id: 'social',   name: 'Друзья и общение',  emoji: '🎉', tone: '#FF9A8A' },
    { id: 'home',     name: 'Дом и отдых',       emoji: '🛋️', tone: '#FFD2B0' },
    { id: 'music',    name: 'Музыка',            emoji: '🎧', tone: '#D6F07A' }
  ];
  const CAT_BY_ID = {};
  CATEGORIES.forEach(function (c) { CAT_BY_ID[c.id] = c; });

  const COMPANY = { solo: 'один', friends: 'с друзьями', any: 'неважно' };
  const BUDGET  = { free: 'бесплатно', cheap: 'недорого', any: 'неважно' };
  const ENERGY  = { low: 'спокойно', high: 'активно', any: 'неважно' };

  const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const TOD_NAMES = { m: 'утро', d: 'день', e: 'вечер', n: 'ночь' };

  function timeOfDay(hour) {
    if (hour >= 5 && hour < 11) return 'm';
    if (hour >= 11 && hour < 17) return 'd';
    if (hour >= 17 && hour < 23) return 'e';
    return 'n';
  }

  /* ---------- Банк идей (запасной генератор без ИИ) ----------
     [категория, занятие, эмодзи, текст, цена(0/1/2), компания(s/f/a), энергия(l/h/a), на улице(0/1), время суток(опц.)] */
  const IDEAS = [
    ['walk','прогулка в парке','🌳','Сегодня отличный день, чтобы выйти с друзьями на прогулку! Выберите парк, возьмите чай в термосе и идите, куда глаза глядят.',0,'f','a',1,'mde'],
    ['walk','вечерняя прогулка с музыкой','🌆','Накинь куртку, включи любимый альбом и пройди пешком одну лишнюю остановку. Вечерний город отлично перезагружает голову.',0,'s','l',1,'ed'],
    ['walk','закат на набережной','🌇','Найди место повыше или у воды и встреть закат. Без телефона хотя бы 15 минут — это вызов дня.',0,'a','l',1,'e'],
    ['walk','фотопрогулка по городу','📷','Выйди на час с телефоном и сфотографируй десять необычных деталей: двери, вывески, тени. Потом выбери лучший кадр.',0,'s','a',1,'dme'],
    ['walk','утренняя прогулка с кофе','🌤️','Утро — лучшее время, чтобы пройтись, пока город не проснулся. Возьми кофе с собой и вернись с хорошим настроением.',1,'s','l',1,'m'],
    ['sport','тренировка в зале','🏋️','Может, сегодня потренируемся? Час в зале — и скука точно уйдёт, а настроение поднимется.',2,'a','h',1,'mde'],
    ['sport','лёгкая пробежка','🏃','Надень кроссовки и пробегись 20–30 минут. Не гонись за рекордами, просто разгони кровь.',0,'s','h',1,'mde'],
    ['sport','игра в мяч с друзьями','⚽','Собери друзей на волейбол или футбол во дворе: мяч, две команды и полчаса азарта — скука этого не переживёт.',0,'f','h',1,'de'],
    ['sport','растяжка дома','🧘','Нет сил на зал? Включи ролик с растяжкой на 15 минут: спина скажет спасибо, а голова прояснится.',0,'s','l',0],
    ['sport','велопрогулка','🚴','Достань велосипед и поезжай по новому маршруту. Если велосипеда нет, посмотри, где рядом есть прокат.',1,'a','h',1,'mde'],
    ['food','кофейня с книгой','☕','Загляни в уютную кофейню, закажи что-нибудь новое из меню и возьми с собой книгу или блокнот.',1,'s','l',1,'mde'],
    ['food','кафе с друзьями','🍕','Собирайтесь в кафе! Закажите пару блюд на всех и попробуйте то, что раньше не брали.',2,'f','l',1,'de'],
    ['food','готовка нового блюда','🍳','Выбери рецепт, который давно откладывал(а), и приготовь его. Даже если выйдет не идеально — ужин будет с историей.',1,'a','l',0],
    ['food','пикник','🧺','Устройте пикник: плед, бутерброды, фрукты — и никакой спешки.',1,'f','a',1,'de'],
    ['food','быстрый перекус в фастфуде','🍔','Бывают дни, когда нужен просто вкусный бургер. Сходи в любимое быстрое кафе и закажи что-нибудь, что ещё не пробовал(а).',1,'a','a',1,'mde'],
    ['culture','фильм из списка «позже»','🎬','Выбери фильм, который давно лежит в списке «посмотреть позже», и посмотри его сегодня. Попкорн обязателен.',1,'a','l',0],
    ['culture','музей или выставка','🖼️','В городе наверняка идёт выставка, о которой ты не знаешь. Загляни в музей — это дешевле, чем кажется.',1,'a','l',1,'d'],
    ['culture','концерт или спектакль','🎭','Загляни в афишу на ближайшие дни: живой концерт или спектакль дают совсем другие эмоции, чем запись.',2,'a','l',1,'e'],
    ['culture','документальный фильм','🎞️','Включи документальный фильм на тему, о которой ничего не знаешь. Через час будешь рассказывать друзьям новые факты.',0,'s','l',0],
    ['culture','городской квест','🗺️','Запишитесь на городскую экскурсию или квест — про знакомые улицы вы узнаете то, о чём даже не догадывались.',2,'f','a',1,'de'],
    ['creative','рисунок из окна','🎨','Возьми лист бумаги и нарисуй всё, что видно из окна. Неважно как — важно начать.',0,'s','l',0],
    ['creative','рассказ на 100 слов','✍️','Напиши рассказ на сто слов про человека, который скучал и нашёл дверь в стене. Дальше придумаешь сам(а).',0,'s','l',0],
    ['creative','плейлист настроения','🎶','Собери плейлист «настроение на сегодня» из 15 треков и отправь другу: пусть угадает, как у тебя дела.',0,'a','l',0],
    ['creative','поделка своими руками','🧵','Сделай что-нибудь руками: открытку, полку, браслет. Результат можно подарить или оставить себе.',1,'s','a',0],
    ['creative','видео про свой день','🎥','Сними короткий ролик про сегодняшний день и смонтируй под любимую музыку. Через год будет отличным воспоминанием.',0,'a','a',0],
    ['games','настольные игры','🎲','Достань настольную игру и позови друзей: пара партий — и вечер удался.',1,'f','l',0,'de'],
    ['games','видеоигра','🎮','Запусти игру, в которую давно хотел(а) поиграть, или найди кооператив на двоих.',0,'a','l',0],
    ['games','шахматы и головоломки','♟️','Реши пару шахматных задач или судоку. Мозг скажет спасибо.',0,'s','l',0],
    ['games','боулинг или бильярд','🎳','Сходи в боулинг или бильярд: азарт и немного здоровой конкуренции с друзьями.',2,'f','h',1,'de'],
    ['games','викторина с друзьями','🧠','Устрой викторину в общем чате: по 10 вопросов друг другу про странные факты.',0,'f','l',0],
    ['learn','новый навык за час','💡','Выбери то, что давно хотел(а) освоить: язык, аккорды на гитаре, основы монтажа — и потрать на это один час.',0,'s','a',0],
    ['learn','глава из книги','📖','Открой книгу, которую начинал(а) и забросил(а), и прочти одну главу. Это не обязательство, а разминка.',0,'s','l',0],
    ['learn','подкаст на новую тему','🎙️','Включи подкаст на тему, в которой не разбираешься, и займись делами по дому — скука превратится в пользу.',0,'s','l',0],
    ['learn','бесплатный онлайн-курс','🎓','Загляни на бесплатный курс по теме, которая зацепила: час-два — и ты знаешь больше, чем вчера.',0,'s','a',0],
    ['learn','мини-проект по программированию','💻','Напиши маленькую программу, которая решает твою бытовую задачу: напоминалку, калькулятор чаевых, бота. Это займёт вечер.',0,'s','a',0],
    ['social','звонок старому другу','📞','Напиши или позвони человеку, с которым давно не общался. Скорее всего, он обрадуется сильнее, чем ты думаешь.',0,'s','l',0],
    ['social','чай с друзьями в гостях','🫖','Позови друзей на чай — без повода и подготовки. Пусть каждый принесёт что-нибудь вкусное.',1,'f','l',0,'de'],
    ['social','волонтёрская акция','🤝','Найди волонтёрскую акцию рядом: помощь приюту или уборка двора. Скука уходит, когда есть смысл.',0,'a','a',1,'dm'],
    ['social','встреча по интересам','👥','Сходи на встречу по интересам: клуб, мастер-класс, разговорный клуб. Новые люди — новые идеи.',1,'s','a',1,'de'],
    ['social','семейный вечер','🏠','Проведи вечер с родными: фотоальбом, семейная настолка или совместный ужин.',0,'a','l',0,'e'],
    ['home','перестановка в комнате','🪑','Переставь мебель или разбери одну полку: обновлённая комната заряжает не хуже маленького ремонта.',0,'s','a',0],
    ['home','сериал без чувства вины','📺','Включи сериал, который давно советовали, и разреши себе смотреть без угрызений совести.',0,'a','l',0,'de'],
    ['home','вечер отдыха','🛁','Устрой себе вечер отдыха: ванна, маска, любимая музыка. Иногда скука — просто сигнал, что пора выдохнуть.',1,'s','l',0,'en'],
    ['home','зелень на подоконнике','🪴','Пересади растение или посади зелень на подоконнике: через неделю будет за чем следить.',1,'s','l',0,'mde'],
    ['home','цифровой детокс на 2 часа','📵','Выключи уведомления на два часа и займись чем-нибудь офлайн. После этого скука обычно оказывается куда интереснее.',0,'s','l',0],
    ['music','альбом целиком','💿','Включи альбом целиком, без перемотки, и просто послушай. Давно так не делал(а), да?',0,'s','l',0],
    ['music','караоке','🎤','Устрой караоке дома или в баре с друзьями — вокал не обязателен.',2,'f','h',1,'en'],
    ['music','первая мелодия на инструменте','🎸','Попробуй сыграть простую мелодию на гитаре, пианино или укулеле. Есть приложения, которые учат с нуля.',0,'s','a',0],
    ['music','живая музыка','🎷','Загляни на концерт местной группы: живой звук лучше любой записи.',2,'a','a',1,'en'],
    ['music','музыка нового жанра','🎧','Включи подборку жанра, который никогда не слушал(а), и запиши три трека, которые зацепили.',0,'a','l',0]
  ].map(function (r) {
    return { cat: r[0], activity: r[1], emoji: r[2], text: r[3], cost: r[4], who: r[5], energy: r[6], out: r[7], tod: r[8] || (r[7] ? 'mde' : 'mden') };
  });

  /* ---------- Демо-партнёры (вымышленные). Координаты — район Барнаула, редактируются в режиме разработчика ---------- */
  const DEMO_PARTNERS = [
    { name: 'Спортзал «ФитДом» (демо)', category: 'sport', address: 'пр. Ленина, 46', lat: 53.3478, lng: 83.7787, radius_m: 300,
      promo_code: 'mneskuchno', offer_text: 'Скидка 50% на месячный абонемент по промокоду от сервиса «Мне скучно».' },
    { name: 'Кофейня «Зерно» (демо)', category: 'food', address: 'ул. Молодёжная, 7', lat: 53.3441, lng: 83.7792, radius_m: 250,
      promo_code: 'SKUKA10', offer_text: 'Второй кофе в подарок при заказе любого десерта.' },
    { name: 'Боулинг «Страйк» (демо)', category: 'games', address: 'пр. Строителей, 12', lat: 53.3395, lng: 83.7640, radius_m: 300,
      promo_code: 'STRIKE20', offer_text: 'Скидка 20% на час игры в будний день.' }
  ];

  /* ---------- Утилиты ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function normalizePrefs(p) {
    p = p || {};
    const cats = Array.isArray(p.categories) ? p.categories.filter(function (c) { return CAT_BY_ID[c]; }).slice(0, 10) : [];
    return {
      categories: Array.from(new Set(cats)),
      company: COMPANY[p.company] ? p.company : 'any',
      budget: BUDGET[p.budget] ? p.budget : 'any',
      energy: ENERGY[p.energy] ? p.energy : 'any'
    };
  }

  function normalizeCtx(c, now) {
    c = c || {};
    const d = new Date(now || Date.now());
    function int(v, lo, hi, def) { v = Number(v); return Number.isInteger(v) && v >= lo && v <= hi ? v : def; }
    return {
      hour: int(c.hour, 0, 23, d.getHours()),
      weekday: int(c.weekday, 0, 6, d.getDay()),
      month: int(c.month, 0, 11, d.getMonth())
    };
  }

  function describeRequest(prefs, ctx) {
    const cats = prefs.categories.length ? prefs.categories.map(function (c) { return CAT_BY_ID[c].name.toLowerCase(); }).join(', ') : 'не выбраны';
    return 'Интересы: ' + cats + '; компания: ' + COMPANY[prefs.company] + '; бюджет: ' + BUDGET[prefs.budget] +
      '; настроение: ' + ENERGY[prefs.energy] + '; ' + TOD_NAMES[timeOfDay(ctx.hour)] + ', ' + WEEKDAYS[ctx.weekday] + '.';
  }

  function pickWeighted(items, weights, rnd) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    if (total <= 0) return items[Math.floor(rnd() * items.length)];
    let x = rnd() * total;
    for (let i = 0; i < items.length; i++) { x -= weights[i]; if (x <= 0) return items[i]; }
    return items[items.length - 1];
  }

  function cleanActivity(s) {
    return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s\-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  /* ---------- Запасной генератор ----------
     history: [{category, activity, rating}] — самые свежие первыми */
  function localSuggestion(prefsIn, ctxIn, history, opts) {
    opts = opts || {};
    const rnd = opts.rnd || Math.random;
    const prefs = normalizePrefs(prefsIn);
    const ctx = normalizeCtx(ctxIn);
    history = history || [];
    const tod = timeOfDay(ctx.hour);
    const weekend = ctx.weekday === 0 || ctx.weekday === 6;
    const recent = history.slice(0, 5).map(function (h) { return cleanActivity(h.activity); });

    const catScore = {};
    history.forEach(function (h) {
      if (!h.rating) return;
      (catScore[h.category] = catScore[h.category] || []).push(h.rating);
    });

    let pool = IDEAS.filter(function (i) { return i.tod.indexOf(tod) !== -1 && recent.indexOf(cleanActivity(i.activity)) === -1; });
    if (opts.forceCategory && CAT_BY_ID[opts.forceCategory]) {
      const forced = pool.filter(function (i) { return i.cat === opts.forceCategory; });
      if (forced.length) pool = forced;
    }
    if (!pool.length) pool = IDEAS.slice();

    const weights = pool.map(function (i) {
      let w = 1;
      if (prefs.categories.indexOf(i.cat) !== -1) w *= 3;
      if (prefs.company === 'solo') w *= i.who === 'f' ? 0.15 : 1;
      if (prefs.company === 'friends') w *= i.who === 's' ? 0.15 : 1;
      if (prefs.budget === 'free') w *= i.cost > 0 ? 0.1 : 1;
      if (prefs.budget === 'cheap') w *= i.cost > 1 ? 0.25 : 1;
      if (prefs.energy === 'low') w *= i.energy === 'h' ? 0.2 : 1;
      if (prefs.energy === 'high') w *= i.energy === 'l' ? 0.35 : 1;
      const r = catScore[i.cat];
      if (r && r.length) {
        const avg = r.reduce(function (a, b) { return a + b; }, 0) / r.length;
        w *= avg >= 4 ? 1.6 : avg <= 2.3 ? 0.35 : 1;
      }
      return w;
    });

    const idea = pickWeighted(pool, weights, rnd);
    let text = idea.text;
    if (rnd() < 0.35) {
      const opener = weekend ? 'Выходной же! ' : tod === 'm' ? 'Доброе утро! ' : tod === 'n' ? 'Поздновато, но это не повод скучать. ' : '';
      if (opener && text.indexOf('Сегодня') !== 0) text = opener + text;
    }
    return { category: idea.cat, activity: idea.activity, emoji: idea.emoji, text: text, source: 'local' };
  }

  /* ---------- Геопозиция и партнёрские предложения ---------- */
  function distanceM(lat1, lng1, lat2, lng2) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /*
   * Правило показа предложения партнёра:
   *   «рядом»   — пользователь сейчас в радиусе партнёра;
   *   «частый»  — за последние 30 дней он был в радиусе ×1.5 минимум в 2 разных дня
   *               (то есть ходит мимо или посещает это место регулярно).
   * pings: [{lat, lng, created_at}] — прошлые отметки этого пользователя.
   */
  function findOffer(partners, location, pings) {
    if (!location) return null;
    let best = null;
    (partners || []).forEach(function (p) {
      if (p.active === 0 || p.active === false) return;
      const dist = distanceM(location.lat, location.lng, p.lat, p.lng);
      const radius = p.radius_m || 300;
      let reason = null;
      if (dist <= radius) reason = 'near';
      else {
        const days = {};
        (pings || []).forEach(function (g) {
          if (distanceM(g.lat, g.lng, p.lat, p.lng) <= radius * 1.5) days[String(g.created_at).slice(0, 10)] = 1;
        });
        if (Object.keys(days).length >= 2 && dist <= radius * 4) reason = 'frequent';
      }
      if (reason && (!best || dist < best.dist)) best = { partner: p, dist: Math.round(dist), reason: reason };
    });
    return best;
  }

  /* ---------- Статистика для режима разработчика ----------
     rows:   [{client_id, category, activity, source, rating|null, accepted, created_at, prefs: [categoryId]}]
     offers: [{partner_id, partner_name, copied, created_at}] */
  function computeStats(rows, offers, nowMs) {
    rows = rows || []; offers = offers || [];
    const now = nowMs || Date.now();
    const total = rows.length;
    const rated = rows.filter(function (r) { return r.rating; });
    const sum = function (arr, f) { return arr.reduce(function (a, x) { return a + f(x); }, 0); };
    const avg = function (arr) { return arr.length ? sum(arr, function (r) { return r.rating; }) / arr.length : null; };
    const pct = function (a, b) { return b ? Math.round((a / b) * 1000) / 10 : 0; };
    const r2 = function (x) { return x === null ? null : Math.round(x * 100) / 100; };

    const dist = [0, 0, 0, 0, 0];
    rated.forEach(function (r) { dist[r.rating - 1]++; });

    const clients = {};
    rows.forEach(function (r) { (clients[r.client_id] = clients[r.client_id] || []).push(r); });
    const usersTotal = Object.keys(clients).length;

    // По категориям
    const byCat = CATEGORIES.map(function (c) {
      const rs = rows.filter(function (r) { return r.category === c.id; });
      const rr = rs.filter(function (r) { return r.rating; });
      return {
        id: c.id, name: c.name, emoji: c.emoji, count: rs.length, share: pct(rs.length, total),
        rated: rr.length, avg: r2(avg(rr)), positive: pct(rr.filter(function (r) { return r.rating >= 4; }).length, rr.length)
      };
    }).filter(function (c) { return c.count > 0; }).sort(function (a, b) { return b.count - a.count; });

    // По источнику (ИИ / запасной генератор)
    const bySource = ['ai', 'local'].map(function (s) {
      const rs = rows.filter(function (r) { return r.source === s; });
      const rr = rs.filter(function (r) { return r.rating; });
      return { source: s, name: s === 'ai' ? 'ИИ' : 'Запасной генератор', count: rs.length, rated: rr.length, avg: r2(avg(rr)),
        positive: pct(rr.filter(function (r) { return r.rating >= 4; }).length, rr.length) };
    });

    // Любимая категория каждого пользователя: оценки + принятые идеи + сам факт запроса
    const favCount = {};
    Object.keys(clients).forEach(function (id) {
      const score = {};
      clients[id].forEach(function (r) {
        score[r.category] = (score[r.category] || 0) + 0.2 + (r.rating ? r.rating - 3 : 0) + (r.accepted ? 1 : 0);
      });
      let best = null;
      Object.keys(score).forEach(function (c) { if (best === null || score[c] > score[best]) best = c; });
      if (best) favCount[best] = (favCount[best] || 0) + 1;
    });
    const favourite = Object.keys(favCount).map(function (c) {
      return { id: c, name: CAT_BY_ID[c] ? CAT_BY_ID[c].name : c, emoji: CAT_BY_ID[c] ? CAT_BY_ID[c].emoji : '•', users: favCount[c], share: pct(favCount[c], usersTotal) };
    }).sort(function (a, b) { return b.users - a.users; });

    // Что пользователи отметили в настройках
    const declCount = {}; let declUsers = 0;
    Object.keys(clients).forEach(function (id) {
      const last = clients[id][clients[id].length - 1];
      if (last.prefs && last.prefs.length) {
        declUsers++;
        last.prefs.forEach(function (c) { declCount[c] = (declCount[c] || 0) + 1; });
      }
    });
    const declared = Object.keys(declCount).map(function (c) {
      return { id: c, name: CAT_BY_ID[c] ? CAT_BY_ID[c].name : c, emoji: CAT_BY_ID[c] ? CAT_BY_ID[c].emoji : '•', users: declCount[c], share: pct(declCount[c], declUsers) };
    }).sort(function (a, b) { return b.users - a.users; });

    // Конкретные занятия
    const acts = {};
    rows.forEach(function (r) {
      const k = cleanActivity(r.activity); if (!k) return;
      const a = acts[k] = acts[k] || { activity: k, category: r.category, count: 0, ratings: [] };
      a.count++; if (r.rating) a.ratings.push(r.rating);
    });
    const topActivities = Object.keys(acts).map(function (k) {
      const a = acts[k];
      return { activity: a.activity, category: a.category, count: a.count, share: pct(a.count, total),
        avg: a.ratings.length ? r2(sum(a.ratings, function (x) { return x; }) / a.ratings.length) : null };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 10);

    // Динамика за 14 дней
    const daily = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      const rs = rows.filter(function (r) { return String(r.created_at).slice(0, 10) === key; });
      const rr = rs.filter(function (r) { return r.rating; });
      daily.push({ day: key, count: rs.length, avg: r2(avg(rr)) });
    }

    // Предложения партнёров
    const byPartner = {};
    offers.forEach(function (o) {
      const p = byPartner[o.partner_id] = byPartner[o.partner_id] || { id: o.partner_id, name: o.partner_name, offered: 0, copied: 0 };
      p.offered++; if (o.copied) p.copied++;
    });
    const partners = Object.keys(byPartner).map(function (k) {
      const p = byPartner[k]; p.conversion = pct(p.copied, p.offered); return p;
    });

    // Вердикт
    const avgAll = avg(rated);
    let verdict, level;
    if (rated.length < 10) { verdict = 'Пока мало оценок (' + rated.length + ') — для выводов нужно хотя бы 10.'; level = 'none'; }
    else if (avgAll >= 4.2) { verdict = 'ИИ справляется отлично: средняя оценка ' + r2(avgAll) + ' из 5.'; level = 'great'; }
    else if (avgAll >= 3.6) { verdict = 'ИИ справляется хорошо: средняя оценка ' + r2(avgAll) + ' из 5.'; level = 'good'; }
    else if (avgAll >= 3.0) { verdict = 'ИИ справляется удовлетворительно (' + r2(avgAll) + ' из 5) — стоит доработать подсказки.'; level = 'ok'; }
    else { verdict = 'ИИ справляется плохо (' + r2(avgAll) + ' из 5): нужно менять промпт или модель.'; level = 'bad'; }
    verdict = verdict.replace(/(\d)\.(\d)/g, '$1,$2');
    const weak = byCat.filter(function (c) { return c.rated >= 5 && c.avg !== null && c.avg < 3.3; }).map(function (c) { return c.name; });
    const strong = byCat.filter(function (c) { return c.rated >= 5 && c.avg !== null && c.avg >= 4.2; }).map(function (c) { return c.name; });

    return {
      totals: {
        requests: total, users: usersTotal, rated: rated.length, rated_share: pct(rated.length, total),
        avg: r2(avgAll), positive: pct(rated.filter(function (r) { return r.rating >= 4; }).length, rated.length),
        negative: pct(rated.filter(function (r) { return r.rating <= 2; }).length, rated.length),
        accepted: pct(rows.filter(function (r) { return r.accepted; }).length, total)
      },
      distribution: dist, byCategory: byCat, bySource: bySource, favourite: favourite, declared: declared,
      declaredUsers: declUsers, topActivities: topActivities, daily: daily, partners: partners,
      verdict: { text: verdict, level: level, weak: weak, strong: strong }
    };
  }

  /* ---------- Демо-данные ---------- */
  function generateDemoRows(n, nowMs, rnd) {
    rnd = rnd || Math.random;
    const now = nowMs || Date.now();
    const catW = { food: 34, walk: 15, games: 11, culture: 9, sport: 8, home: 7, social: 6, music: 4, learn: 3, creative: 3 };
    const ids = Object.keys(catW), ws = ids.map(function (k) { return catW[k]; });
    const catBias = { sport: -0.25, learn: -0.15, creative: -0.1, food: 0.15, walk: 0.1 };
    const clients = [];
    for (let i = 0; i < Math.max(8, Math.round(n / 6)); i++) {
      const fav = pickWeighted(ids, ws, rnd);
      const extra = rnd() < 0.4 ? pickWeighted(ids, ws, rnd) : null;
      clients.push({
        id: 'demo-' + Math.floor(rnd() * 1e9).toString(36) + i,
        fav: fav,
        prefs: extra && extra !== fav ? [fav, extra] : [fav],
        company: ['solo', 'friends', 'any'][Math.floor(rnd() * 3)],
        budget: ['free', 'cheap', 'any'][Math.floor(rnd() * 3)],
        energy: ['low', 'high', 'any'][Math.floor(rnd() * 3)]
      });
    }
    const rows = [];
    for (let i = 0; i < n; i++) {
      const c = clients[Math.floor(rnd() * clients.length)];
      const hour = Math.floor(8 + rnd() * 15), weekday = Math.floor(rnd() * 7);
      const created = new Date(now - Math.floor(rnd() * 14 * 86400000));
      const prefs = { categories: c.prefs, company: c.company, budget: c.budget, energy: c.energy };
      const ctx = { hour: hour, weekday: weekday, month: created.getMonth() };
      const source = rnd() < 0.78 ? 'ai' : 'local';
      const sug = localSuggestion(prefs, ctx, [], { rnd: rnd });
      const fav = sug.category === c.fav;
      const base = (source === 'ai' ? 4.0 : 3.35) + (fav ? 0.45 : -0.1) + (catBias[sug.category] || 0);
      let rating = null;
      if (rnd() < 0.82) rating = Math.max(1, Math.min(5, Math.round(base + (rnd() + rnd() + rnd() - 1.5) * 1.5)));
      rows.push({
        client_id: c.id, request_text: describeRequest(normalizePrefs(prefs), normalizeCtx(ctx)),
        response_text: sug.text, category: sug.category, activity: sug.activity, emoji: sug.emoji,
        source: source, rating: rating, accepted: rating && rating >= 4 && rnd() < 0.55 ? 1 : 0,
        created_at: created.toISOString(), prefs: c.prefs, prefs_obj: prefs, ctx: ctx
      });
    }
    rows.sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });
    return rows;
  }

  return {
    CATEGORIES: CATEGORIES, CAT_BY_ID: CAT_BY_ID, COMPANY: COMPANY, BUDGET: BUDGET, ENERGY: ENERGY,
    WEEKDAYS: WEEKDAYS, MONTHS: MONTHS, TOD_NAMES: TOD_NAMES, IDEAS: IDEAS, DEMO_PARTNERS: DEMO_PARTNERS,
    timeOfDay: timeOfDay, normalizePrefs: normalizePrefs, normalizeCtx: normalizeCtx, describeRequest: describeRequest,
    cleanActivity: cleanActivity, localSuggestion: localSuggestion, distanceM: distanceM, findOffer: findOffer,
    computeStats: computeStats, generateDemoRows: generateDemoRows
  };
});
