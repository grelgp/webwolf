# WebSocket protocol

One endpoint: `ws://<host>/ws`. Every frame is JSON with a `t` discriminator. The types in
`src/shared/protocol.ts` are the authority; this document explains the flows around them.

`PROTOCOL_VERSION` is `1`. The server rejects a `hello` carrying a different number, which
turns a stale cached page into a clear error instead of a silent desync.

---

## Handshake

Every socket opens with `hello`:

```jsonc
{ "t": "hello", "protocol": 1 }                                  // new visitor
{ "t": "hello", "protocol": 1,
  "code": "HGHD", "playerId": "…", "token": "…" }                // resuming a seat
```

| Outcome | Server replies |
| --- | --- |
| No credentials | *(nothing)* — the client shows its home screen |
| Credentials valid | `welcome`, then `state` |
| Credentials stale | `goodbye { reason: "room_not_found" }` — the client clears storage |
| Wrong version | `error { code: "bad_protocol" }` |

`welcome` carries `{ playerId, token, code }`. The client stores it in localStorage; it is the
only thing that lets a refreshed browser reclaim its seat.

---

## Client → Server

| Message | Who | Notes |
| --- | --- | --- |
| `hello` | anyone | First frame on every socket |
| `create_room { nickname }` | anyone | Creates the room and seats you as host |
| `join_room { code, nickname }` | anyone | Code is case-insensitive |
| `leave_room` | seated | Removes the seat in the lobby; marks you offline mid-round |
| `set_nickname { nickname }` | seated | Duplicates get a numeric suffix |
| `set_deck { deck }` | host, lobby | Absolute counts: `{ "werewolf": 2, "seer": 1 }` |
| `set_settings { settings }` | host, lobby | Partial patch; numbers are clamped to `SETTINGS_BOUNDS` |
| `kick_player { playerId }` | host, lobby | |
| `start_game` | host, lobby | Fails with `invalid_deck` if the deck does not fit the table |
| `ready` | seated | Acknowledges the role reveal; the phase ends early once all have |
| `night_action { groupId, slots }` | acting player | See below |
| `night_skip` | acting player | Every night action is optional |
| `end_discussion` | host, day | Ends the discussion timer early |
| `cast_vote { targetId }` | seated, vote | Changeable until everyone has voted |
| `play_again` | host, reveal | Keeps players, deck and settings |
| `ping` | anyone | Answered with `pong` |

Unrecognised or out-of-turn messages produce an `error` frame and change nothing.

---

## Server → Client

| Message | Sent to | Meaning |
| --- | --- | --- |
| `welcome { playerId, token, code }` | one player | Your seat credentials |
| `state { state }` | each player | A full, individually redacted snapshot |
| `narrate { key, params? }` | **host only** | Speak this line; `key` indexes `src/client/i18n/fr.ts` |
| `error { code, message }` | one player | `message` is English, for logs; the client shows its own French text keyed by `code` |
| `goodbye { reason }` | one player | The socket is no longer bound to a seat |
| `pong` | one player | |

### Error codes

`bad_protocol`, `bad_request`, `room_not_found`, `room_full`, `game_in_progress`, `not_host`,
`not_in_room`, `invalid_deck`, `invalid_action`, `kicked`, `internal`.

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
  "youId": "…",
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
recognises each other through `fellows`.

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
`goodbye { reason: "kicked" }`.

If the host stays offline past `HOST_GRACE_MS`, the narrator role passes to the first
connected player.

---

## Keepalive

The server pings every `HEARTBEAT_MS` (25 s by default) at the WebSocket protocol level and
terminates any socket that misses two consecutive beats. Frames larger than `MAX_FRAME_BYTES`
are rejected before parsing.
