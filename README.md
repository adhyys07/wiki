# Hack Club Wiki

Hack Club Wiki is where the Hack Club community shares all their thoughts and
the achievements made during the history of Hack Club.

Anyone can submit a page; an editor reviews it before it goes live.


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

Deploy is a plain Node server (`@astrojs/node` standalone).

## AI Usage
I have used AI to adopt the official hackclub design, apart from that I have used it to make a basic backend for admin tools and took suggestions for what features we can add.