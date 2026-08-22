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

import { ROLES, maxSupportedPlayers, wakeOrderForDeck } from "../dist/shared/roles.js";
import { MAX_SEATS_PER_DEVICE, MIN_PLAYERS } from "../dist/shared/constants.js";
import { Room } from "../dist/server/room/Room.js";
import { buildClientState } from "../dist/server/net/views.js";
import { deckToCounts, suggestDeck, validateDeck } from "../dist/shared/deck.js";
import { createNightState, getTurnState, readSlot } from "../dist/server/game/nightState.js";
import {
  ROLE_HANDLERS,
  TURN_START_HANDLERS,
  validateSelection,
} from "../dist/server/game/roleHandlers.js";
import { applyHunterShots, countVotes, decideOutcome } from "../dist/server/game/resolution.js";

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

test("Soûlard takes a center card and looks at neither", () => {
  const state = night(
    { [P.a]: "drunk", [P.b]: "seer", [P.c]: "werewolf", [P.d]: "villager" },
    ["werewolf", "villager", "robber"],
  );

  const turn = act(state, "drunk", P.a, "swap", [center(0)]);

  assert.equal(state.playerCards.get(P.a), "werewolf", "they are a wolf now, and do not know");
  assert.equal(state.center[0], "drunk", "their own card went to the middle");
  assert.equal(turn.revealed.length, 0, "the whole point is that they see nothing");
  assert.equal(turn.swapped.length, 2, "both slots are flagged as moved");
});

test("Insomniaque sees the card in front of them at the end of the night", () => {
  // Wakes last, so what they see is the table as it finally stands.
  assert.ok(ROLES.insomniac.wakeOrder > ROLES.robber.wakeOrder);
  assert.ok(ROLES.insomniac.wakeOrder > ROLES.drunk.wakeOrder);

  const state = night(
    { [P.a]: "insomniac", [P.b]: "robber", [P.c]: "werewolf", [P.d]: "villager" },
    ["villager", "villager", "seer"],
  );

  act(state, "robber", P.b, "steal", [player(P.a)]);

  const turn = getTurnState(state, P.a);
  TURN_START_HANDLERS.insomniac({ night: state, actorId: P.a, fellows: [], turn });

  assert.equal(turn.revealed.length, 1);
  assert.equal(turn.revealed[0].role, "robber", "they were robbed, and they find out");
  assert.equal(ROLES.insomniac.selection({ holderCount: 1 }).length, 0, "nothing to click");
});

test("Nobody with an empty selection can smuggle an action through", () => {
  // The passive roles have no groups at all, so every submission is illegal:
  // there is no group id that could match.
  for (const role of ["insomniac", "mason", "minion", "hunter", "tanner", "villager"]) {
    const groups = ROLES[role].selection({ holderCount: 1 });
    assert.equal(groups.length, 0, `${role} offers no choice`);
    assert.equal(
      validateSelection(role, groups, "swap", [player(P.b)], P.a),
      "unknown_group",
      `${role} cannot be made to act`,
    );
  }
});

/* -------------------------------------------------------------------------- */
console.log("\n== Recognition ==");

/** A room with a hand-built night, so who holds what is not left to chance. */
function roomWithNight(deal) {
  const room = emptyRoom();
  const ids = deal.map((_, index) => room.join(`P${index}`, `device-${index}`).player.id);
  const dealt = new Map(ids.map((id, index) => [id, deal[index]]));
  room.night = createNightState(dealt, ["villager", "villager", "villager"], []);
  return { room, ids };
}

test("Werewolves and Masons recognise their own kind", () => {
  const { room, ids } = roomWithNight(["werewolf", "werewolf", "mason", "mason", "seer"]);
  const [w1, w2, m1, m2, seer] = ids;

  assert.deepEqual(room.fellowsOf(w1), [w2]);
  assert.deepEqual(room.fellowsOf(m1), [m2]);
  assert.deepEqual(room.fellowsOf(m2), [m1]);
  assert.deepEqual(room.fellowsOf(seer), [], "the Seer recognises nobody");
  assert.equal(room.holderCountOf("werewolf"), 2, "a pack, so no center peek");
  room.dispose();
});

test("The Sbire sees the wolves; the wolves never see the Sbire", () => {
  const { room, ids } = roomWithNight(["werewolf", "minion", "villager", "seer"]);
  const [wolf, minion] = ids;

  assert.deepEqual(room.fellowsOf(minion), [wolf], "the Minion is shown the pack");
  assert.deepEqual(room.fellowsOf(wolf), [], "and stays invisible to it");

  // The lone wolf keeps their center peek: the Minion is not a second wolf,
  // however many faces the Minion's own turn shows.
  assert.equal(room.holderCountOf("werewolf"), 1);
  assert.equal(ROLES.werewolf.selection({ holderCount: 1 }).length, 1);
  room.dispose();
});

test("A lone Mason and a Sbire with no wolves are shown an empty table", () => {
  const { room, ids } = roomWithNight(["mason", "minion", "villager", "seer"]);
  const [mason, minion] = ids;

  assert.deepEqual(room.fellowsOf(mason), [], "the other Mason card is in the center");
  assert.deepEqual(room.fellowsOf(minion), [], "every wolf card is in the center");
  room.dispose();
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

test("A full box wakes in the printed order", () => {
  const order = wakeOrderForDeck([
    "villager",
    "tanner",
    "insomniac",
    "drunk",
    "troublemaker",
    "robber",
    "seer",
    "mason",
    "mason",
    "minion",
    "werewolf",
    "hunter",
  ]);

  assert.deepEqual(order, [
    "werewolf",
    "minion",
    "mason",
    "seer",
    "robber",
    "troublemaker",
    "drunk",
    "insomniac",
  ]);
  assert.equal(new Set(order).size, order.length, "two Mason cards are still one step");
  for (const sleeper of ["villager", "hunter", "tanner"]) {
    assert.ok(!order.includes(sleeper), `the ${sleeper} never wakes`);
  }
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

test("Every table size the build seats gets a playable suggestion", () => {
  for (let players = MIN_PLAYERS; players <= maxSupportedPlayers(); players += 1) {
    const deck = suggestDeck(players);
    const validation = validateDeck(deck, players);
    assert.equal(validation.ok, true, `${players} players: ${validation.reason}`);

    // A single Mason card would give its holder a partner who is always in the
    // center, which is not a hand anyone should be dealt by default.
    const masons = deck.filter((card) => card === "mason").length;
    assert.notEqual(masons, 1, `${players} players got a lone Mason`);
  }
});

/* -------------------------------------------------------------------------- */
console.log("\n== Shared devices ==");

/** A room with no network attached; the callbacks are what the hub provides. */
function emptyRoom() {
  return new Room("TEST", { onChange() {}, onNarrate() {} });
}

/** What the host does in the lobby once everyone is seated. */
function fitDeck(room, hostId) {
  assert.equal(room.setDeck(hostId, deckToCounts(suggestDeck(room.playerCount))), null);
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
  fitDeck(room, host.id);
  assert.equal(room.startGame(host.id), null, "the deck is playable");
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
console.log("\n== Stopping a round ==");

/** A room mid-night, driven through the real phase machine. */
function roomInTheNight() {
  const narrated = [];
  const room = new Room("TEST", {
    onChange() {},
    onNarrate(_room, key) {
      narrated.push(key);
    },
  });
  const host = room.join("Alice", "device-1").player;
  const bruno = room.join("Bruno", "device-2").player;
  room.join("Chloe", "device-3");

  assert.equal(room.startGame(host.id), null, "the seeded deck fits a table of three");
  // The reveal ends the moment every seat acknowledges, which opens the night.
  for (const player of room.players) room.markReady(player.id);
  assert.equal(room.phase, "night");

  return { room, host, bruno, narrated };
}

test("The host stops the night and the table lands back in the lobby", () => {
  const { room, host, narrated } = roomInTheNight();
  const deck = room.deck.slice();

  assert.equal(room.stopRound(host.id), null);
  assert.equal(room.phase, "lobby");
  assert.equal(room.night, null, "the deal is discarded, not paused");
  assert.equal(room.deadline, null, "and the night timer with it");
  assert.equal(room.playerCount, 3, "everybody keeps their seat");
  assert.deepEqual(room.deck, deck, "and the deck they were about to play");
  assert.ok(
    narrated.includes("phase.stopped"),
    "the table has its eyes shut and must be told to open them",
  );
  room.dispose();
});

test("Only the host can stop a round", () => {
  const { room, bruno } = roomInTheNight();

  assert.equal(room.stopRound(bruno.id)?.code, "not_host");
  assert.equal(room.phase, "night", "a player cannot end everyone else's night");
  room.dispose();
});

test("Stopping is offered during the night alone", () => {
  const room = emptyRoom();
  const host = room.join("Alice", "device-1").player;
  room.join("Bruno", "device-2");
  room.join("Chloe", "device-3");

  assert.equal(room.stopRound(host.id)?.code, "invalid_action", "not from the lobby");

  assert.equal(room.startGame(host.id), null);
  assert.equal(room.phase, "role_reveal");
  assert.equal(room.stopRound(host.id)?.code, "invalid_action", "nor from the reveal");
  assert.equal(room.phase, "role_reveal", "and the round carries on either way");
  room.dispose();
});

test("A stopped round can be dealt again straight away", () => {
  const { room, host } = roomInTheNight();
  const before = room.round;

  assert.equal(room.stopRound(host.id), null);
  assert.equal(room.round, before + 1, "the aborted round is closed, not resumed");
  assert.equal(room.startGame(host.id), null, "the lobby is fully usable again");
  assert.equal(room.phase, "role_reveal");
  assert.ok(room.night, "a fresh deal, not the one that was abandoned");
  assert.ok(
    room.players.every((player) => !player.ready),
    "nobody carries an acknowledgement over from the stopped round",
  );
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

test("The Tanneur wins by dying, and takes the wolves' win with them", () => {
  const roles = finalRoles({ [P.a]: "tanner", [P.b]: "werewolf", [P.c]: "villager" });
  assert.equal(decideOutcome(roles, [P.a]), "tanner", "the surviving wolf wins nothing");
});

test("A wolf falling with the Tanneur shares the win with the village", () => {
  const roles = finalRoles({ [P.a]: "tanner", [P.b]: "werewolf", [P.c]: "villager" });
  assert.equal(decideOutcome(roles, [P.a, P.b]), "tanner_village");
});

test("A Tanneur who survives is just another villager", () => {
  const roles = finalRoles({ [P.a]: "tanner", [P.b]: "werewolf", [P.c]: "villager" });
  assert.equal(decideOutcome(roles, [P.c]), "werewolf", "an innocent died, the wolf lived");
  assert.equal(decideOutcome(roles, [P.b]), "village");
});

test("Killing the Sbire does not save the village", () => {
  // The Minion is on the werewolf team without being a werewolf card.
  const roles = finalRoles({ [P.a]: "minion", [P.b]: "werewolf", [P.c]: "villager" });
  assert.equal(decideOutcome(roles, [P.a]), "werewolf");
  assert.equal(decideOutcome(roles, [P.b]), "village", "only a real wolf counts");
});

test("With every wolf in the center, the Sbire wins if anyone else dies", () => {
  const roles = finalRoles({ [P.a]: "minion", [P.b]: "seer", [P.c]: "villager" });
  assert.equal(decideOutcome(roles, [P.c]), "werewolf", "an innocent fell for nothing");
  assert.equal(decideOutcome(roles, [P.a]), "village", "lynch the Minion and all is well");
  assert.equal(decideOutcome(roles, []), "village", "sparing everyone still wins");
});

/* -------------------------------------------------------------------------- */
console.log("\n== The Hunter ==");

test("A lynched Chasseur takes their own vote's target with them", () => {
  const votes = new Map([
    [P.a, P.b],
    [P.b, P.a],
    [P.c, P.a],
  ]);
  const roles = finalRoles({ [P.a]: "hunter", [P.b]: "werewolf", [P.c]: "villager" });

  const shot = applyHunterShots([P.a], votes, roles);
  assert.deepEqual(shot, [P.b], "the Hunter voted for B, so B goes down too");
  assert.equal(
    decideOutcome(roles, [P.a, ...shot]),
    "village",
    "the parting shot hit the wolf and won the round",
  );
});

test("A Chasseur who survives shoots nobody", () => {
  const votes = new Map([[P.a, P.b]]);
  const roles = finalRoles({ [P.a]: "hunter", [P.b]: "werewolf", [P.c]: "villager" });
  assert.deepEqual(applyHunterShots([P.c], votes, roles), [], "only a dead Hunter fires");
  assert.deepEqual(applyHunterShots([], votes, roles), [], "and nobody died at all here");
});

test("The shot follows the card held at dawn, not the one dealt", () => {
  const votes = new Map([[P.a, P.c]]);
  // A was dealt the Hunter but the Robber took it: B fires, A does not.
  const roles = finalRoles({ [P.a]: "robber", [P.b]: "hunter", [P.c]: "villager" });
  assert.deepEqual(applyHunterShots([P.a], votes, roles), [], "A no longer holds the bow");
});

test("A Chasseur never fires twice at the same corpse", () => {
  const votes = new Map([[P.a, P.b]]);
  const roles = finalRoles({ [P.a]: "hunter", [P.b]: "werewolf", [P.c]: "villager" });
  // A tie killed both already; the shot has nothing left to add.
  assert.deepEqual(applyHunterShots([P.a, P.b], votes, roles), []);
});

/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
console.log("\n== The deck belongs to the host ==");

test("The deck the host built survives players coming and going", () => {
  const room = emptyRoom();
  const host = room.join("Alice", "device-1").player;
  room.join("Bruno", "device-2");
  const chloe = room.join("Chloe", "device-3").player;
  const dan = room.join("Dan", "device-4").player;

  // A hand-tuned deck for four, deliberately not what suggestDeck() returns.
  const tuned = deckToCounts(["werewolf", "werewolf", "seer", "robber", "villager", "tanner", "minion"]);
  assert.equal(room.setDeck(host.id, tuned), null);
  assert.deepEqual(deckToCounts(room.deck), tuned);

  room.removePlayer(dan.id);
  assert.deepEqual(deckToCounts(room.deck), tuned, "one seat short is a warning, not a reason to rebuild");

  room.removePlayer(chloe.id);
  assert.deepEqual(deckToCounts(room.deck), tuned, "and neither is dropping below the minimum table");

  assert.equal(room.join("Eve", "device-5").error, undefined);
  assert.deepEqual(deckToCounts(room.deck), tuned, "a new arrival does not rebuild it either");
  room.dispose();
});

test("A room opens on a playable default deck", () => {
  const room = emptyRoom();
  assert.equal(validateDeck(room.deck, MIN_PLAYERS).ok, true);
  room.dispose();
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
