/**
 * Translates WebSocket frames into room commands, and room changes back into
 * frames.
 *
 * All the game rules live in `Room`; this class only does plumbing:
 * validation of untrusted input, binding a socket to a seat, broadcasting
 * redacted snapshots, and keeping dead sockets from accumulating.
 *
 * Reconnection model
 * ------------------
 * A seat is identified by `{ playerId, token }`, which the browser keeps in
 * localStorage. A refresh, a dropped tunnel or a locked phone all resolve the
 * same way: the new socket sends `hello` with those credentials and takes the
 * seat back, mid-round if necessary. Sockets are disposable; seats are not.
 */

import type { RawData, WebSocket } from "ws";

import { PROTOCOL_VERSION } from "../../shared/constants.js";
import type {
  ClientMessage,
  ErrorCode,
  PlayerId,
  ServerMessage,
} from "../../shared/protocol.js";
import { config } from "../config.js";
import { createLogger } from "../util/logger.js";
import { RoomManager, normalizeCode } from "../room/RoomManager.js";
import type { CommandError, Room } from "../room/Room.js";
import { buildClientState } from "./views.js";

const log = createLogger("hub");

interface Session {
  socket: WebSocket;
  /** Cleared on every pong; a session that misses two beats is terminated. */
  alive: boolean;
  roomCode: string | null;
  playerId: PlayerId | null;
}

function seatKey(code: string, playerId: PlayerId): string {
  return `${code}:${playerId}`;
}

export class ConnectionHub {
  readonly rooms: RoomManager;

  private readonly sessions = new Map<WebSocket, Session>();
  /** Seat -> live socket, so a second tab can take over cleanly. */
  private readonly seats = new Map<string, Session>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor() {
    this.rooms = new RoomManager({
      onChange: (room) => this.broadcast(room),
      onNarrate: (room, key, params) => this.narrate(room, key, params),
    });
  }

  start(): void {
    this.rooms.startMaintenance();
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => this.pingAll(), config.heartbeatMs);
    this.heartbeat.unref?.();
  }

  stop(): void {
    this.rooms.stopMaintenance();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  /* ---------------------------------------------------------------------- */
  /* Socket lifecycle                                                       */
  /* ---------------------------------------------------------------------- */

  handleConnection(socket: WebSocket): void {
    const session: Session = { socket, alive: true, roomCode: null, playerId: null };
    this.sessions.set(socket, session);

    socket.on("pong", () => {
      session.alive = true;
    });
    socket.on("message", (data) => this.handleMessage(session, data));
    socket.on("close", () => this.handleClose(session));
    socket.on("error", (error) => {
      log.debug("socket error", error);
      socket.terminate();
    });
  }

  private handleClose(session: Session): void {
    this.sessions.delete(session.socket);

    const { roomCode, playerId } = session;
    if (!roomCode || !playerId) return;

    const key = seatKey(roomCode, playerId);
    // Only clear the seat if this socket still owns it. A reconnect that has
    // already taken over must not be unseated by the old socket's close event.
    if (this.seats.get(key) !== session) return;
    this.seats.delete(key);

    const room = this.rooms.get(roomCode);
    const player = room?.getPlayer(playerId);
    if (room && player) room.setConnected(player, false);
  }

  private pingAll(): void {
    for (const session of this.sessions.values()) {
      if (!session.alive) {
        session.socket.terminate();
        continue;
      }
      session.alive = false;
      try {
        session.socket.ping();
      } catch {
        session.socket.terminate();
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Message routing                                                        */
  /* ---------------------------------------------------------------------- */

  private handleMessage(session: Session, data: RawData): void {
    const raw = data.toString();
    if (raw.length > config.maxFrameBytes) {
      this.sendError(session, "bad_request", "Frame too large.");
      return;
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.sendError(session, "bad_request", "Malformed JSON.");
      return;
    }
    if (typeof message !== "object" || message === null || typeof message.t !== "string") {
      this.sendError(session, "bad_request", "Missing message type.");
      return;
    }

    try {
      this.dispatch(session, message);
    } catch (error) {
      log.error(`while handling ${message.t}`, error);
      this.sendError(session, "internal", "Something went wrong on the server.");
    }
  }

  private dispatch(session: Session, message: ClientMessage): void {
    switch (message.t) {
      case "ping":
        this.send(session, { t: "pong" });
        return;

      case "hello":
        this.handleHello(session, message);
        return;

      case "create_room":
        this.handleCreateRoom(session, message.nickname);
        return;

      case "join_room":
        this.handleJoinRoom(session, message.code, message.nickname);
        return;

      case "leave_room":
        this.handleLeave(session);
        return;

      default:
        this.handleSeatedCommand(session, message);
    }
  }

  private handleHello(
    session: Session,
    message: Extract<ClientMessage, { t: "hello" }>,
  ): void {
    if (message.protocol !== PROTOCOL_VERSION) {
      this.sendError(
        session,
        "bad_protocol",
        "This page is out of date. Reload to get the current version.",
      );
      return;
    }

    // No credentials: a fresh visitor. Nothing to restore, the client shows
    // its home screen.
    if (!message.code || !message.playerId || !message.token) return;

    const room = this.rooms.get(message.code);
    const player = room?.resume(message.playerId, message.token);
    if (!room || !player) {
      // Stale credentials - the room expired or was reaped. Tell the client so
      // it can clear storage instead of retrying forever.
      this.send(session, { t: "goodbye", reason: "room_not_found" });
      return;
    }

    this.bind(session, room, player.id);
    this.send(session, { t: "welcome", playerId: player.id, token: player.token, code: room.code });
    // Always broadcast explicitly here: if the server had not yet noticed the
    // old socket was dead, `resume` sees the seat as already connected and
    // emits no change of its own, leaving the new tab with a blank screen.
    this.broadcast(room);
  }

  private handleCreateRoom(session: Session, nickname: string): void {
    const room = this.rooms.create();
    const result = room.join(nickname);
    if ("error" in result) {
      this.rooms.destroy(room.code);
      this.sendCommandError(session, result.error);
      return;
    }

    this.bind(session, room, result.player.id);
    this.send(session, {
      t: "welcome",
      playerId: result.player.id,
      token: result.player.token,
      code: room.code,
    });
    room.setConnected(result.player, true);
    this.broadcast(room);
  }

  private handleJoinRoom(session: Session, code: string, nickname: string): void {
    const room = this.rooms.get(normalizeCode(code));
    if (!room) {
      this.sendError(session, "room_not_found", "No room with that code.");
      return;
    }

    const result = room.join(nickname);
    if ("error" in result) {
      this.sendCommandError(session, result.error);
      return;
    }

    this.bind(session, room, result.player.id);
    this.send(session, {
      t: "welcome",
      playerId: result.player.id,
      token: result.player.token,
      code: room.code,
    });
    room.setConnected(result.player, true);
    this.broadcast(room);
  }

  private handleLeave(session: Session): void {
    const bound = this.resolve(session);
    this.unbind(session);
    this.send(session, { t: "goodbye", reason: "left" });
    if (!bound) return;

    const { room, playerId } = bound;
    const player = room.getPlayer(playerId);
    if (!player) return;

    if (room.inGame) {
      // Mid-round a seat cannot vanish: its card is part of everyone else's
      // deduction. The player simply shows as disconnected and may come back.
      room.setConnected(player, false);
    } else {
      room.removePlayer(playerId);
      if (room.playerCount === 0) this.rooms.destroy(room.code);
    }
  }

  /** Every command that requires an occupied seat. */
  private handleSeatedCommand(session: Session, message: ClientMessage): void {
    const bound = this.resolve(session);
    if (!bound) {
      this.sendError(session, "not_in_room", "You are not in a room.");
      return;
    }
    const { room, playerId } = bound;

    let error: CommandError = null;
    switch (message.t) {
      case "set_nickname":
        error = room.setNickname(playerId, message.nickname);
        break;
      case "set_deck":
        error = room.setDeck(playerId, message.deck ?? {});
        break;
      case "set_settings":
        error = room.setSettings(playerId, message.settings ?? {});
        break;
      case "kick_player":
        error = this.handleKick(room, playerId, message.playerId);
        break;
      case "start_game":
        error = room.startGame(playerId);
        break;
      case "ready":
        error = room.markReady(playerId);
        break;
      case "night_action":
        error = room.performNightAction(playerId, message.groupId, message.slots);
        break;
      case "night_skip":
        error = room.skipNightAction(playerId);
        break;
      case "end_discussion":
        error = room.endDiscussion(playerId);
        break;
      case "cast_vote":
        error = room.castVote(playerId, message.targetId);
        break;
      case "play_again":
        error = room.playAgain(playerId);
        break;
      default:
        error = { code: "bad_request", message: `Unsupported message: ${String(message.t)}` };
    }

    if (error) this.sendCommandError(session, error);
  }

  private handleKick(room: Room, actorId: PlayerId, targetId: PlayerId): CommandError {
    if (!room.isHost(actorId)) return { code: "not_host", message: "Only the host can remove players." };
    if (room.inGame) return { code: "game_in_progress", message: "The round has already started." };
    if (actorId === targetId) return { code: "bad_request", message: "You cannot remove yourself." };
    if (!room.getPlayer(targetId)) return { code: "bad_request", message: "Unknown player." };

    const victim = this.seats.get(seatKey(room.code, targetId));
    room.removePlayer(targetId);
    if (victim) {
      this.send(victim, { t: "goodbye", reason: "kicked" });
      this.unbind(victim);
    }
    return null;
  }

  /* ---------------------------------------------------------------------- */
  /* Session binding                                                        */
  /* ---------------------------------------------------------------------- */

  private bind(session: Session, room: Room, playerId: PlayerId): void {
    this.unbind(session);

    const key = seatKey(room.code, playerId);
    const previous = this.seats.get(key);
    if (previous && previous !== session) {
      // The seat was open in another tab. The newest device wins, and the old
      // one is told why it went quiet.
      this.send(previous, { t: "goodbye", reason: "kicked" });
      previous.roomCode = null;
      previous.playerId = null;
      previous.socket.close();
    }

    session.roomCode = room.code;
    session.playerId = playerId;
    this.seats.set(key, session);
  }

  private unbind(session: Session): void {
    const { roomCode, playerId } = session;
    if (roomCode && playerId) {
      const key = seatKey(roomCode, playerId);
      if (this.seats.get(key) === session) this.seats.delete(key);
    }
    session.roomCode = null;
    session.playerId = null;
  }

  private resolve(session: Session): { room: Room; playerId: PlayerId } | null {
    if (!session.roomCode || !session.playerId) return null;
    const room = this.rooms.get(session.roomCode);
    if (!room || !room.getPlayer(session.playerId)) return null;
    return { room, playerId: session.playerId };
  }

  /* ---------------------------------------------------------------------- */
  /* Outbound                                                               */
  /* ---------------------------------------------------------------------- */

  /** Sends every connected player of `room` their own redacted snapshot. */
  private broadcast(room: Room): void {
    for (const player of room.players) {
      const session = this.seats.get(seatKey(room.code, player.id));
      if (!session) continue;
      this.send(session, { t: "state", state: buildClientState(room, player.id) });
    }
  }

  /**
   * Narration goes to the host device only: it is the single narrator phone,
   * mirroring the one-app-in-the-middle setup of the physical game.
   */
  private narrate(room: Room, key: string, params?: Record<string, string | number>): void {
    const hostId = room.hostId;
    if (!hostId) return;
    const session = this.seats.get(seatKey(room.code, hostId));
    if (!session) return;
    this.send(session, params ? { t: "narrate", key, params } : { t: "narrate", key });
  }

  private send(session: Session, message: ServerMessage): void {
    if (session.socket.readyState !== session.socket.OPEN) return;
    try {
      session.socket.send(JSON.stringify(message));
    } catch (error) {
      log.debug("send failed", error);
    }
  }

  private sendError(session: Session, code: ErrorCode, message: string): void {
    this.send(session, { t: "error", code, message });
  }

  private sendCommandError(session: Session, error: CommandError): void {
    if (!error) return;
    this.sendError(session, error.code, error.message);
  }
}
