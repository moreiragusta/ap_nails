// Gera um link de PRIMEIRO ACESSO (uso único, válido por 48h) para a administradora
// criar a própria senha. A NUKKI nunca conhece a senha.
// Também serve como último recurso se ela perder a senha E o código de recuperação.
//
// Uso:  npm run setup-link -- --remote https://apnails.com.br
//       npm run setup-link -- --local  http://localhost:5173
import { webcrypto as crypto, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const target = args.find((a) => a === '--local' || a === '--remote');
const site = args.find((a) => /^https?:\/\//.test(a));
if (!target || !site) {
  console.error('Uso: npm run setup-link -- [--local | --remote] <endereço do site>');
  process.exit(1);
}

const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');
const exp = Date.now() + 48 * 3600 * 1000;
const value = JSON.stringify({ hash, exp }).replace(/'/g, "''");

const file = join(tmpdir(), `apn-setup-${Date.now()}.sql`);
writeFileSync(file, `INSERT INTO settings (key, value) VALUES ('_setup', '${value}') ON CONFLICT(key) DO UPDATE SET value = excluded.value;\n`);
const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'DB', target, `--file="${file}"`], { stdio: 'inherit', shell: true });
unlinkSync(file);
if (r.status !== 0) process.exit(r.status ?? 1);

console.log('\nLink de primeiro acesso (válido por 48h, uso único):\n');
console.log(`${site.replace(/\/$/, '')}/admin/primeiro-acesso#${token}\n`);
console.log('Envie para a administradora por um canal privado. Ao usar, ela cria a própria senha');
console.log('e recebe um código de recuperação para redefinir a senha sozinha no futuro.\n');
