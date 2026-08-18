/**
 * End-to-end smoke test: drives a real five-player round over WebSockets
 * against a running server, and asserts the redaction invariants along the way.
 *
 * Four sockets, five players: the host's device seats a companion, which is
 * the shared-phone feature under test. Everything downstream of that is driven
 * per *seat*, exactly as the browser does it.
 */

import WebSocket from "ws";

const URL = process.env.WS_URL ?? "ws://127.0.0.1:3100/ws";
const PROTOCOL = 2;

let failures = 0;
function check(condition, label) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
}

/** One device. Holds one seat, or two when a companion is added to it. */
class Client {
  constructor(name) {
    this.name = name;
    /** `{ playerId, token }` per seat, as the server last listed them. */
    this.seats = [];
    /** Latest redacted snapshot per seat. */
    this.states = new Map();
    this.narrations = [];
    this.errors = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      this.ws.on("open", () => {
        this.send({ t: "hello", protocol: PROTOCOL });
        resolve();
      });
      this.ws.on("error", reject);
      this.ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.t === "state") {
          this.states.set(msg.state.youId, msg.state);
        } else if (msg.t === "welcome") {
          this.seats = msg.seats;
          this.code = msg.code;
        } else if (msg.t === "narrate") {
          this.narrations.push(msg.key);
        } else if (msg.t === "error") {
          this.errors.push(msg);
        }
      });
    });
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  /** Sends a seated command on behalf of one of this device's seats. */
  sendAs(playerId, msg) {
    this.send({ ...msg, seat: playerId });
  }

  get playerId() {
    return this.seats[0]?.playerId;
  }

  /** Snapshot of the first seat; every seat agrees on the public parts. */
  get state() {
    return this.states.get(this.playerId);
  }

  stateOf(playerId) {
    return this.states.get(playerId);
  }

  /** Waits until `predicate(state)` holds for a seat, or throws after `timeout` ms. */
  until(predicate, label, timeout = 20000, playerId = undefined) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        const state = playerId ? this.stateOf(playerId) : this.state;
        if (state && predicate(state)) return resolve(state);
        if (Date.now() - started > timeout) {
          return reject(
            new Error(`${this.name}: timed out waiting for ${label} (phase=${state?.phase})`),
          );
        }
        setTimeout(poll, 40);
      };
      poll();
    });
  }

  close() {
    this.ws.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Every seat in play, flattened across devices. The round is driven over this
 * rather than over sockets, because a device may be two players.
 */
function seatsOf(clients) {
  return clients.flatMap((client) =>
    client.seats.map((seat, index) => ({
      client,
      playerId: seat.playerId,
      name: client.seatNames[index],
      get state() {
        return client.stateOf(seat.playerId);
      },
    })),
  );
}

const waitAll = (seats, predicate, label) =>
  Promise.all(seats.map((seat) => seat.client.until(predicate, label, 20000, seat.playerId)));

async function main() {
  const names = ["Alice", "Bob", "Chloe", "David"];
  const clients = names.map((n) => new Client(n));
  for (const c of clients) await c.connect();

  const [host, ...guests] = clients;
  for (const c of clients) c.seatNames = [c.name];

  console.log("\n== Lobby ==");
  host.send({ t: "create_room", nickname: host.name });
  await host.until((s) => s.phase === "lobby", "room created");
  const code = host.code;
  check(/^[A-Z]{4}$/.test(code), `room code is 4 letters (${code})`);

  console.log("\n== Shared device ==");
  // Alice hands half her phone to Zoe: one socket, two real players.
  host.send({ t: "add_player", nickname: "Zoe" });
  await host.until((s) => s.players.length === 2, "companion seated");
  host.seatNames = ["Alice", "Zoe"];

  check(host.seats.length === 2, "host device holds two seats");
  const [alice, zoe] = host.seats.map((seat) => seat.playerId);
  check(alice !== zoe, "the two seats are distinct players");
  check(
    host.seats[0].token !== host.seats[1].token,
    "each seat carries its own resume credential",
  );
  await host.until((s) => s.youId === zoe, "companion snapshot", 5000, zoe);
  check(host.stateOf(zoe)?.youId === zoe, "the companion gets its own snapshot");
  check(!host.stateOf(zoe).isHost, "sharing a phone does not share the narrator");

  // A third seat is refused while the table still has room for one, so this
  // is the device limit talking and not the table size.
  host.send({ t: "add_player", nickname: "Yann" });
  await sleep(150);
  check(host.errors.some((e) => e.code === "device_full"), "a third seat on one phone is refused");
  check(host.state.players.length === 2, "the refused player was never seated");

  console.log("\n== Lobby fills up ==");
  for (const g of guests) {
    g.send({ t: "join_room", code, nickname: g.name });
    await g.until((s) => s.phase === "lobby", `${g.name} joined`);
  }
  await host.until((s) => s.players.length === 5, "five players on four devices");

  const groupOf = (id) => guests[0].state.players.find((p) => p.id === id)?.deviceGroup;
  await guests[0].until((s) => s.players.length === 5, "guests see the whole table");
  check(
    groupOf(alice) === 1 && groupOf(zoe) === 1,
    "the table can see which two players share a phone",
  );
  check(groupOf(guests[0].playerId) === undefined, "players on their own are unmarked");

  const seats = seatsOf(clients);
  check(seats.length === 5, "five seats on four devices");

  check(host.state.isHost, "creator is host");
  check(!guests[0].state.isHost, "guest is not host");
  check(host.state.deck.length === 8, `default deck auto-fits table (${host.state.deck.length} cards)`);

  // Shorten every timer so the round completes in seconds.
  host.sendAs(alice, {
    t: "set_settings",
    settings: { roleRevealSeconds: 5, nightStepSeconds: 5, discussionSeconds: 60, voteSeconds: 15 },
  });
  await host.until((s) => s.settings.nightStepSeconds === 5, "settings applied");

  // A guest must not be able to change the deck.
  guests[0].sendAs(guests[0].playerId, { t: "set_deck", deck: { werewolf: 2, villager: 6 } });
  await sleep(150);
  check(guests[0].errors.some((e) => e.code === "not_host"), "non-host is refused deck changes");

  // Nor may a device act for a seat it does not hold.
  guests[0].sendAs(zoe, { t: "ready" });
  await sleep(150);
  check(
    guests[0].errors.some((e) => e.code === "not_in_room"),
    "a device cannot act for somebody else's seat",
  );

  console.log("\n== Role reveal ==");
  host.sendAs(alice, { t: "start_game" });
  await waitAll(seats, (s) => s.phase === "role_reveal", "reveal");

  check(
    host.state.timer.durationMs === 5 * 2 * 1000,
    "the reveal is doubled for the phone that has to be passed",
  );

  const dealt = new Map();
  for (const seat of seats) {
    const role = seat.state.private?.dealtRole;
    dealt.set(seat.name, role);
    check(typeof role === "string", `${seat.name} sees own card (${role})`);
  }
  check(
    host.stateOf(alice).private.dealtRole !== undefined &&
      host.stateOf(zoe).private.dealtRole !== undefined,
    "both halves of the shared phone are dealt their own card",
  );

  // The private payload must hold the seat's own card and nothing else - no
  // turn data, no result, and above all not the other seat on the same device.
  for (const seat of seats) {
    check(
      Object.keys(seat.state.private).length === 1 && seat.state.private.dealtRole !== undefined,
      `${seat.name} private payload holds only their own card`,
    );
    check(seat.state.result === undefined, `${seat.name} sees no result yet`);
    check(
      seat.state.players.every((p) => p.role === undefined && p.dealtRole === undefined),
      `${seat.name} public player list carries no cards`,
    );
  }
  console.log("  deal:", Object.fromEntries(dealt));

  // Only one seat of the shared phone acknowledges at first: the phase must
  // wait for the second, which is exactly what the hand-over gate relies on.
  for (const seat of seats.filter((s) => s.playerId !== zoe)) {
    seat.client.sendAs(seat.playerId, { t: "ready" });
  }
  await sleep(200);
  check(host.state.phase === "role_reveal", "the round waits for the second player on the phone");
  host.sendAs(zoe, { t: "ready" });

  console.log("\n== Night ==");
  await waitAll(seats, (s) => s.phase === "night", "night");

  const actionsTaken = [];
  const seenSteps = new Set();
  const turnChecks = new Set();

  // Drive every night step: whoever holds a turn acts on it.
  while (seats.every((seat) => seat.state.phase === "night")) {
    for (const seat of seats) {
      const s = seat.state;
      if (s.phase !== "night") continue;
      const turn = s.private?.turn;
      const stepId = `${s.night?.step}:${seat.name}`;
      if (!turn || turn.resolved || seenSteps.has(stepId)) continue;
      seenSteps.add(stepId);

      const group = turn.groups[0];
      if (!group) continue;

      const others = s.players.filter((p) => p.id !== s.youId).map((p) => p.id);
      const slots =
        group.source === "players"
          ? others.slice(0, group.count).map((playerId) => ({ kind: "player", playerId }))
          : [0, 1, 2].slice(0, group.count).map((index) => ({ kind: "center", index }));

      seat.client.sendAs(seat.playerId, { t: "night_action", groupId: group.id, slots });
      actionsTaken.push(`${seat.name} (${turn.role}) -> ${group.id}`);
    }

    // Only the players being called may hold a turn, and only for the role
    // currently being narrated. Checked once per step, not once per poll.
    for (const seat of seats) {
      if (seat.state.phase !== "night") continue;
      const turn = seat.state.private?.turn;
      if (!turn) continue;
      const role = seat.state.night?.role;
      const label = `step ${seat.state.night?.step}: ${seat.name} holds the ${role} turn`;
      if (!turnChecks.has(label)) {
        turnChecks.add(label);
        check(turn.role === role, label);
      }
    }
    await sleep(120);
  }

  console.log("  actions:", actionsTaken);
  check(actionsTaken.length > 0, "at least one night action was performed");

  console.log("\n== Day ==");
  await waitAll(seats, (s) => s.phase === "day", "day");
  for (const seat of seats) {
    check(seat.state.private === undefined, `${seat.name} has no private data during the day`);
  }

  host.sendAs(alice, { t: "end_discussion" });

  console.log("\n== Vote ==");
  await waitAll(seats, (s) => s.phase === "vote", "vote");

  // Everyone points at Alice except Alice, who points at Bob.
  const idOf = (name) => host.state.players.find((p) => p.nickname === name).id;
  for (const seat of seats) {
    const targetId = seat.name === "Alice" ? idOf("Bob") : idOf("Alice");
    seat.client.sendAs(seat.playerId, { t: "cast_vote", targetId });
  }

  console.log("\n== Reveal ==");
  await waitAll(seats, (s) => s.phase === "reveal", "reveal");
  const result = host.state.result;
  check(result.tally[idOf("Alice")] === 4, "Alice collected four votes");
  check(result.eliminated.length === 1 && result.eliminated[0] === idOf("Alice"), "Alice is eliminated");
  check(["village", "werewolf", "nobody"].includes(result.outcome), `outcome decided (${result.outcome})`);
  check(Object.keys(result.finalRoles).length === 5, "final roles revealed for everyone");
  check(result.centerRoles.length === 3, "three center cards revealed");
  check(
    host.stateOf(zoe).result !== undefined,
    "the companion seat gets the reveal too",
  );

  // The reveal must agree with the deal for anyone whose card never moved.
  for (const seat of seats) {
    check(result.dealtRoles[seat.playerId] === dealt.get(seat.name), `${seat.name} dealt card matches the reveal`);
  }
  const allCards = [...Object.values(result.finalRoles), ...result.centerRoles].sort();
  check(
    JSON.stringify(allCards) === JSON.stringify([...host.state.deck].sort()),
    "every card is still accounted for after the night",
  );

  console.log("\n== Narration ==");
  check(host.narrations.includes("phase.night"), "host was cued for the night");
  check(host.narrations.some((k) => k.startsWith("wake.")), "host was cued to wake a role");
  check(guests[0].narrations.length === 0, "guests receive no narration cues");
  console.log("  cues:", host.narrations.join(", "));

  console.log("\n== Play again ==");
  host.sendAs(alice, { t: "play_again" });
  await waitAll(seats, (s) => s.phase === "lobby", "back to lobby");
  check(host.state.round === 1, "round counter advanced");
  check(host.state.players.length === 5, "table kept for the next round");
  check(host.state.settings.nightStepSeconds === 5, "settings survive a restart");

  console.log("\n== Reconnect ==");
  // A shared phone must come back as a shared phone: one `hello`, both seats.
  const reconnect = new Client("Alice-again");
  await reconnect.connect();
  reconnect.send({ t: "hello", protocol: PROTOCOL, code, seats: host.seats });
  await reconnect.until((s) => s.phase === "lobby", "resumed seat");
  check(reconnect.seats.length === 2, "both seats came back on one socket");
  check(reconnect.stateOf(alice)?.youId === alice, "reconnected into the same seat");
  check(reconnect.stateOf(zoe)?.youId === zoe, "the companion came back with it");
  reconnect.close();

  for (const c of clients) c.close();

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nE2E ERROR:", error.message);
  process.exit(1);
});
