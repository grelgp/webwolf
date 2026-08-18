/**
 * End-to-end smoke test: drives a real 5-player round over WebSockets against
 * a running server, and asserts the redaction invariants along the way.
 */

import WebSocket from "ws";

const URL = process.env.WS_URL ?? "ws://127.0.0.1:3100/ws";
const PROTOCOL = 1;

let failures = 0;
function check(condition, label) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
}

class Client {
  constructor(name) {
    this.name = name;
    this.state = null;
    this.narrations = [];
    this.errors = [];
    this.log = [];
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
          this.state = msg.state;
          this.log.push(msg.state);
        } else if (msg.t === "welcome") {
          this.playerId = msg.playerId;
          this.token = msg.token;
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

  /** Waits until `predicate(state)` holds, or throws after `timeout` ms. */
  until(predicate, label, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        if (this.state && predicate(this.state)) return resolve(this.state);
        if (Date.now() - started > timeout) {
          return reject(new Error(`${this.name}: timed out waiting for ${label} (phase=${this.state?.phase})`));
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

async function main() {
  const names = ["Alice", "Bob", "Chloe", "David", "Emma"];
  const clients = names.map((n) => new Client(n));
  for (const c of clients) await c.connect();

  const [host, ...guests] = clients;

  console.log("\n== Lobby ==");
  host.send({ t: "create_room", nickname: host.name });
  await host.until((s) => s.phase === "lobby", "room created");
  const code = host.code;
  check(/^[A-Z]{4}$/.test(code), `room code is 4 letters (${code})`);

  for (const g of guests) {
    g.send({ t: "join_room", code, nickname: g.name });
    await g.until((s) => s.phase === "lobby", `${g.name} joined`);
  }
  await host.until((s) => s.players.length === 5, "all five seated");

  check(host.state.isHost, "creator is host");
  check(!guests[0].state.isHost, "guest is not host");
  check(host.state.deck.length === 8, `default deck auto-fits table (${host.state.deck.length} cards)`);

  // Shorten every timer so the round completes in seconds.
  host.send({
    t: "set_settings",
    settings: { roleRevealSeconds: 5, nightStepSeconds: 5, discussionSeconds: 60, voteSeconds: 15 },
  });
  await host.until((s) => s.settings.nightStepSeconds === 5, "settings applied");

  // A guest must not be able to change the deck.
  guests[0].send({ t: "set_deck", deck: { werewolf: 2, villager: 6 } });
  await sleep(150);
  check(guests[0].errors.some((e) => e.code === "not_host"), "non-host is refused deck changes");

  console.log("\n== Role reveal ==");
  host.send({ t: "start_game" });
  for (const c of clients) await c.until((s) => s.phase === "role_reveal", "reveal");

  const dealt = new Map();
  for (const c of clients) {
    const role = c.state.private?.dealtRole;
    dealt.set(c.name, role);
    check(typeof role === "string", `${c.name} sees own card (${role})`);
  }
  // The private payload must hold the player's own card and nothing else -
  // no turn data, no result, no other seat's card.
  for (const c of clients) {
    check(
      Object.keys(c.state.private).length === 1 && c.state.private.dealtRole !== undefined,
      `${c.name} private payload holds only their own card`,
    );
    check(c.state.result === undefined, `${c.name} sees no result yet`);
    check(
      c.state.players.every((p) => p.role === undefined && p.dealtRole === undefined),
      `${c.name} public player list carries no cards`,
    );
  }
  console.log("  deal:", Object.fromEntries(dealt));

  for (const c of clients) c.send({ t: "ready" });

  console.log("\n== Night ==");
  for (const c of clients) await c.until((s) => s.phase === "night", "night");

  const actionsTaken = [];
  const seenSteps = new Set();
  const turnChecks = new Set();

  // Drive every night step: whoever holds a turn acts on it.
  while (clients.every((c) => c.state.phase === "night")) {
    for (const c of clients) {
      const s = c.state;
      if (s.phase !== "night") continue;
      const turn = s.private?.turn;
      const stepId = `${s.night?.step}:${c.name}`;
      if (!turn || turn.resolved || seenSteps.has(stepId)) continue;
      seenSteps.add(stepId);

      const group = turn.groups[0];
      if (!group) continue;

      const others = s.players.filter((p) => p.id !== s.youId).map((p) => p.id);
      const slots =
        group.source === "players"
          ? others.slice(0, group.count).map((playerId) => ({ kind: "player", playerId }))
          : [0, 1, 2].slice(0, group.count).map((index) => ({ kind: "center", index }));

      c.send({ t: "night_action", groupId: group.id, slots });
      actionsTaken.push(`${c.name} (${turn.role}) -> ${group.id}`);
    }

    // Only the players being called may hold a turn, and only for the role
    // currently being narrated. Checked once per step, not once per poll.
    for (const c of clients) {
      if (c.state.phase !== "night") continue;
      const turn = c.state.private?.turn;
      if (!turn) continue;
      const role = c.state.night?.role;
      const label = `step ${c.state.night?.step}: ${c.name} holds the ${role} turn`;
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
  for (const c of clients) await c.until((s) => s.phase === "day", "day");
  for (const c of clients) {
    check(c.state.private === undefined, `${c.name} has no private data during the day`);
  }

  host.send({ t: "end_discussion" });

  console.log("\n== Vote ==");
  for (const c of clients) await c.until((s) => s.phase === "vote", "vote");

  // Everyone points at Alice except Alice, who points at Bob.
  const idOf = (name) => host.state.players.find((p) => p.nickname === name).id;
  for (const c of clients) {
    c.send({ t: "cast_vote", targetId: c.name === "Alice" ? idOf("Bob") : idOf("Alice") });
  }

  console.log("\n== Reveal ==");
  for (const c of clients) await c.until((s) => s.phase === "reveal", "reveal");
  const result = host.state.result;
  check(result.tally[idOf("Alice")] === 4, "Alice collected four votes");
  check(result.eliminated.length === 1 && result.eliminated[0] === idOf("Alice"), "Alice is eliminated");
  check(["village", "werewolf", "nobody"].includes(result.outcome), `outcome decided (${result.outcome})`);
  check(Object.keys(result.finalRoles).length === 5, "final roles revealed for everyone");
  check(result.centerRoles.length === 3, "three center cards revealed");

  // The reveal must agree with the deal for anyone whose card never moved.
  for (const c of clients) {
    const before = dealt.get(c.name);
    check(result.dealtRoles[c.playerId] === before, `${c.name} dealt card matches the reveal`);
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
  host.send({ t: "play_again" });
  for (const c of clients) await c.until((s) => s.phase === "lobby", "back to lobby");
  check(host.state.round === 1, "round counter advanced");
  check(host.state.players.length === 5, "table kept for the next round");
  check(host.state.settings.nightStepSeconds === 5, "settings survive a restart");

  console.log("\n== Reconnect ==");
  const reconnect = new Client("Bob-again");
  await reconnect.connect();
  const bob = guests[0];
  reconnect.send({ t: "hello", protocol: PROTOCOL, code, playerId: bob.playerId, token: bob.token });
  await reconnect.until((s) => s.phase === "lobby", "resumed seat");
  check(reconnect.state.youId === bob.playerId, "reconnected into the same seat");
  reconnect.close();

  for (const c of clients) c.close();

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nE2E ERROR:", error.message);
  process.exit(1);
});
