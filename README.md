# WebWolf

A phone-friendly online version of **One Night Ultimate Werewolf**. No physical cards:
everyone joins a room with a four-letter code, gets a role on their own device, and plays
through the night in real time over WebSockets. The host's device is the narrator.

The interface and all narration are in **French**; the code, comments and documentation are
in English.

---

## Why it exists

Playing the cardboard game around a table has three recurring annoyances, and this project
removes all of them:

| Problem at the table | How WebWolf removes it |
| --- | --- |
| Cards get memorised by position or rotation | There are no physical cards; positions do not exist |
| People hear each other move, or peek | Nobody moves at night — every action is a tap on your own phone |
| Wrong player targeted, Robber forgets to check their new card | Targets are picked by name, and results are pushed to you instantly |
| Somebody has no phone, or a flat battery | Two players can share one device and pass it between them |

The house rules are otherwise unchanged: the deck is always `players + 3` cards, three of
them stay face down "in the middle", and you may not look at your card again after the night.

---

## Quick start

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

For development, with both the client bundle and the server watching for changes:

```bash
npm run dev
```

Everyone joins from the same URL on the local network — for example
`http://192.168.1.20:3000`. The host taps **Créer une partie**, reads out the four-letter
code, and everyone else types it in. A link like `http://192.168.1.20:3000/HGHD` pre-fills the
code for them.

### Playing

1. Put every phone **face up** on the table.
2. The host's phone is the **narrator** — leave it in the middle, volume up.
3. The host builds the deck (it must total `players + 3` cards) and starts the round.
4. Every card starts covered: tap **Voir ma carte** when nobody is looking over your shoulder,
   memorise it, then confirm and close your eyes.
5. The narrator calls each role. When it is your turn, your phone shows what you may do; tap,
   and the result appears immediately. When the turn ends it disappears.
6. Discuss, vote, and the full table is revealed.

**Play again** keeps the room, the players and the settings.

### Two players, one phone

Short of devices? In the lobby, tap **Ajouter un 2e joueur** and give them a nickname. They
become a real player of their own — their own card, their own night turn, their own vote — who
happens to share your screen.

Anything private then arrives behind a hand-over screen naming whose turn it is with the
phone: the card reveal goes round the two of you one after the other, and the night and the
vote each ask who is picking the device up before showing anything. Nothing is uncovered until
somebody taps, so a phone lying face up on the table never gives a card away by itself.

Two consequences worth knowing:

- the **role reveal timer is doubled** on a table with a shared phone, since its two players
  read their cards in turn rather than at once;
- the app can gate the screen, but it cannot stop the two of you peeking at each other. Look
  away when it is not your turn, exactly as you would at a real table.

---

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Client bundle watch + server with reload |
| `npm run build` | Bundle the client and compile the server |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Type-check everything without emitting |
| `npm test` | Compile the server, then run the deterministic rules tests |
| `npm run test:rules` | Rules tests only (requires a prior `npm run build:server`) |
| `npm run test:e2e` | Drive a real five-player round against a running server |

`npm run test:e2e` needs a server on `ws://127.0.0.1:3100/ws`; start one with
`PORT=3100 npm start`, or point it elsewhere with `WS_URL=…`. It plays a five-player round
across four devices, one of which is shared.

---

## Configuration

Everything is optional and read from the environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP and WebSocket port |
| `HOST` | `0.0.0.0` | Bind address |
| `HOST_GRACE_MS` | `30000` | How long a disconnected host keeps the narrator role |
| `ROOM_TTL_MS` | `1800000` | How long an empty room survives before being reaped |
| `HEARTBEAT_MS` | `25000` | WebSocket keepalive interval |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

Round settings (timers, deck, narration on/off) are per-room and live in the lobby UI.

---

## Roles in this build

| Role | French | Wakes | Action |
| --- | --- | --- | --- |
| Werewolf ×2 | Loup-Garou | 1st | See the other wolves; alone, peek one center card |
| Seer ×1 | Voyante | 2nd | Look at one player's card, **or** two center cards |
| Robber ×1 | Voleur | 3rd | Swap your card with a player's, then look at your new one |
| Troublemaker ×1 | Noiseuse | 4th | Swap two other players' cards, blind |
| Villager ×3 | Villageois | never | — |

That is eight cards, so this build seats **3 to 5 players** — on as few as three phones, if
two of them are shared. Registering more roles raises the ceiling automatically; see
[docs/adding-a-role.md](docs/adding-a-role.md).

---

## Documentation

| Document | Contents |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | How the pieces fit, the anti-cheat model, and shared devices |
| [docs/protocol.md](docs/protocol.md) | Every WebSocket message, and the reconnection flow |
| [docs/game-rules.md](docs/game-rules.md) | The implemented rules, including the awkward edge cases |
| [docs/adding-a-role.md](docs/adding-a-role.md) | Step-by-step guide to adding a new role |

---

## Project layout

```
src/
  shared/     Types, constants, role registry, deck rules — imported by BOTH sides
  server/
    room/     Room state machine, room lifecycle
    game/     Dealing, night state, role effects, vote and win resolution
    net/      WebSocket routing and per-player state redaction
  client/
    ui/       Screens and components (no framework, ~60 lines of hyperscript)
    net/      Auto-reconnecting socket
    i18n/     All French copy, in one file
public/       Static shell, styles, and the built bundle
scripts/      Rules tests and the end-to-end driver
```
