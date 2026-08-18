/**
 * Builds the snapshot each individual player is allowed to receive.
 *
 * This is the security boundary of the whole app. The premise of WebWolf is
 * that phones lie face up on the table, so "the client will hide it" is not a
 * defence: anything the browser receives is effectively public. Secrets are
 * therefore *omitted from the payload*, never merely flagged.
 *
 * The rules, phase by phase:
 *
 *   lobby        nothing private exists yet
 *   role_reveal  each player learns their own dealt card, and nothing else
 *   night        only the player whose dealt card is being called gets a turn
 *   day / vote   nothing - exactly like face-down cards you may not re-check
 *   reveal       everything, to everyone
 *
 * A device shared by two players gets one such snapshot per seat, built here
 * exactly as if the two were on separate phones. Nothing about sharing relaxes
 * the rules above; the client shows one seat at a time behind a hand-over
 * gate, and never holds a secret belonging to a seat it is not showing.
 *
 * Note what is absent from `day`: not even your own card. That is deliberate.
 * In the physical game you may not look at your card again after the night,
 * and half the tension comes from a Robber who is no longer sure what they
 * took. Re-showing it here would quietly change the game.
 */

import type {
  ClientState,
  NightTurnView,
  PlayerId,
  PrivateView,
  PublicPlayer,
} from "../../shared/protocol.js";
import { getRole } from "../../shared/roles.js";
import { currentRole, turnKey, type NightState, type TurnState } from "../game/nightState.js";
import type { Room } from "../room/Room.js";

/** Read-only lookup; unlike `getTurnState` it never creates an entry. */
function readTurnState(night: NightState, playerId: PlayerId): TurnState | undefined {
  return night.turns.get(turnKey(night.stepIndex, playerId));
}

/**
 * 1-based marker per player for every device holding more than one seat.
 *
 * Not a secret: who is sharing a phone is plain to see around the table. It
 * exists so the lobby can show the host how the devices are shared out, and
 * numbering starts from the first shared device in seat order, so it is stable
 * across snapshots.
 */
function deviceGroups(room: Room): Map<PlayerId, number> {
  const byDevice = new Map<string, PlayerId[]>();
  for (const player of room.players) {
    const seats = byDevice.get(player.deviceId);
    if (seats) seats.push(player.id);
    else byDevice.set(player.deviceId, [player.id]);
  }

  const groups = new Map<PlayerId, number>();
  let index = 0;
  for (const seats of byDevice.values()) {
    if (seats.length < 2) continue;
    index += 1;
    for (const id of seats) groups.set(id, index);
  }
  return groups;
}

function buildPlayers(room: Room): PublicPlayer[] {
  const groups = deviceGroups(room);

  return room.players.map((player) => {
    const view: PublicPlayer = {
      id: player.id,
      nickname: player.nickname,
      isHost: room.isHost(player.id),
      connected: player.connected,
    };

    const group = groups.get(player.id);
    if (group !== undefined) view.deviceGroup = group;

    // Progress indicators are scoped to the phase that needs them. During the
    // night we expose none: "who has already acted" would identify the holder
    // of the role currently being called.
    if (room.phase === "role_reveal") view.ready = player.ready;
    if (room.phase === "vote") view.hasVoted = room.votes.has(player.id);

    return view;
  });
}

/**
 * The acting player's view of their own turn, or `undefined` if this player is
 * not the one being called right now.
 */
function buildTurn(room: Room, viewerId: PlayerId): NightTurnView | undefined {
  const night = room.night;
  if (!night) return undefined;

  const role = currentRole(night);
  if (!role) return undefined;

  // Turns follow the card you were *dealt*, not the one you now hold. A player
  // robbed earlier tonight still wakes for their original role.
  if (night.dealt.get(viewerId) !== role) return undefined;

  const fellows = room.fellowsOf(viewerId);
  const groups = getRole(role).selection({ holderCount: fellows.length + 1 });
  const turn = readTurnState(night, viewerId);
  const passive = groups.length === 0;

  return {
    role,
    // Once the action is spent the grid closes, leaving only the result on
    // screen for the rest of the step.
    groups: turn?.resolved || passive ? [] : groups,
    fellows,
    revealed: turn?.revealed ?? [],
    swapped: turn?.swapped ?? [],
    resolved: passive || (turn?.resolved ?? false),
    passive,
  };
}

function buildPrivate(room: Room, viewerId: PlayerId): PrivateView | undefined {
  const night = room.night;

  switch (room.phase) {
    case "role_reveal": {
      const dealtRole = night?.dealt.get(viewerId);
      return dealtRole ? { dealtRole } : undefined;
    }

    case "night": {
      const turn = buildTurn(room, viewerId);
      return turn ? { turn } : undefined;
    }

    case "vote": {
      const vote = room.votes.get(viewerId);
      return vote ? { vote } : undefined;
    }

    default:
      return undefined;
  }
}

export function buildClientState(room: Room, viewerId: PlayerId): ClientState {
  const state: ClientState = {
    code: room.code,
    phase: room.phase,
    round: room.round,
    serverNow: Date.now(),
    youId: viewerId,
    isHost: room.isHost(viewerId),
    players: buildPlayers(room),
    settings: { ...room.settings },
    deck: room.deck.slice(),
  };

  if (room.deadline) {
    state.timer = { endsAt: room.deadline.endsAt, durationMs: room.deadline.durationMs };
  }

  if (room.phase === "night" && room.night) {
    const role = currentRole(room.night);
    if (role) {
      state.night = {
        step: room.night.stepIndex + 1,
        stepCount: room.night.script.length,
        role,
      };
    }
  }

  if (room.phase === "vote") {
    state.voteProgress = { voted: room.votes.size, total: room.players.length };
  }

  // The round is over; every card is turned face up for everyone at once.
  if (room.phase === "reveal" && room.result) {
    state.result = room.result;
  }

  const privateView = buildPrivate(room, viewerId);
  if (privateView) state.private = privateView;

  return state;
}
