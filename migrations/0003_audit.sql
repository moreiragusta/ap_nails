-- Auditoria, localização dos acessos e bloqueio de IP.

-- O histórico passa a guardar também as ações críticas e os alertas,
-- com a localização aproximada (país, cidade e provedor) de cada acesso.
--   category: 'security' (acesso), 'action' (ação no painel) ou 'alert' (fora do comum)
ALTER TABLE security_events ADD COLUMN category   TEXT NOT NULL DEFAULT 'security';
ALTER TABLE security_events ADD COLUMN country    TEXT NOT NULL DEFAULT '';
ALTER TABLE security_events ADD COLUMN city       TEXT NOT NULL DEFAULT '';
ALTER TABLE security_events ADD COLUMN network    TEXT NOT NULL DEFAULT '';
ALTER TABLE security_events ADD COLUMN session_id INTEGER;
CREATE INDEX idx_security_events_cat ON security_events(category, at);

ALTER TABLE sessions ADD COLUMN country TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN city    TEXT NOT NULL DEFAULT '';

-- IPs bloqueados após tentativas erradas (login, recuperação ou link de acesso).
CREATE TABLE ip_blocks (
  ip     TEXT PRIMARY KEY,
  until  INTEGER NOT NULL,
  level  INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  at     INTEGER NOT NULL
);
