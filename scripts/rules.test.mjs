/**
 * Deterministic rules tests.
 *
 * The end-to-end script exercises the real server but depends on a random
 * deal, so it can never guarantee that the Robber or a lone Werewolf actually
 * came up. These tests drive the night engine and the vote resolver directly
 * with hand-built states, which is where the rules that are easy to get subtly
 * wrong actually live.
 *
 * Run `npm run build:server` first: this imports the compiled modules so the
 * tests exercise exactly the code the server runs.
 */

import assert from "node:assert/strict";

import { ROLES, wakeOrderForDeck } from "../dist/shared/roles.js";
import { MAX_SEATS_PER_DEVICE } from "../dist/shared/constants.js";
import { Room } from "../dist/server/room/Room.js";
import { buildClientState } from "../dist/server/net/views.js";
import { suggestDeck, validateDeck } from "../dist/shared/deck.js";
import { createNightState, getTurnState, readSlot } from "../dist/server/game/nightState.js";
import { ROLE_HANDLERS, validateSelection } from "../dist/server/game/roleHandlers.js";
import { countVotes, decideOutcome } from "../dist/server/game/resolution.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error.message}`);
  }
}

const P = { a: "pa", b: "pb", c: "pc", d: "pd" };
const SEATS = [P.a, P.b, P.c, P.d];

/** Builds a night with an explicit deal, so every test is reproducible. */
function night(dealt, center, script = []) {
  return createNightState(new Map(Object.entries(dealt)), center, script);
}

function act(state, role, actorId, groupId, slots, fellows = []) {
  const turn = getTurnState(state, actorId);
  ROLE_HANDLERS[role]({ night: state, actorId, fellows, turn }, groupId, slots);
  turn.resolved = true;
  return turn;
}

const player = (id) => ({ kind: "player", playerId: id });
const center = (index) => ({ kind: "center", index });

/* -------------------------------------------------------------------------- */
console.log("\n== Night actions ==");

test("Robber takes the target's card and is shown the new one", () => {
  const state = night(
    { [P.a]: "robber", [P.b]: "seer", [P.c]: "villager", [P.d]: "werewolf" },
    ["villager", "villager", "werewolf"],
  );

  const turn = act(state, "robber", P.a, "steal", [player(P.b)]);

  assert.equal(state.playerCards.get(P.a), "seer", "robber now holds the seer card");
  assert.equal(state.playerCards.get(P.b), "robber", "victim receives the robber card");
  assert.equal(turn.revealed.length, 1);
  assert.equal(turn.revealed[0].role, "seer", "robber is shown what they took");
  assert.equal(state.dealt.get(P.a), "robber", "the deal itself is never rewritten");
});

test("Troublemaker swaps two other players and sees nothing", () => {
  const state = night(
    { [P.a]: "troublemaker", [P.b]: "seer", [P.c]: "werewolf", [P.d]: "villager" },
    ["villager", "villager", "robber"],
  );

  const turn = act(state, "troublemaker", P.a, "swap", [player(P.b), player(P.c)]);

  assert.equal(state.playerCards.get(P.b), "werewolf");
  assert.equal(state.playerCards.get(P.c), "seer");
  assert.equal(state.playerCards.get(P.a), "troublemaker", "the swapper is untouched");
  assert.equal(turn.revealed.length, 0, "the swap is blind");
  assert.equal(turn.swapped.length, 2);
});

test("Seer reads one player, or two center cards", () => {
  const state = night(
    { [P.a]: "seer", [P.b]: "werewolf", [P.c]: "villager", [P.d]: "robber" },
    ["villager", "troublemaker", "werewolf"],
  );

  const onPlayer = act(state, "seer", P.a, "player", [player(P.b)]);
  assert.deepEqual(
    onPlayer.revealed.map((r) => r.role),
    ["werewolf"],
  );

  const fresh = night(
    { [P.a]: "seer", [P.b]: "werewolf", [P.c]: "villager", [P.d]: "robber" },
    ["villager", "troublemaker", "werewolf"],
  );
  const onCenter = act(fresh, "seer", P.a, "center", [center(0), center(1)]);
  assert.deepEqual(
    onCenter.revealed.map((r) => r.role),
    ["villager", "troublemaker"],
  );
  assert.equal(fresh.playerCards.get(P.a), "seer", "looking never moves a card");
});

test("A lone Werewolf may peek at one center card; a pack may not", () => {
  const alone = ROLES.werewolf.selection({ holderCount: 1 });
  assert.equal(alone.length, 1);
  assert.equal(alone[0].source, "center");
  assert.equal(alone[0].count, 1);

  const pack = ROLES.werewolf.selection({ holderCount: 2 });
  assert.equal(pack.length, 0, "a pack has nothing to choose");

  const state = night(
    { [P.a]: "werewolf", [P.b]: "seer", [P.c]: "villager", [P.d]: "robber" },
    ["villager", "werewolf", "troublemaker"],
  );
  const turn = act(state, "werewolf", P.a, "peek", [center(1)]);
  assert.deepEqual(
    turn.revealed.map((r) => r.role),
    ["werewolf"],
  );
});

test("Night order matters: the Seer reads the pre-theft table", () => {
  // Seer wakes at 20, Robber at 30, so the Seer must see B's original card
  // even though the Robber takes it moments later.
  assert.ok(ROLES.seer.wakeOrder < ROLES.robber.wakeOrder);

  const state = night(
    { [P.a]: "seer", [P.b]: "werewolf", [P.c]: "robber", [P.d]: "villager" },
    ["villager", "villager", "troublemaker"],
  );

  const seen = act(state, "seer", P.a, "player", [player(P.b)]);
  assert.equal(seen.revealed[0].role, "werewolf", "the Seer saw B as a werewolf");

  const stolen = act(state, "robber", P.c, "steal", [player(P.b)]);
  assert.equal(stolen.revealed[0].role, "werewolf", "the Robber took that same card");
  assert.equal(readSlot(state, player(P.b)), "robber", "B is now the Robber, unknowingly");
});

test("A Troublemaker swap after the Robber moves the stolen card again", () => {
  const state = night(
    { [P.a]: "robber", [P.b]: "werewolf", [P.c]: "troublemaker", [P.d]: "villager" },
    ["villager", "villager", "seer"],
  );

  act(state, "robber", P.a, "steal", [player(P.b)]);
  assert.equal(state.playerCards.get(P.a), "werewolf");

  act(state, "troublemaker", P.c, "swap", [player(P.a), player(P.d)]);
  assert.equal(state.playerCards.get(P.a), "villager", "the thief lost their prize");
  assert.equal(state.playerCards.get(P.d), "werewolf", "an innocent is now the wolf");
});

/* -------------------------------------------------------------------------- */
console.log("\n== Selection validation ==");

test("Illegal selections are rejected", () => {
  const robber = ROLES.robber.selection({ holderCount: 1 });
  const seer = ROLES.seer.selection({ holderCount: 1 });
  const troublemaker = ROLES.troublemaker.selection({ holderCount: 1 });

  assert.equal(validateSelection("robber", robber, "steal", [player(P.b)], P.a), null);
  assert.equal(
    validateSelection("robber", robber, "steal", [player(P.a)], P.a),
    "self_not_allowed",
    "the Robber cannot rob itself",
  );
  assert.equal(validateSelection("robber", robber, "nope", [player(P.b)], P.a), "unknown_group");
  assert.equal(
    validateSelection("seer", seer, "center", [center(0), center(1), center(2)], P.a),
    "wrong_count",
    "the Seer reads two center cards, never three",
  );
  assert.equal(
    validateSelection("seer", seer, "center", [center(0), center(0)], P.a),
    "duplicate_slot",
    "the same card cannot be read twice",
  );
  assert.equal(
    validateSelection("seer", seer, "player", [center(0)], P.a),
    "wrong_source",
    "a center card is not a player",
  );
  assert.equal(
    validateSelection("troublemaker", troublemaker, "swap", [player(P.a), player(P.b)], P.a),
    "self_not_allowed",
  );
});

/* -------------------------------------------------------------------------- */
console.log("\n== Wake order ==");

test("Every role in the deck is called, including center-only ones", () => {
  // Only one Seer card exists and it is sitting in the center; it must still
  // be narrated, or the silence would give the center away.
  const order = wakeOrderForDeck(["villager", "werewolf", "seer", "robber", "villager"]);
  assert.deepEqual(order, ["werewolf", "seer", "robber"]);
  assert.ok(!order.includes("villager"), "the Villager never wakes");
});

/* -------------------------------------------------------------------------- */
console.log("\n== Deck rules ==");

test("Decks must hold exactly players + 3 cards", () => {
  assert.equal(validateDeck(suggestDeck(5), 5).ok, true);
  assert.equal(validateDeck(suggestDeck(5), 4).reason, "wrong_size");
  assert.equal(validateDeck(suggestDeck(3), 2).reason, "too_few_players");
  assert.equal(
    validateDeck(["villager", "villager", "villager", "seer", "robber", "troublemaker"], 3).reason,
    "no_werewolf",
  );
  assert.equal(
    validateDeck(["werewolf", "werewolf", "werewolf", "seer", "robber", "troublemaker"], 3).reason,
    "too_many_copies",
    "only two Werewolf cards exist",
  );
});

/* -------------------------------------------------------------------------- */
console.log("\n== Shared devices ==");

/** A room with no network attached; the callbacks are what the hub provides. */
function emptyRoom() {
  return new Room("TEST", { onChange() {}, onNarrate() {} });
}

test("A device seats two players, and no more", () => {
  const room = emptyRoom();
  assert.ok("player" in room.join("Alice", "device-1"));
  assert.ok("player" in room.join("Zoe", "device-1"));

  const third = room.join("Yann", "device-1");
  assert.equal(third.error?.code, "device_full", "a phone only holds two players");
  assert.equal(room.playerCount, 2);
  assert.equal(room.seatsOnDevice("device-1"), MAX_SEATS_PER_DEVICE);

  // The limit is per device, never per table.
  assert.ok("player" in room.join("Bruno", "device-2"));
  assert.equal(room.playerCount, 3);
  room.dispose();
});

test("Two seats on one device are two independent players", () => {
  const room = emptyRoom();
  const alice = room.join("Alice", "device-1").player;
  const zoe = room.join("Zoe", "device-1").player;

  assert.notEqual(alice.id, zoe.id, "separate seats");
  assert.notEqual(alice.token, zoe.token, "separate resume credentials");
  assert.equal(room.isHost(alice.id), true, "the first seat created the room");
  assert.equal(room.isHost(zoe.id), false, "sharing a phone does not share the narrator");
  room.dispose();
});

test("The reveal lasts as long as the busiest device needs", () => {
  const room = emptyRoom();
  const host = room.join("Alice", "device-1").player;
  room.join("Zoe", "device-1");
  room.join("Bruno", "device-2");
  room.join("Chloe", "device-3");

  assert.equal(room.maxSeatsPerDevice(), 2);
  assert.equal(room.startGame(host.id), null, "the auto-fitted deck is playable");
  assert.equal(
    room.deadline.durationMs,
    room.settings.roleRevealSeconds * 2 * 1000,
    "players sharing a phone look at their cards one after the other",
  );
  room.dispose();
});

test("Only players sharing a phone are marked as sharing one", () => {
  const room = emptyRoom();
  const alice = room.join("Alice", "device-1").player;
  const zoe = room.join("Zoe", "device-1").player;
  const bruno = room.join("Bruno", "device-2").player;

  const players = buildClientState(room, bruno.id).players;
  const groupOf = (id) => players.find((p) => p.id === id).deviceGroup;

  assert.equal(groupOf(alice.id), 1);
  assert.equal(groupOf(zoe.id), 1, "both halves of a shared phone carry the same marker");
  assert.equal(groupOf(bruno.id), undefined, "a player on their own carries none");
  room.dispose();
});

/* -------------------------------------------------------------------------- */
console.log("\n== Voting ==");

test("The most-voted player dies", () => {
  const votes = new Map([
    [P.a, P.b],
    [P.b, P.c],
    [P.c, P.b],
    [P.d, P.b],
  ]);
  const outcome = countVotes(votes, SEATS);
  assert.deepEqual(outcome.eliminated, [P.b]);
  assert.equal(outcome.tally[P.b], 3);
  assert.equal(outcome.noOneDied, false);
});

test("A tie kills everyone tied", () => {
  const votes = new Map([
    [P.a, P.b],
    [P.b, P.a],
    [P.c, P.b],
    [P.d, P.a],
  ]);
  const outcome = countVotes(votes, SEATS);
  assert.deepEqual(outcome.eliminated.sort(), [P.a, P.b].sort());
});

test("One vote each spares the whole table", () => {
  const votes = new Map([
    [P.a, P.b],
    [P.b, P.c],
    [P.c, P.d],
    [P.d, P.a],
  ]);
  const outcome = countVotes(votes, SEATS);
  assert.deepEqual(outcome.eliminated, []);
  assert.equal(outcome.noOneDied, true);
});

test("A near-miss on the spread rule still kills", () => {
  // Three players hold one vote each, but D has two: not a clean spread.
  const votes = new Map([
    [P.a, P.d],
    [P.b, P.d],
    [P.c, P.a],
    [P.d, P.b],
  ]);
  const outcome = countVotes(votes, SEATS);
  assert.deepEqual(outcome.eliminated, [P.d]);
  assert.equal(outcome.noOneDied, false);
});

/* -------------------------------------------------------------------------- */
console.log("\n== Win conditions ==");

const finalRoles = (roles) => new Map(Object.entries(roles));

test("Killing a werewolf wins it for the village", () => {
  const roles = finalRoles({ [P.a]: "werewolf", [P.b]: "seer", [P.c]: "villager" });
  assert.equal(decideOutcome(roles, [P.a]), "village");
});

test("Lynching an innocent while a wolf survives loses it", () => {
  const roles = finalRoles({ [P.a]: "werewolf", [P.b]: "seer", [P.c]: "villager" });
  assert.equal(decideOutcome(roles, [P.b]), "werewolf");
});

test("With no wolf at the table, sparing everyone wins", () => {
  const roles = finalRoles({ [P.a]: "villager", [P.b]: "seer", [P.c]: "robber" });
  assert.equal(decideOutcome(roles, []), "village");
});

test("With no wolf at the table, killing anyone means nobody wins", () => {
  const roles = finalRoles({ [P.a]: "villager", [P.b]: "seer", [P.c]: "robber" });
  assert.equal(decideOutcome(roles, [P.a]), "nobody");
});

test("A wolf that survives because the vote spared everyone still wins", () => {
  const roles = finalRoles({ [P.a]: "werewolf", [P.b]: "seer", [P.c]: "villager" });
  assert.equal(decideOutcome(roles, []), "werewolf");
});

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
