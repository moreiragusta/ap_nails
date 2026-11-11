-- AP Nails — esquema inicial.
-- Datas: 'YYYY-MM-DD' e horários 'HH:MM' no fuso do negócio.
-- Timestamps (*_at): ISO 8601 em UTC. Valores em centavos.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE services (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  price_cents  INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  photo_key    TEXT,
  is_combo     INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE combo_items (
  combo_id   INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (combo_id, service_id)
);

CREATE TABLE clients (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL UNIQUE,
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Nome, preço e duração do serviço são copiados no agendamento:
-- editar um serviço não altera o histórico nem o financeiro.
CREATE TABLE appointments (
  id                   INTEGER PRIMARY KEY,
  client_id            INTEGER NOT NULL REFERENCES clients(id),
  service_id           INTEGER REFERENCES services(id) ON DELETE SET NULL,
  service_name         TEXT NOT NULL,
  price_cents          INTEGER NOT NULL,
  duration_min         INTEGER NOT NULL,
  date                 TEXT NOT NULL,
  start_time           TEXT NOT NULL,
  end_time             TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'confirmed', 'done', 'cancelled', 'expired')),
  source               TEXT NOT NULL DEFAULT 'site' CHECK (source IN ('site', 'admin')),
  notes                TEXT NOT NULL DEFAULT '',
  confirmation_sent_at TEXT,
  confirmed_at         TEXT,
  alert_sent_at        TEXT,
  reminder_sent_at     TEXT,
  completed_at         TEXT,
  cancelled_at         TEXT,
  expired_at           TEXT,
  payment_method       TEXT CHECK (payment_method IN ('pix', 'cash', 'debit', 'credit')),
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_appt_date   ON appointments(date, start_time);
CREATE INDEX idx_appt_status ON appointments(status);
CREATE INDEX idx_appt_client ON appointments(client_id);

-- Semana padrão. weekday: 0 = domingo ... 6 = sábado
CREATE TABLE weekly_hours (
  weekday    INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  open       INTEGER NOT NULL DEFAULT 0,
  start_time TEXT NOT NULL DEFAULT '09:00',
  end_time   TEXT NOT NULL DEFAULT '18:00'
);
INSERT INTO weekly_hours (weekday, open, start_time, end_time) VALUES
  (0, 0, '09:00', '12:00'),
  (1, 1, '18:00', '22:00'),
  (2, 1, '18:00', '22:00'),
  (3, 1, '18:00', '22:00'),
  (4, 1, '18:00', '22:00'),
  (5, 1, '18:00', '22:00'),
  (6, 1, '08:00', '12:00');

-- Exceções por data (prevalecem sobre a semana padrão):
--   closed  = dias inteiros fechados de date_from a date_to
--   block   = trecho fechado em date_from (start_time–end_time)
--   special = horário especial em date_from (start_time–end_time)
CREATE TABLE date_exceptions (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('closed', 'block', 'special')),
  date_from  TEXT NOT NULL,
  date_to    TEXT NOT NULL,
  start_time TEXT,
  end_time   TEXT,
  reason     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_exc_dates ON date_exceptions(date_from, date_to);

CREATE TABLE expenses (
  id           INTEGER PRIMARY KEY,
  date         TEXT NOT NULL,
  description  TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'Outros',
  amount_cents INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_expenses_date ON expenses(date);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Controle simples contra abuso no agendamento público.
CREATE TABLE booking_attempts (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX idx_attempts ON booking_attempts(ip, at);
