# AP Nails — agendamento e gestão

Sistema da **AP Nails (Amanda Penteado)**, desenvolvido pela **NUKKI**. Ele tem duas partes:

- **Landing page** (`/`): a cliente escolhe o serviço ou combo, vê só os horários livres e agenda com nome e WhatsApp.
- **Painel da Amanda** (`/admin`): app instalável no Android com agenda, confirmação e lembrete pelo WhatsApp, clientes, serviços e combos com foto, financeiro, horários e folgas.

A especificação completa está no documento "AP Nails — Especificação do MVP".

## Stack

| Camada | Tecnologia |
| --- | --- |
| Front-end | React 19 + Vite + TypeScript, PWA (só o painel) |
| API | Cloudflare Workers + Hono (`worker/`) |
| Banco | Cloudflare D1 / SQLite (`migrations/`) |
| Fotos dos serviços | Cloudflare R2, servidas em `/photos/*` |
| Tarefas automáticas | Cron Trigger a cada 15 min (`worker/cron.ts`) |
| Notificações | Web Push com VAPID (`worker/push.ts`, `public/sw.js`) |

O site e a API saem no **mesmo Worker** (Workers com arquivos estáticos). Esse é o caminho que a Cloudflare recomenda hoje no lugar do Pages, e também é gratuito.

Tudo cabe no plano gratuito da Cloudflare. O R2 exige um cartão cadastrado na conta, mas não cobra dentro de 10 GB.

```
shared/     regras e tipos usados pela API e pelo front (cálculo de horários, formatação)
worker/     API, autenticação, cron e push
src/landing landing page (conteúdo fixo em content.ts)
src/admin   painel
public/     ícones/logo (brand/), fotos da galeria (gallery/), manifest e service worker
migrations/ esquema do banco
scripts/    gerar chaves VAPID e link de primeiro acesso
```

## Rodar localmente

Requer Node 20 ou mais novo.

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run vapid
```

Cole as chaves geradas no `.dev.vars`. Depois crie o banco local e suba o servidor:

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

- Landing: http://localhost:5173
- Painel: http://localhost:5173/admin. Na primeira vez, gere o link para criar a senha:
  ```bash
  npm run setup-link -- --local http://localhost:5173
  ```
- O `.dev.vars.example` já traz as chaves **de teste** do Turnstile (sempre aprovam), para o antirrobô funcionar localmente.
- Para disparar as tarefas automáticas na hora: http://localhost:5173/cdn-cgi/handler/scheduled

Em `localhost` as notificações funcionam no Chrome. No celular, elas exigem o site publicado em HTTPS.

## Publicar (primeira vez)

1. Crie a conta Cloudflare da NUKKI e faça login: `npx wrangler login`.
2. Crie o banco e cole o `database_id` retornado em `wrangler.jsonc`:
   ```bash
   npx wrangler d1 create ap-nails
   ```
3. Crie o bucket de fotos (o R2 precisa estar ativado na conta):
   ```bash
   npx wrangler r2 bucket create ap-nails-photos
   ```
4. Gere chaves VAPID **novas** para produção com `npm run vapid`:
   - coloque a pública em `vars.VAPID_PUBLIC_KEY`, no `wrangler.jsonc`;
   - guarde a privada como segredo:
     ```bash
     npx wrangler secret put VAPID_PRIVATE_KEY
     ```
5. Crie o antirrobô (Cloudflare Turnstile), no painel da Cloudflare em *Turnstile → Add widget*:
   - em *Hostnames*, coloque o domínio do site (e o `*.workers.dev`);
   - em *Widget mode*, escolha **Managed**;
   - coloque a *Site Key* em `vars.TURNSTILE_SITE_KEY`, no `wrangler.jsonc`;
   - guarde a *Secret Key* como segredo:
     ```bash
     npx wrangler secret put TURNSTILE_SECRET_KEY
     ```
   Sem essas chaves, o site publicado **recusa** agendamentos e logins (falha fechada).
6. Aplique o esquema do banco (todas as migrações em `migrations/`) e publique:
   ```bash
   npm run db:migrate:remote
   ```
   ```bash
   npm run deploy
   ```

O site fica em `https://ap-nails.<sua-conta>.workers.dev`. Para usar domínio próprio, registre no nome da cliente e adicione em *Workers → ap-nails → Settings → Domains & Routes*.

7. Gere o link de primeiro acesso e envie à Amanda por um canal privado:
   ```bash
   npm run setup-link -- --remote https://<site>
   ```
   O link vale por 48h e só funciona uma vez. A NUKKI **não conhece a senha**.

### No celular da Amanda (Android)

1. Abra o link de primeiro acesso no Chrome, crie a senha e **guarde o código de recuperação** (print ou papel).
2. Toque em **Instalar** no aviso da Agenda, ou use o menu do Chrome → *Adicionar à tela inicial*.
3. Em **Ajustes → Notificações e lembretes**, toque em **Ativar notificações** e depois em **Enviar notificação de teste**.
4. Em **Ajustes → Seu negócio**, preencha o endereço. Ele aparece no mapa do site e no lembrete.
5. Cadastre os serviços e combos com foto. Um serviço sem foto não aparece no site.

## Manutenção

- **Senha esquecida**: a própria Amanda resolve em *Esqueci minha senha*, com o código de recuperação. Só se ela perder a senha **e** o código, a NUKKI gera um novo link de primeiro acesso:
  ```bash
  npm run setup-link -- --remote https://<site>
  ```
- **Galeria e textos da landing**: `src/landing/content.ts` e fotos em `public/gallery/` (WebP, cerca de 1200 px). Depois de alterar, rode `npm run deploy`.
- **Logs**: `npx wrangler tail`, ou o painel da Cloudflare → Workers → ap-nails → Logs.
- **Backup do banco**:
  ```bash
  npx wrangler d1 export ap-nails --remote --output=backup.sql
  ```
- **Novas tabelas ou colunas**: crie `migrations/0002_*.sql` e rode `npm run db:migrate:remote`.

## Segurança

### Proteção da aplicação

| Proteção | Como funciona |
| --- | --- |
| HTTPS | Certificado automático da Cloudflare. O Worker redireciona `http://` para `https://` (e recusa envios sem HTTPS); HSTS de 1 ano em `public/_headers`. No domínio, ative também *Always Use HTTPS* (ver abaixo) |
| WAF | Regras gerenciadas da Cloudflare + regras próprias (bloqueio do painel fora do Brasil e limite no login). Exige domínio próprio na Cloudflare — passo a passo abaixo |
| SQL Injection | Todas as consultas ao D1 usam parâmetros (`?`); nenhum valor vindo do usuário é colado no SQL |
| XSS | O React escapa todo conteúdo exibido, não há HTML injetado e a CSP só permite scripts do próprio site e do Turnstile |
| Força bruta (conta) | **3 senhas erradas seguidas bloqueiam a conta**, de qualquer aparelho: 30 min, depois 2 h, depois 24 h. Nem a senha certa entra; o código de recuperação desbloqueia na hora |
| Força bruta (IP) | **3 tentativas erradas do mesmo IP** (senha, código de recuperação ou link de acesso) bloqueiam o IP: 1 h, 6 h, 24 h e 7 dias. A recuperação continua possível (3/h por IP, 10/dia no total) para a Amanda conseguir se desbloquear |
| Painel só no Brasil | Ligado por padrão: acessos de outros países, de local desconhecido ou da rede Tor são barrados, mesmo com a senha certa. A Amanda pode desligar (com a senha) antes de viajar |
| Antirrobô | Cloudflare Turnstile no agendamento, login, recuperação e primeiro acesso, validado no servidor |
| Agendamento público | Turnstile + 6 pedidos/h por IP + 60/h no total + no máximo 2 pendentes por WhatsApp |
| Senha | Criada pela própria administradora (link de uso único). PBKDF2-SHA256 com 100 mil iterações e sal. Mínimo de 8 caracteres e bloqueio de senhas óbvias |
| Recuperação | Código de 16 caracteres mostrado uma única vez; após o uso é trocado. Só o hash fica guardado |
| Sessões | Cookie `HttpOnly`, `Secure` e `SameSite=Strict`, válido por 30 dias. Lista de aparelhos e “desconectar outros” |
| CSRF | Ações que alteram dados só são aceitas com `Origin` do próprio site |
| Cabeçalhos | CSP, HSTS, `nosniff`, `frame-ancestors 'none'` e painel sem cache nem indexação (`public/_headers`) |
| Fotos | O servidor confere a assinatura real do arquivo (JPG/PNG/WebP) e o tamanho máximo de 3 MB |

### Monitoramento e auditoria

| Item | Como funciona |
| --- | --- |
| Registro de acessos | Todo login (certo ou errado), bloqueio, troca de senha, recuperação e desconexão fica gravado com data, hora, IP, aparelho, país, cidade e provedor |
| Ações críticas | Criar, remarcar, confirmar, concluir, cancelar e reabrir agendamentos; criar, alterar preço, ocultar e excluir serviços; alterar clientes; lançar, alterar e excluir despesas; mudar ajustes, horários e folgas; ativar notificações |
| Tela de registro | *Mais → Registro de atividades*, com filtros (alertas, acessos, alterações) e detalhes de IP e provedor |
| Análise de comportamento | Alerta (registro + aviso no celular) para: país novo, aparelho novo, horário incomum (0h–6h), tentativa de fora do Brasil, IP bloqueado e 3+ IPs diferentes errando a senha em 1 hora (ataque distribuído) |
| Logs da Cloudflare | `observability` ligado no `wrangler.jsonc`: cada requisição ao Worker fica nos *Workers Logs* do painel da Cloudflare |
| Retenção (LGPD) | Acessos e alertas: 90 dias. Alterações: 1 ano. Tentativas: 1 dia. IPs bloqueados: 7 dias após o fim do bloqueio. A limpeza é automática (cron) |

### Ajustes no painel da Cloudflare (com domínio próprio)

Depois de adicionar o domínio na conta da NUKKI:

1. **SSL/TLS → Overview**: modo **Full (strict)**.
2. **SSL/TLS → Edge Certificates**: ligue *Always Use HTTPS*; *Minimum TLS Version* = **TLS 1.2**; ligue *HSTS* (6 meses ou mais, com subdomínios).
3. **Security → WAF → Managed rules**: ative o *Cloudflare Free Managed Ruleset*.
4. **Security → WAF → Custom rules** (o plano gratuito permite 5):
   - *Painel fora do Brasil*: `(starts_with(http.request.uri.path, "/admin") or starts_with(http.request.uri.path, "/api/admin")) and ip.src.country ne "BR"` → **Block**. Desative antes de a Amanda viajar.
   - *Métodos estranhos*: `not http.request.method in {"GET" "HEAD" "POST" "PUT" "PATCH" "DELETE" "OPTIONS"}` → **Block**.
5. **Security → WAF → Rate limiting rules** (1 gratuita): `http.request.uri.path eq "/api/admin/login"`, 5 requisições por 10 segundos por IP → **Block** por 10 segundos.
6. **Security → Bots**: ligue *Bot Fight Mode*.

No endereço `*.workers.dev` esses ajustes não existem; as proteções do próprio Worker (tabela acima) valem nos dois casos.

## Regras de negócio (resumo)

- **Encaixe em blocos** (padrão): o site oferece como início só o começo do expediente e o fim de cada atendimento ou bloqueio. Assim a agenda não fica com buracos. Em Ajustes dá para mudar para o modo livre, a cada 30 min.
- **Agendamento pelo site**: nasce *Aguardando* e já bloqueia o horário. O mesmo WhatsApp pode ter no máximo 2 aguardando.
- **Alerta de 3h**: se a confirmação não for enviada em 3h, a Amanda recebe uma notificação (uma única vez).
- **Expiração**: se a cliente não confirmar em 48h depois do envio, o agendamento vira *Expirado* e o horário é liberado. Não expira se o atendimento acontecer antes do fim do prazo. O prazo só começa a contar quando a confirmação é enviada.
- **Agendamentos lançados no painel** já nascem confirmados. A Amanda pode encaixar fora do expediente, e o painel avisa quando houver conflito.
- **O financeiro** usa o preço gravado no momento do agendamento. Editar um serviço não muda o histórico.

## White-label (novo cliente NUKKI)

1. Copie o repositório.
2. Troque a identidade:
   - cores e fontes em `src/theme.css` e no `<head>` do `index.html`;
   - logo e ícones em `public/brand/`;
   - textos, galeria e perguntas frequentes em `src/landing/content.ts`;
   - nome e cores em `public/manifest.webmanifest`.
3. Ajuste os textos padrão das mensagens e o WhatsApp em `shared/types.ts` (`DEFAULT_SETTINGS`). O cliente também pode editar depois, pelo painel.
4. Em `wrangler.jsonc`, troque `name`, `database_name`, `bucket_name` e as vars.
5. Siga **Publicar (primeira vez)**.

Cada cliente fica isolado, com Worker, banco e bucket próprios. No plano gratuito, os limites somam todos os clientes da conta. Ao passar de uns 10 clientes, migre para o Workers Paid (US$ 5/mês por conta).

## Pendências de conteúdo

- [ ] Logo em PNG transparente ou SVG e monograma "AP". Hoje são recortes provisórios do flyer, em `public/brand/`.
- [ ] Fotos originais da galeria. Hoje são recortes do flyer, em `public/gallery/`.
- [ ] Texto e foto do "Sobre mim" e confirmação das perguntas frequentes (`src/landing/content.ts`).
- [ ] Link "Desenvolvido por NUKKI" (`content.credit.href`).
