// Define (ou redefine) a senha do painel direto no banco.
// Uso:  npm run set-password -- "novaSenha" --local
//       npm run set-password -- "novaSenha" --remote
import { webcrypto as crypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [password, target = '--local'] = process.argv.slice(2);
if (!password || password.length < 6 || !['--local', '--remote'].includes(target)) {
  console.error('Uso: npm run set-password -- "senha (mín. 6)" [--local | --remote]');
  process.exit(1);
}

const ITERATIONS = 100000; // mesmo valor de worker/auth.ts
const hex = (b) => Buffer.from(b).toString('hex');
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
const value = `pbkdf2$${ITERATIONS}$${hex(salt)}$${hex(bits)}`;

const file = join(tmpdir(), `apn-set-password-${Date.now()}.sql`);
writeFileSync(file,
  `INSERT INTO settings (key, value) VALUES ('_password_hash', '${value}') ON CONFLICT(key) DO UPDATE SET value = excluded.value;\n`
  + 'DELETE FROM sessions;\n');
const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'DB', target, `--file="${file}"`], { stdio: 'inherit', shell: true });
unlinkSync(file);
if (r.status === 0) console.log('\nSenha atualizada. Todas as sessões abertas foram encerradas.');
process.exit(r.status ?? 1);
