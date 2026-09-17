# board-house

Ten tables. Closed doors. One day.

board-house is a house with ten tables. Each table is a sitting: up to ten people draw on one board, talk in the same tab, and leave. After twenty-four hours the table is wiped.

You pick a name. There is no account. If a table is free, you sit down and host. Everyone else knocks, or comes in with a guest link the host has made open.

## A sitting

The house floor shows all ten tables. Occupied ones name the sitting and the host. Empty ones say sit here.

The host gets a guest link and a host link. Knock is the default: people wait at the door until the host admits or denies them. The host can switch to an open link, change the guest URL so old links have to knock, or end the sitting early.

Ten seats. When they are taken, nobody else gets in.

Two markers. The host starts with Marker one. Marker two sits on the table. A free marker you take. An occupied one you ask that person for; they give or keep it. The host can take a marker or hand it to someone. Everyone else still has a cursor and a laser. Only the two holders draw.

Voice is in the tab. Click the mic on, click it off. The host can mute someone; only that person can unmute themselves.

Anyone at the table can export a replay of the board. At twenty-four hours the sitting is gone, unless the host wiped it sooner.

## The house

| | |
| --- | --- |
| 10 tables | The house is full when they are all taken. |
| 10 people at a table | A discussion. |
| No spectators | If you are in, you can talk, export, and try for a marker. |
| No accounts | A display name and a link. |
| Knock, or an open link | The host chooses the door. |
| Two markers | Pair on the board. Everyone else points. |
| Mic toggle | Host may mute. You unmute yourself. |
| 24 hours | Then the table is empty again. |
| Export | Anyone inside can take the replay with them. |

## Repo

- `apps/web` — Next.js client
- `apps/http-backend` — HTTP API
- `apps/ws-backend` — live room events (not audio)
- `packages/db` — Neon/Postgres for room metadata, not strokes

## Run it

```sh
pnpm install
pnpm dev
```

Copy `.env.example` to `.env` at the repo root. Voice needs LiveKit Cloud keys (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`). Neon is `DATABASE_URL` in that same file.
