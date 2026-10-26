-- Схема базы данных «Мне скучно» (SQLite).
-- Таблицы: clients, requests, partners, location_pings, offers_log.

CREATE TABLE IF NOT EXISTS clients (
  id          TEXT PRIMARY KEY,                 -- анонимный идентификатор браузера
  prefs_json  TEXT NOT NULL DEFAULT '{}',       -- последние настройки подборки
  created_at  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  demo        INTEGER NOT NULL DEFAULT 0
);

-- Каждое нажатие «Мне скучно»: запрос, ответ, оценка
CREATE TABLE IF NOT EXISTS requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  request_text  TEXT NOT NULL,                  -- запрос в человекочитаемом виде
  prompt        TEXT,                           -- полный промпт, отправленный ИИ (NULL для запасного генератора)
  response_text TEXT NOT NULL,                  -- ответ
  category      TEXT NOT NULL,
  activity      TEXT NOT NULL,
  emoji         TEXT NOT NULL DEFAULT '✨',
  source        TEXT NOT NULL CHECK (source IN ('ai', 'local')),
  model         TEXT,
  latency_ms    INTEGER,
  error         TEXT,                           -- причина, если ИИ не ответил и сработал запасной генератор
  rating        INTEGER CHECK (rating BETWEEN 1 AND 5),
  rated_at      TEXT,
  accepted      INTEGER NOT NULL DEFAULT 0,     -- нажал «Пойду!»
  demo          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_requests_client  ON requests(client_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_requests_created ON requests(created_at);

-- Компании-партнёры с промокодами
CREATE TABLE IF NOT EXISTS partners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  address     TEXT,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  radius_m    INTEGER NOT NULL DEFAULT 300,
  promo_code  TEXT NOT NULL,
  offer_text  TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);

-- Отметки геопозиции (координаты округлены до ~100 м)
CREATE TABLE IF NOT EXISTS location_pings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pings_client ON location_pings(client_id, created_at);

-- Показанные предложения партнёров и факт копирования промокода
CREATE TABLE IF NOT EXISTS offers_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  partner_id  INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  request_id  INTEGER REFERENCES requests(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,                    -- near | frequent
  created_at  TEXT NOT NULL,
  copied      INTEGER NOT NULL DEFAULT 0,
  demo        INTEGER NOT NULL DEFAULT 0
);
