# Hack Club Wiki

Hack Club Wiki is where the Hack Club community shares all their thoughts and
the achievements made during the history of Hack Club.

Anyone can submit a page; an editor reviews it before it goes live.

Astro (SSR) · Postgres · Pagefind. Needs Node 22.12+ and a Postgres **server**.

## Setup

```sh
npm install
cp .env.example .env     # fill it in
createdb wiki
npm run dev              # localhost:4321
```

Schema creates itself on first query — no migration step.

| Env                    |                                                    |
| :--------------------- | :------------------------------------------------- |
| `DATABASE_URL`         | `postgres://user:pass@host:5432/wiki`              |
| `DATABASE_SSL`         | `off` local · `no-verify` Heroku · unset to verify |
| `ADMIN_PASSWORD`       | Shared editor password                             |
| `ADMIN_SESSION_SECRET` | 32+ chars — `openssl rand -base64 48`              |

## Read this before changing routing

There are **two kinds of page**, and the split is load-bearing:

- `src/content/wiki/*.md` → `/wiki/<slug>`, **prerendered**, edited via PRs.
- `submissions` table rows → `/wiki/c/<slug>`, **SSR**, live on approval.

Pagefind only indexes build-time HTML. Making the canonical route SSR silently
kills site search.

## Routes

|                                |                                                         |
| :----------------------------- | :------------------------------------------------------ |
| `/contribute`                  | Write + preview, send for review                        |
| `/contribute/<id>?token=`      | Author's status/revise view — the token is a credential |
| `/admin` · `/admin/new`        | Review queue · publish directly (password-gated)        |
| `/starred`                     | Editors' picks                                          |
| `/sitemap.xml` · `/robots.txt` | Runtime-generated so community pages appear             |

## Commands

`npm run dev` · `npm run build` (build + search index) · `npm start` ·
`npm run format`

Deploy is a plain Node server (`@astrojs/node` standalone). `Procfile` included.

## Gotchas

- Community pages are missing from search, `/special/all-pages` and category
  listings — those read the markdown collection only.
- Authorship signals on the review page are **advisory heuristics, not proof**.
  Never reject on the score alone.
- Image uploads are sniffed by magic bytes and stored in Postgres. SVG is
  rejected deliberately (scriptable, same-origin).
- Nothing notifies authors; "request changes" relies on them revisiting their
  link.
- One shared admin password, so the audit trail can't attribute actions.
- Rate limiting is per-process and resets on restart.
