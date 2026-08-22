# Implemented rules

WebWolf follows the printed rules of *One Night Ultimate Werewolf*. This document records
exactly what is implemented, including the clauses that regularly cause arguments at a real
table, and the three places where this build deliberately differs.

---

## Setup

The deck always holds **`players + 3`** cards. One goes to each player; the remaining three sit
face down "in the middle". Those three are the reason your own card is not to be trusted: any
role you see in the game might be sitting in the center instead of in front of a player.

Cards available in this build, in the quantities the physical box contains:

| Card | Copies |
| --- | --- |
| Werewolf | 2 |
| Minion | 1 |
| Mason | 2 |
| Seer | 1 |
| Robber | 1 |
| Troublemaker | 1 |
| Drunk | 1 |
| Insomniac | 1 |
| Hunter | 1 |
| Villager | 3 |
| Tanner | 1 |

Fifteen cards — the whole base box — so this build seats **3 to 10 players**, spread over as
few as five phones, since a device can seat two of them. That ceiling is derived, not
hard-coded — registering more roles raises it automatically
(see [adding-a-role.md](adding-a-role.md)).

A new room opens on a suggested deck, and from then on the deck is the host's: they tune it
card by card, and nothing else ever rewrites it. Players joining or leaving change how many
cards the deck *needs*, so the lobby may show it as the wrong size until the host adjusts —
that warning is deliberate, because silently rebuilding the deck would throw away a
hand-tuned list every time somebody's phone dropped. The initial suggestion adds the Masons
two at a time: a deck holding a single Mason is legal, and
its holder would simply always find their partner in the center.

The deck is **public**. Everyone sees the composition in the lobby, exactly as everyone can see
which cards were put in the box at a real table. Knowing there is exactly one Robber in play is
half of the deduction.

---

## The night

The narrator calls roles in a fixed order. **Every role in the deck is called**, even one that
was dealt to the center and belongs to nobody: the pause happens anyway, so silence never
reveals what is in the middle.

| Order | Role | Action |
| --- | --- | --- |
| 1 | **Werewolf** | All werewolves recognise each other. A werewolf who is *alone* may instead look at one center card. |
| 2 | **Minion** | Is shown the werewolves. They are never shown the Minion. |
| 3 | **Mason** | The two Masons recognise each other. A lone Mason learns the other card is in the center. |
| 4 | **Seer** | May look at **one** other player's card, **or** at **two** of the three center cards. |
| 5 | **Robber** | May swap their card with another player's, then look at their new card. |
| 6 | **Troublemaker** | May swap two *other* players' cards, without looking at either. |
| 7 | **Drunk** | Takes a center card in exchange for their own, without looking at either. |
| 8 | **Insomniac** | Looks at their own card — the last thing that happens all night. |
| — | **Villager**, **Hunter**, **Tanner** | Never wake. |

Every action is **optional**; the app offers a *Passer* button. Roles with nothing to choose —
a pack of werewolves, the Masons, the Minion, the Insomniac — are shown what they came for and
resolve on their own.

**The Insomniac wakes last on purpose.** They see the card in front of them *after* every swap
of the night, so being robbed, troublemade or drunk-swapped is exactly what makes the role
worth playing. The app reveals it the instant their step opens.

### The two rules people get wrong

**You act as the card you were dealt, not the card you now hold.** If the Robber takes your
Seer card at 03:00, you were still the Seer when your turn came — and you never find out you
were robbed. What team you are on at dawn is decided by the card in front of you at the end.

**Order matters, and the app enforces it.** The Seer wakes before the Robber, so a Seer who
looks at a player sees that player's card *before* the theft. The Troublemaker wakes last, so
they can move a card the Robber only just stole. Nobody at the table has to reconstruct this:
each step mutates the table in real time.

### What each player sees, and when

The Seer's card, the Robber's new card, the Insomniac's own card and the werewolves' mutual
recognition all appear the instant they are earned, and vanish the instant that role's step
ends. Nothing is shown before or after. See [architecture.md](architecture.md) for how that is
enforced.

---

## The day

Discussion, on a timer the host sets in the lobby (5 minutes by default; the host can also end
it early).

**Your card is not shown during the day.** This is deliberate and matches the physical game,
where your card lies face down and you may not look at it again. A Robber who did not pay
attention during their turn really is left guessing — which is most of the fun.

---

## The vote

Everyone points at one player. You may not point at yourself. Votes stay changeable until the
last player has locked one in, at which point the round resolves immediately; if the timer
expires first, the votes cast so far are counted.

The app shows *how many* players have voted, never *for whom* — so nobody can follow a
majority that is already forming.

**The player with the most votes dies. On a tie, everyone tied dies.**

**Special case: if every player receives exactly one vote, nobody dies.** This is the printed
rule, and it is the only way a table with no werewolf in it can survive.

**Then the Hunter fires.** If a player holding the Hunter card at dawn is among the dead, the
player *they* voted for dies too — even with no votes against them. The reveal screen marks
that player *Abattu* rather than *Éliminé*, so the table can see why they fell. A Hunter who
survives the vote shoots nobody, and the shot never lands on someone already dead.

---

## Winning

Judged on the cards players hold **at the end of the night**, not the ones they were dealt, and
on the full list of the dead — the Hunter's victim included.

| Situation | Result |
| --- | --- |
| At least one player is a werewolf, and a werewolf dies | **Village wins** |
| At least one player is a werewolf, and none dies | **Werewolves win** |
| No player is a werewolf, and nobody dies | **Village wins** |
| No player is a werewolf, and somebody dies | **Nobody wins** |
| The Tanner dies, and no werewolf with them | **Tanner wins, alone** |
| The Tanner dies, and a werewolf too | **Tanner and village win** |

That fourth row is the one worth reading twice. If all the werewolf cards ended up in the
center, the village only wins by collectively refusing to lynch anyone. Kill an innocent and
the round is simply lost, with no winner at all.

Two cards bend that table, and both are easy to get wrong at a real table:

**The Tanner beats everyone by losing.** They are a team of one and only win by being lynched.
A dead Tanner therefore takes the win away from the werewolves outright — the village shares
it only if a wolf went down in the same vote.

**The Minion plays for the wolves without being one.** Killing the Minion does not save the
village, and a table whose only wolf-team card is the Minion counts as having no werewolf in
it: there, the Minion wins as long as anyone other than themselves is killed, and the village
wins if the table lynches the Minion or nobody at all.

---

## Where this build differs from the cardboard

Three deliberate departures:

1. **A deck must contain at least one Werewolf card.** A wolf-free deck is legal on paper, but
   it produces a round that can only be won by unanimously sparing everyone — a baffling first
   experience, and very easy to create by accident while adjusting counters.
2. **You cannot vote for yourself.** The printed rules assume you point at someone else; the
   app makes it structural. It also means the Tanner has to talk their way into the noose.
3. **Every night action is optional, including the Drunk's.** On cardboard the Drunk *must*
   exchange their card. Here every step offers a *Passer* button and ends on a timer, so a
   Drunk who does nothing keeps their card. Making that one action compulsory would mean the
   server swapping a card on a player's behalf when their step runs out — a mechanism no other
   role needs.

Everything else follows the printed rules.

---

## What is not implemented yet

Every card in the base box is in this build except the **Doppelgänger**, which copies another
player's role and then acts as it — the one card that needs a role to run *inside* another
role's step rather than in its own. Wake order 5 is left free for it. The role registry is
built so it stays a local addition rather than a rewrite — see
[adding-a-role.md](adding-a-role.md).
