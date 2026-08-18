# Implemented rules

WebWolf follows the printed rules of *One Night Ultimate Werewolf*. This document records
exactly what is implemented, including the clauses that regularly cause arguments at a real
table, and the two places where this build deliberately differs.

---

## Setup

The deck always holds **`players + 3`** cards. One goes to each player; the remaining three sit
face down "in the middle". Those three are the reason your own card is not to be trusted: any
role you see in the game might be sitting in the center instead of in front of a player.

Cards available in this build, in the quantities the physical box contains:

| Card | Copies |
| --- | --- |
| Werewolf | 2 |
| Seer | 1 |
| Robber | 1 |
| Troublemaker | 1 |
| Villager | 3 |

Eight cards total, so this build seats **3 to 5 players**. That ceiling is derived, not
hard-coded — registering more roles raises it automatically
(see [adding-a-role.md](adding-a-role.md)).

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
| 2 | **Seer** | May look at **one** other player's card, **or** at **two** of the three center cards. |
| 3 | **Robber** | May swap their card with another player's, then look at their new card. |
| 4 | **Troublemaker** | May swap two *other* players' cards, without looking at either. |
| — | **Villager** | Never wakes. |

Every action is **optional**; the app offers a *Passer* button.

### The two rules people get wrong

**You act as the card you were dealt, not the card you now hold.** If the Robber takes your
Seer card at 03:00, you were still the Seer when your turn came — and you never find out you
were robbed. What team you are on at dawn is decided by the card in front of you at the end.

**Order matters, and the app enforces it.** The Seer wakes before the Robber, so a Seer who
looks at a player sees that player's card *before* the theft. The Troublemaker wakes last, so
they can move a card the Robber only just stole. Nobody at the table has to reconstruct this:
each step mutates the table in real time.

### What each player sees, and when

The Seer's card, the Robber's new card and the werewolves' mutual recognition all appear the
instant the action is taken, and vanish the instant that role's step ends. Nothing is shown
before or after. See [architecture.md](architecture.md) for how that is enforced.

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

---

## Winning

Judged on the cards players hold **at the end of the night**, not the ones they were dealt.

| Situation | Result |
| --- | --- |
| At least one player is a werewolf, and a werewolf dies | **Village wins** |
| At least one player is a werewolf, and none dies | **Werewolves win** |
| No player is a werewolf, and nobody dies | **Village wins** |
| No player is a werewolf, and somebody dies | **Nobody wins** |

That last row is the one worth reading twice. If all the werewolf cards ended up in the center,
the village only wins by collectively refusing to lynch anyone. Kill an innocent and the round
is simply lost, with no winner at all.

---

## Where this build differs from the cardboard

Two deliberate departures, both to stop a lobby from producing a confusing round:

1. **A deck must contain at least one Werewolf card.** A wolf-free deck is legal on paper, but
   it produces a round that can only be won by unanimously sparing everyone — a baffling first
   experience, and very easy to create by accident while adjusting counters.
2. **You cannot vote for yourself.** The printed rules assume you point at someone else; the
   app makes it structural.

Everything else follows the printed rules.

---

## What is not implemented yet

The base box also contains the Doppelgänger, Minion, Masons, Drunk, Insomniac, Tanner and
Hunter. None of them are in this build. The role registry is built so each is a small, local
addition rather than a rewrite — see [adding-a-role.md](adding-a-role.md).
