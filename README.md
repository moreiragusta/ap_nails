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
scripts/    gerar chaves VAPID e definir senha
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
- Painel: http://localhost:5173/admin. A senha é a de `ADMIN_INITIAL_PASSWORD` no `.dev.vars`.
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
5. Defina a senha inicial do painel (a Amanda pode trocar depois em Ajustes):
   ```bash
   npx wrangler secret put ADMIN_INITIAL_PASSWORD
   ```
6. Aplique o esquema do banco e publique:
   ```bash
   npm run db:migrate:remote
   ```
   ```bash
   npm run deploy
   ```

O site fica em `https://ap-nails.<sua-conta>.workers.dev`. Para usar domínio próprio, registre no nome da cliente e adicione em *Workers → ap-nails → Settings → Domains & Routes*.

### No celular da Amanda (Android)

1. Abra `https://<site>/admin` no Chrome e entre com a senha.
2. Toque em **Instalar** no aviso da Agenda, ou use o menu do Chrome → *Adicionar à tela inicial*.
3. Em **Ajustes → Notificações e lembretes**, toque em **Ativar notificações** e depois em **Enviar notificação de teste**.
4. Em **Ajustes → Seu negócio**, preencha o endereço. Ele aparece no mapa do site e no lembrete.
5. Cadastre os serviços e combos com foto. Um serviço sem foto não aparece no site.

## Manutenção

- **Redefinir a senha** (quando ela esquecer). Isso também encerra as sessões abertas:
  ```bash
  npm run set-password -- "novaSenha" --remote
  ```
- **Galeria e textos da landing**: `src/landing/content.ts` e fotos em `public/gallery/` (WebP, cerca de 1200 px). Depois de alterar, rode `npm run deploy`.
- **Logs**: `npx wrangler tail`, ou o painel da Cloudflare → Workers → ap-nails → Logs.
- **Backup do banco**:
  ```bash
  npx wrangler d1 export ap-nails --remote --output=backup.sql
  ```
- **Novas tabelas ou colunas**: crie `migrations/0002_*.sql` e rode `npm run db:migrate:remote`.

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
