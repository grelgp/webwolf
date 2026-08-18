# Architecture

## The one constraint that shapes everything

Phones lie **face up** on the table for the whole round. Anyone can glance at a neighbour's
screen, and anyone can open devtools.

So the rule is not "the client hides secrets". The rule is:

> **A player's device never receives information that player is not entitled to, at the
> moment they are not entitled to it.**

Every design decision below follows from that sentence — including the one place where a
device deliberately holds two players' secrets at once. See [Shared devices](#shared-devices)
for how that one is squared.

---

## Runtime shape

```
                 ┌──────────────────────────────────────────┐
   phone  ──ws──▶│  ConnectionHub   parse / route / send     │
   phone  ──ws──▶│      │                    ▲               │
   phone  ──ws──▶│      ▼                    │               │
                 │    Room ───onChange──▶ views.ts           │
                 │  (rules, phases,      (redaction)         │
                 │   timers)                                 │
                 └──────────────────────────────────────────┘
                          host phone only ◀── narrate
```

- **`Room`** (`src/server/room/Room.ts`) owns every piece of game state and is the only place
  it mutates. It knows nothing about sockets: it reports "something changed" and "say this out
  loud" through two callbacks. That makes it testable without a network.
- **`ConnectionHub`** (`src/server/net/ConnectionHub.ts`) is pure plumbing — validate untrusted
  frames, bind a socket to a seat, fan out snapshots.
- **`views.ts`** (`src/server/net/views.ts`) is the security boundary. Nothing else builds a
  payload for a client.
- **`RoomManager`** handles code allocation, host hand-over and reaping.

Rooms live in memory. For a party game played in one sitting that is the right trade: a
restart drops every table, but nothing needs a database and no personal data is ever at rest.
`Room` contains no I/O, so swapping the map for a store is a contained change.

---

## Full snapshots, not deltas

The server never sends patches. Every change re-sends a complete, per-player-redacted
`ClientState`.

A table is at most ten players, so a snapshot is a couple of kilobytes. In exchange, three
hard problems collapse into one code path:

- **Reconnection** — a returning socket just gets the current snapshot.
- **Late arrival** — same.
- **"What may this player see?"** — answered once, in `buildClientState`, instead of at every
  individual event.

The client mirrors this: it rebuilds the whole screen on every snapshot. That is affordable
at this scale and it eliminates the bug that matters most here — a secret left behind in the
DOM after the phase that revealed it has ended.

---

## What each phase discloses

Snapshots are built per seat, never per socket. A shared device gets one apiece, redacted
exactly as if the two players were on separate phones.

| Phase | In your snapshot | Notably absent |
| --- | --- | --- |
| `lobby` | Players, deck, settings | — |
| `role_reveal` | **Your own dealt card** | Everyone else's card |
| `night` | **Your turn**, if the called role is the one you were dealt | Anything about other players' turns; who has acted |
| `day` | Nothing private | **Even your own card** |
| `vote` | Your own vote; how many have voted | Who voted for whom |
| `reveal` | Everything | — |

Two of these are worth spelling out.

**`day` hides your own card on purpose.** In the physical game your card is face down in front
of you and you may not look at it again. Re-showing it would remove the doubt that makes the
Robber and the Troublemaker interesting, so the server simply stops sending it.

**`night` exposes no per-player progress.** `PublicPlayer.ready` exists during `role_reveal`
and `PublicPlayer.hasVoted` exists during `vote`, but during the night there is no such field
at all — "who has already acted" would identify the holder of the role being called.

---

## The night

### Every role in the deck is called

The wake order is derived from the **deck**, not from who was dealt what
(`wakeOrderForDeck`). A Seer card sitting in the center is still announced out loud and still
gets its full step, with nobody acting. Skipping it would let the table deduce the contents of
the center from the narrator's silence — exactly the leak the physical game avoids by having
the narrator read a fixed script.

### `dealt` never changes; `playerCards` does

```
dealt:       who wakes up, and as what        (frozen at the deal)
playerCards: what you actually are at dawn    (mutated by every swap)
center:      the three face-down cards        (mutated by every swap)
```

You act as the card you were **handed**. A player robbed at 03:00 still wakes for their
original role if their turn has not passed yet, and never learns they were robbed. What team
you are on at the end of the round is decided by `playerCards`.

Because steps run strictly one after another and each mutates in place, ordering falls out for
free: the Seer (wake order 20) genuinely reads the pre-theft table, because the Robber (30)
has not run yet. There is no need to model "time" anywhere.

### Selection is declarative

A role does not describe its UI. It declares a list of `SelectionGroup`s, and the player
satisfies exactly one of them:

| Role | Groups |
| --- | --- |
| Robber | 1 player, not self |
| Troublemaker | 2 players, not self |
| Lone Werewolf | 1 center card |
| Seer | (1 player, not self) **or** (2 center cards) |
| Werewolf pack | *none* — nothing to choose |

The browser builds its entire grid from that description, accumulates taps, and submits as
soon as one group is exactly filled. The Seer therefore reads a player in one tap and two
center cards in two, with no confirm button anywhere.

The server re-validates the selection against the same declaration
(`validateSelection`); the browser's grid is a convenience, never a check.

---

## Timers

The server is the clock. One `setTimeout` per room, always installed through `enterPhase`, so
there is no way to leave a stray timer running.

Snapshots carry `timer.endsAt` as an absolute server timestamp plus `serverNow`. The client
stores `serverNow - Date.now()` as an offset and draws countdowns against it, so a device with
a badly set clock still shows the right number.

On the client, exactly one 250 ms interval refreshes every element carrying `data-countdown`.
Countdowns therefore survive the full-screen rebuilds described above.

---

## Shared devices

Two people may play from one phone, which is what lets a five-player table run on three
devices. The friction it removes is real: nobody has to find, unlock and keep hold of a fifth
handset for a fifteen-minute round.

**A shared seat is not a special kind of seat.** Each of the two is a full player server-side,
with its own id, token, dealt card, night turn and vote. The only thing they share is a
`deviceId`, and the only rules that consult it are these two:

- a device may hold at most `MAX_SEATS_PER_DEVICE` (2) seats;
- the role reveal lasts `roleRevealSeconds × maxSeatsPerDevice`, because the players on a
  shared phone look at their cards one after the other rather than at the same time.

Everything else — dealing, wake order, redaction, voting, win conditions — never learns that
the phone is shared.

### The hand-over gate

Redaction happens per **seat**, so a shared device receives *two* independent snapshots. That
alone would be a leak: showing one seat's turn puts it in front of the player sitting next to
them. The client therefore keeps a lock.

```
store.activeSeatId = null      ← default; nothing private is rendered
        │
        │  a player taps their own name
        ▼
store.activeSeatId = <seat>    ← that seat's private view, and only that one
        │
        │  "terminé", or any change of phase / night step / round
        ▼
store.activeSeatId = null
```

Two properties make it hold:

- **Locked by default, and re-locked automatically.** Any context change (`phase`, `round`,
  `night.step`) resets the lock in `applyServerState`, so the next night step never opens on
  the previous player's screen.
- **The reveal runs one player at a time.** The phase opens on a gate rather than on a card —
  for single-player devices too, since a phone lying face up when the round starts should not
  reveal anything on its own. On a shared phone the gate simply comes round twice.

The one thing the app cannot enforce is the pair themselves: two people sharing a phone can
always look over each other's shoulder, exactly as they could lean over at a real table. The
copy asks them not to; the protocol makes sure nothing is revealed unless somebody taps.

### Where the gate is *not* used

`day` needs no gate — nothing there is private — and `reveal` needs none either, since the
whole table is face up.

**`night` needs none, and deliberately does not have one.** It is the one phase whose secrecy
the table itself already enforces: everyone but the called role has their eyes shut. So
`renderNight` picks whichever seat on the device carries `private.turn` and shows that turn
immediately, exactly as it would for a lone player — no name to tap first, no "terminé" to
hand the phone back.

Nothing leaks by doing so:

- the *other* seat is asleep, by the rules of the game, and sees nothing to leak;
- when both seats do hold the turn it is because the role comes in pairs — two werewolves —
  which leaves no choice to make, so both are owed the same screen and either may be rendered
  (`renderNight` still prefers a seat whose turn is unresolved, should a duplicated role ever
  be given a choice);
- the role being called is public anyway: the narrator says it out loud.

The gate that used to sit here cost a tap per seat per step and told the pair nothing they
could not hear, so it now covers `role_reveal` and `vote` only.

---

## Identity and reconnection

A **seat** is `{ playerId, token }`, generated with `node:crypto` and stored in the browser's
localStorage. A device stores a *list* of them, so a refresh reclaims both halves of a shared
phone in one `hello`. Sockets are disposable; seats are not.

- Refresh, dropped tunnel, locked phone → the new socket sends `hello` with those credentials
  and takes the seat back, mid-round if necessary.
- Opening the room in a second tab moves the seat to the newest device and tells the old one
  *which* seat it lost, so a shared phone carries on with the seat it kept.
- **In the lobby**, leaving removes the seat. **Mid-round it does not** — the player's card is
  part of everyone else's deduction, so they only show as disconnected.
- If the host is gone longer than `HOST_GRACE_MS`, the narrator role passes to the first
  connected player, so a table is never stuck without a narrator.

---

## Narration

The host device is the single narrator phone, mirroring the official app's setup. Only the
host receives `narrate` frames.

The server emits **keys** (`wake.seer`, `phase.day`, `outcome.village`), never sentences. The
browser looks them up in `src/client/i18n/fr.ts` and speaks them with the Web Speech API. Two
consequences:

- The rules engine contains no French at all, so a second locale is a copy of one file.
- A server that learns a new phase before a client does simply stays quiet instead of crashing
  — `narrationLine` returns `null` for unknown keys.

Browsers refuse to speak until the page has seen a user gesture, so `Narrator.unlock()` is
called from the first real tap (creating or joining a room, or the lobby's voice test).

---

## Client structure

There is no UI framework. `src/client/ui/dom.ts` is ~60 lines of hyperscript, and screens are
pure functions of `(store, actions)`.

The one constraint this imposes: **no free-text input inside a re-rendered screen**, because a
rebuild would steal focus. Hence the lobby uses steppers and toggles, and the only text fields
live on screens that stand on their own — the home screen, and the one that names a companion
before seating them.

`Actions` (`src/client/actions.ts`) is the complete list of things the UI may do. Screens never
touch the socket.

---

## Testing

| Script | Scope |
| --- | --- |
| `scripts/rules.test.mjs` | Night engine, selection validation, vote counting, win conditions — hand-built states, fully deterministic |
| `scripts/e2e.mjs` | A real five-player round over WebSockets — on four devices, one of them shared — plus the redaction invariants and reconnection |

The split matters: the end-to-end run depends on a random deal and can never guarantee that
the Robber or a lone Werewolf came up, so the rules that are easy to get subtly wrong are
pinned down separately.
