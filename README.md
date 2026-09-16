# board-house

Ten tables. Closed doors. One day.

A private room for up to ten people to draw, talk, and leave with a replay. There are only ten rooms on the whole service. When they’re taken, you wait. When twenty-four hours pass, the room is deleted.

It is not a document you keep. It is a sitting.

## Why this, and not Excalidraw

Excalidraw is a file. You open a board, you share a URL, you treat the drawing as something that should still be there next month. That’s the right product for “I need a diagram.”

board-house is for the other job: a conversation that needs a whiteboard, and then needs to be over.

**A closed door.** Rooms are not listed. No lobby, no thumbnails, no “who’s drawing.” You get in because the host admits you, or because they handed you a key. A leaked link does not have to stay an invitation — the host can put the door back on.

**A group, not an audience.** Ten people. No spectators, no accounts. If you’re in, you can talk, export, and try for a marker. If you’re not admitted, you see a door.

**Two markers.** Like hosting a call while someone shares a board: one person presents, one annotates. A free marker you pick up. An occupied one you ask that person for. The host can take it off you, the way a Meet host stops a share. Everyone else points. Nobody else draws.

**Voice in the same tab.** Meet-style mute: click on, click off. Host can mute you; only you can unmute yourself. Audio is LiveKit, not our websocket.

**The board is supposed to die.** Twenty-four hours, then it’s gone from the server. Anyone at the table can export the replay. If nobody does, it didn’t happen.

**Ten tables, total.** The only public number is occupancy: `3 / 10`. When the house is full, the house is full.

## A sitting

1. You pick a display name. There is no signup.
2. Host opens a table, if one of the ten is free. They get a guest link and a host link.
3. Default is **knock**. People wait; the host admits or denies. Host can switch to **open link** (the URL is the key until the table is full) and can rotate that key.
4. Ten seats. Full means full, even with the key.
5. Two markers. Host starts with Marker one; Marker two sits on the table.
6. Mic toggles like Meet. Host may mute, never unmute someone else.
7. Anyone inside can download the replay.
8. At twenty-four hours the table is wiped.

## The rules

| | |
| --- | --- |
| 10 rooms on the service | A place, not a cloud. When it’s full, it’s full. |
| 10 people per room | A discussion. Not a stream. |
| No spectators | An audience changes how people draw. |
| No accounts | A name and a link, like a call. |
| Knock, or a key | Privacy is the default. |
| Two markers | Pair on the board. Everyone else points. |
| Meet-style mute | Click to talk. Host can mute; only you unmute yourself. |
| 24 hours | A sitting, not an asset. |
| Anyone inside can export | You’re already in the room. |

## Repo

- `README.md` — this (why)
- `implementation.md` — engineering source of truth for agents and implementers (how, what’s already built, what to rip out)
- `apps/web` — Next.js client
- `apps/http-backend` — HTTP API
- `apps/ws-backend` — live room events (not audio)
- `packages/db` — Neon/Postgres for room metadata, not every stroke

The product is board-house. See `implementation.md` for the contract.

## Run it

```sh
pnpm install
pnpm dev
```

Copy `.env.example` to `.env` at the repo root. Voice needs LiveKit Cloud keys (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`). Neon is `DATABASE_URL` in that same file.
