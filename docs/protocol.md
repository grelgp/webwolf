# WebSocket protocol

One endpoint: `ws://<host>/ws`. Every frame is JSON with a `t` discriminator. The types in
`src/shared/protocol.ts` are the authority; this document explains the flows around them.

`PROTOCOL_VERSION` is `3`. The server rejects a `hello` carrying a different number, which
turns a stale cached page into a clear error instead of a silent desync.

One socket may hold **up to two seats**, so that two people can play from one phone. A seat is
still a full player - own card, own turn, own vote - and every frame below is about seats
rather than sockets: the server sends one snapshot per seat, and every seated command names
the seat it acts for.

---

## Handshake

Every socket opens with `hello`:

```jsonc
{ "t": "hello", "protocol": 3 }                                  // new visitor
{ "t": "hello", "protocol": 3, "code": "HGHD",
  "seats": [ { "playerId": "…", "token": "…" } ] }               // resuming one seat
{ "t": "hello", "protocol": 3, "code": "HGHD",
  "seats": [ { "playerId": "…", "token": "…" },
             { "playerId": "…", "token": "…" } ] }               // resuming a shared phone
```

| Outcome | Server replies |
| --- | --- |
| No credentials | *(nothing)* — the client shows its home screen |
| At least one seat valid | `welcome`, then one `state` per seat |
| Every seat stale | `goodbye { reason: "room_not_found" }` — the client clears storage |
| Wrong version | `error { code: "bad_protocol" }` |

`welcome` carries `{ code, seats }`, the complete list of seats this device now holds. The
client mirrors it into localStorage, so it is re-sent whenever that set changes — a companion
seated, a seat left, a seat reclaimed by another device — and it is the only thing that lets a
refreshed browser take both halves of a shared phone back at once.

A device that resumes a seat also adopts that seat's device identity, which is what keeps two
shared seats recognised as one phone across a refresh.

---

## Client → Server

Every message below the line marked **seated** additionally carries `seat: PlayerId`, naming
which of this device's seats is acting. A frame naming a seat the device does not hold is
refused with `not_in_room`, so a shared phone can never act for anyone but its own two players
— and neither can a hand-crafted frame.

| Message | Who | Notes |
| --- | --- | --- |
| `hello` | anyone | First frame on every socket |
| `create_room { nickname }` | anyone | Creates the room and seats you as host |
| `join_room { code, nickname }` | anyone | Code is case-insensitive |
| `add_player { nickname }` | seated, lobby | Seats a second player on this device |
| `leave_room { seat? }` | seated | One seat, or the whole device when omitted |
| `ping` | anyone | Answered with `pong` |
| — **seated, all carry `seat`** — | | |
| `set_nickname { nickname }` | seated | Duplicates get a numeric suffix |
| `set_deck { deck }` | host, lobby | Absolute counts: `{ "werewolf": 2, "seer": 1 }` |
| `set_settings { settings }` | host, lobby | Partial patch; numbers are clamped to `SETTINGS_BOUNDS` |
| `kick_player { playerId }` | host, lobby | |
| `start_game` | host, lobby | Fails with `invalid_deck` if the deck does not fit the table |
| `ready` | seated | Acknowledges the role reveal; the phase ends early once every seat has |
| `night_action { groupId, slots }` | acting player | See below |
| `night_skip` | acting player | Every night action is optional |
| `end_discussion` | host, day | Ends the discussion timer early |
| `cast_vote { targetId }` | seated, vote | Changeable until everyone has voted |
| `play_again` | host, reveal | Keeps players, deck and settings |

Unrecognised or out-of-turn messages produce an `error` frame and change nothing.

`add_player` fails with `device_full` when the phone already holds `MAX_SEATS_PER_DEVICE`
seats, and with `room_full` when the table itself has no room left.

---

## Server → Client

| Message | Sent to | Meaning |
| --- | --- | --- |
| `welcome { code, seats }` | one device | Every seat this device now holds, with credentials |
| `state { state }` | each **seat** | A full, individually redacted snapshot |
| `narrate { key, params? }` | **host only** | Speak this line; `key` indexes `src/client/i18n/fr.ts` |
| `error { code, message }` | one player | `message` is English, for logs; the client shows its own French text keyed by `code` |
| `goodbye { reason, seat? }` | one device | A seat is unbound; without `seat`, all of them are |
| `pong` | one player | |

### Error codes

`bad_protocol`, `bad_request`, `room_not_found`, `room_full`, `game_in_progress`, `not_host`,
`not_in_room`, `invalid_deck`, `invalid_action`, `device_full`, `kicked`, `internal`.

---

## Snapshots

The server sends no deltas. Every change re-sends the whole `ClientState`, redacted for its
recipient. See [architecture.md](architecture.md) for why, and for the phase-by-phase
disclosure table.

```jsonc
{
  "code": "HGHD",
  "phase": "night",
  "round": 0,
  "serverNow": 1755511234567,   // for the client's clock offset
  "youId": "…",                 // the seat this snapshot is for
  "isHost": false,
  "players": [ { "id": "…", "nickname": "Bruno", "isHost": false, "connected": true } ],
  "settings": { "roleRevealSeconds": 10, "nightStepSeconds": 15, "…": 0 },
  "deck": ["werewolf", "werewolf", "seer", "robber", "troublemaker", "villager"],
  "timer": { "endsAt": 1755511249567, "durationMs": 15000 },
  "night": { "step": 2, "stepCount": 4, "role": "seer" },
  "private": { "turn": { "…": 0 } }        // present only for the acting player
}
```

Optional fields are **absent**, not null, when they do not apply. A player who is not the Seer
receives no field describing what the Seer saw, so there is nothing to dig out of devtools.

`night.role` is public: the narrator says it out loud.

---

## Night actions

A role declares one or more `SelectionGroup`s and the player satisfies **exactly one**:

```jsonc
// Seer, offered both options
"groups": [
  { "id": "player", "source": "players", "count": 1, "excludeSelf": true },
  { "id": "center", "source": "center",  "count": 2, "excludeSelf": false }
]
```

The client accumulates taps and submits as soon as one group is exactly filled:

```jsonc
{ "t": "night_action", "groupId": "center",
  "slots": [ { "kind": "center", "index": 0 }, { "kind": "center", "index": 2 } ] }
```

A `CardSlot` is either `{ "kind": "player", "playerId": "…" }` or
`{ "kind": "center", "index": 0 | 1 | 2 }`.

The server re-validates against the same declaration and rejects anything that does not fit
— wrong group, wrong count, duplicate slot, wrong source, or targeting your own seat when the
group forbids it. The browser's grid is a convenience, never a check.

The result comes back in the next snapshot, inside `private.turn`:

```jsonc
{
  "role": "robber",
  "groups": [],                                   // closed: the action is spent
  "fellows": [],
  "revealed": [ { "slot": { "kind": "player", "playerId": "me" }, "role": "seer" } ],
  "swapped":  [ { "kind": "player", "playerId": "me" }, { "kind": "player", "playerId": "…" } ],
  "resolved": true,
  "passive": false
}
```

`passive` is true when the role had no choice at all — a pack of two werewolves simply
recognises each other through `fellows`, and the Insomniac is handed a `revealed` card the
moment their step opens, without ever sending anything.

`fellowRole` accompanies `fellows` and names the card those players are shown as. It is the
viewer's own role for werewolves and Masons, and `"werewolf"` for the Minion — who sees the
pack without the pack seeing them.

When the step ends, the whole `private` block stops being sent and the result vanishes from
every screen at once.

---

## Reconnection

Sockets are disposable; seats are not.

```
socket drops  ─▶  seat marked offline, card and votes preserved
                  (mid-round the seat is never removed)
socket opens  ─▶  hello + credentials
              ─▶  welcome + full snapshot
              ─▶  the player is exactly where they left off
```

The client reconnects on its own with capped exponential backoff (500 ms → 8 s) and also
retries when the tab becomes visible again, since a phone waking from sleep often finds a
socket the OS quietly killed.

Opening the same room in a second tab moves the seat to the newest device; the old one gets
`goodbye { reason: "kicked", seat }` plus a fresh `welcome` if it still holds another seat, or
a bare `goodbye { reason: "kicked" }` if that was its last one.

If the host stays offline past `HOST_GRACE_MS`, the narrator role passes to the first
connected player.

---

## Keepalive

The server pings every `HEARTBEAT_MS` (25 s by default) at the WebSocket protocol level and
terminates any socket that misses two consecutive beats. Frames larger than `MAX_FRAME_BYTES`
are rejected before parsing.
