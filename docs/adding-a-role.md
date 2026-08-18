# Adding a role

Adding a role touches **three files**, and usually no UI code at all. This guide walks through
two real examples from the base box: one that needs no new machinery, and one that does.

```
src/shared/roles.ts              declare it: team, copies, wake order, what may be clicked
src/server/game/roleHandlers.ts  implement what happens when it acts
src/client/i18n/fr.ts            name it, describe it, and write its narration
```

The player cap rises on its own: it is derived from the total number of cards registered
(`maxSupportedPlayers()`), because the deck is always `players + 3`.

---

## Example 1 — the Drunk

*"Exchange your card with a center card, without looking at either."*

### 1. Declare it

In `src/shared/roles.ts`, add an entry to `ROLES`:

```ts
drunk: {
  id: "drunk",
  team: "village",
  maxCopies: 1,
  // Wake orders are spaced by 10 so new roles slot in without renumbering.
  // Official order puts the Drunk after the Troublemaker (40).
  wakeOrder: 45,
  seesFellows: false,
  selection: () => [{ id: "swap", source: "center", count: 1, excludeSelf: false }],
},
```

Then add `"drunk"` to the `RoleId` union and to `ROLE_ORDER` (which is the lobby's row order).

### 2. Implement the effect

In `src/server/game/roleHandlers.ts`:

```ts
/**
 * Swaps their own card with a center card and looks at neither - the player
 * spends the day genuinely not knowing what they are.
 */
drunk: (context, _groupId, slots) => {
  const target = slots[0];
  if (!target) return;
  const self: CardSlot = { kind: "player", playerId: context.actorId };
  if (!swapSlots(context.night, self, target)) return;
  context.turn.swapped.push(self, target);
  // Note the absence of a `reveal()` call. That is the whole role.
},
```

### 3. Write the copy

In `src/client/i18n/fr.ts`, add entries to `ROLE_NAMES`, `ROLE_NAMES_PLURAL`,
`ROLE_TAGLINES`, `ROLE_NIGHT_PROMPTS`, `ROLE_EMOJI`, and the two narration keys:

```ts
"wake.drunk": () =>
  "Sacripant, réveille-toi. Échange ta carte avec une carte du centre, sans la regarder.",
"sleep.drunk": () => "Sacripant, ferme les yeux.",
```

TypeScript will point at every map you forgot: they are all `Record<RoleId, …>`.

### That is all

No client code changes. The night screen builds its grid from the `SelectionGroup`s you
declared, so the Drunk gets three tappable center cards, a *Passer* button, and a "swap done"
confirmation, for free.

---

## Example 2 — the Insomniac

*"At the end of the night, look at your own card."*

This one is interesting because it needs something the current primitives do not express: an
action with **no choice** that still **reveals** something.

### Declaration

```ts
insomniac: {
  id: "insomniac",
  team: "village",
  maxCopies: 1,
  wakeOrder: 50,          // last, by design
  seesFellows: false,
  selection: () => [],    // nothing to pick
},
```

An empty `selection` makes the turn `passive`, and the view builder marks it resolved
immediately.

### The gap, and how to close it

A passive turn currently reveals nothing, because handlers only run in response to a
submitted action. The Insomniac needs its effect to fire when the **step opens**.

Add an optional `onTurnStart` to the handler table and call it from `Room.runNightStep` for
each holder of the role being called:

```ts
// roleHandlers.ts
export const TURN_START_HANDLERS: Partial<Record<RoleId, (c: NightActionContext) => void>> = {
  insomniac: (context) => {
    reveal(context, { kind: "player", playerId: context.actorId });
  },
};
```

```ts
// Room.runNightStep, right after the narration cue
for (const holder of holdersOf(night, role, seatIds)) {
  const onStart = TURN_START_HANDLERS[role];
  if (!onStart) continue;
  const turn = getTurnState(night, holder);
  onStart({ night, actorId: holder, fellows: [], turn });
  turn.resolved = true;
}
```

The client already renders `turn.revealed` on the matching tile, so again there is no UI work.

---

## Checklist

- [ ] `RoleId` union extended
- [ ] Entry in `ROLES` with team, `maxCopies`, `wakeOrder`, `seesFellows`, `selection`
- [ ] Added to `ROLE_ORDER`
- [ ] Handler in `ROLE_HANDLERS` (or `TURN_START_HANDLERS` for a passive reveal)
- [ ] French name, plural, tagline, night prompt, emoji
- [ ] `wake.<id>` and `sleep.<id>` narration lines — **only if `wakeOrder` is not `null`**
- [ ] A case in `scripts/rules.test.mjs`
- [ ] `npm run typecheck && npm test`

---

## Things to get right

**Wake order is the rules.** The Seer reading a player before the Robber steals from them is
not a coincidence; it is what `wakeOrder` encodes. Check the official order before picking a
number, and leave gaps.

**A role in the deck is always called, even if nobody holds it.** That is handled for you by
`wakeOrderForDeck`, which derives the script from the deck rather than from the deal. Do not
"optimise" it to skip empty steps — the silence would tell the table what is in the center.

**Never reveal through the public snapshot.** Anything a role learns goes into `turn.revealed`
or `turn.fellows`, which `views.ts` sends only to the acting player and only during their step.
Adding a field to `PublicPlayer` sends it to the entire table.

**Effects belong on the server.** `src/shared/roles.ts` is bundled into the browser: it may
describe *what may be clicked*, never *what happens*. Anything touching `NightState` lives in
`src/server/game/`.

**Roles that see teammates** set `seesFellows: true` (the Masons, like the werewolves). Roles
that see *another* team's members — the Minion sees the wolves — need a small addition to
`Room.fellowsOf`, which currently matches on the viewer's own role.
