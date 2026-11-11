-- Segurança do acesso ao painel e cor por serviço.

-- Sessões com identificação do aparelho (as sessões antigas são encerradas).
DROP TABLE IF EXISTS sessions;
CREATE TABLE sessions (
  id         INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT ''
);

-- Contador genérico para limitar tentativas (login, recuperação, agendamento).
DROP TABLE IF EXISTS booking_attempts;
CREATE TABLE rate_hits (
  key TEXT NOT NULL,
  at  INTEGER NOT NULL
);
CREATE INDEX idx_rate_hits ON rate_hits(key, at);

-- Histórico de segurança (mostrado em Ajustes; apagado após 90 dias).
CREATE TABLE security_events (
  id         INTEGER PRIMARY KEY,
  type       TEXT NOT NULL,
  ip         TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  at         INTEGER NOT NULL
);
CREATE INDEX idx_security_events_at ON security_events(at);

-- Cor de cada serviço na agenda (hex). NULL = cor automática.
ALTER TABLE services ADD COLUMN color TEXT;
