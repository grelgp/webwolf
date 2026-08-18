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
 *
 * Shared devices
 * --------------
 * One socket may hold up to `MAX_SEATS_PER_DEVICE` seats, so two people can
 * play from one phone. Each seat keeps its own credentials, its own redacted
 * snapshot and its own commands - the session is simply a list of seats rather
 * than a single one, and every seated frame names the seat it acts for.
 */

import type { RawData, WebSocket } from "ws";

import { MAX_SEATS_PER_DEVICE, PROTOCOL_VERSION } from "../../shared/constants.js";
import type {
  ClientMessage,
  ErrorCode,
  PlayerId,
  SeatCredentials,
  ServerMessage,
} from "../../shared/protocol.js";
import { config } from "../config.js";
import { createLogger } from "../util/logger.js";
import { RoomManager, normalizeCode } from "../room/RoomManager.js";
import type { CommandError, Player, Room } from "../room/Room.js";
import { newToken } from "../util/random.js";
import { buildClientState } from "./views.js";

const log = createLogger("hub");

interface Session {
  socket: WebSocket;
  /** Cleared on every pong; a session that misses two beats is terminated. */
  alive: boolean;
  /**
   * Identifies the physical device across reconnects, so the room can tell
   * two players sharing a phone from two players on their own.
   */
  deviceId: string;
  roomCode: string | null;
  /** Seats this device holds, in the order they were taken. */
  playerIds: PlayerId[];
}

function seatKey(code: string, playerId: PlayerId): string {
  return `${code}:${playerId}`;
}

/**
 * Sifts the seat credentials out of an untrusted `hello`.
 *
 * A device may legitimately offer several, so the frame is a list; anything
 * malformed is dropped rather than rejected, which lets a client with one
 * stale entry still resume the seats it does have.
 */
function readSeatCredentials(raw: unknown): SeatCredentials[] {
  if (!Array.isArray(raw)) return [];
  const seats: SeatCredentials[] = [];
  for (const entry of raw.slice(0, MAX_SEATS_PER_DEVICE)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { playerId, token } = entry as Partial<SeatCredentials>;
    if (typeof playerId !== "string" || typeof token !== "string") continue;
    if (seats.some((seat) => seat.playerId === playerId)) continue;
    seats.push({ playerId, token });
  }
  return seats;
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
    const session: Session = {
      socket,
      alive: true,
      deviceId: newToken(),
      roomCode: null,
      playerIds: [],
    };
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

    const { roomCode } = session;
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);

    for (const playerId of session.playerIds) {
      const key = seatKey(roomCode, playerId);
      // Only clear a seat if this socket still owns it. A reconnect that has
      // already taken over must not be unseated by the old socket's close.
      if (this.seats.get(key) !== session) continue;
      this.seats.delete(key);

      const player = room?.getPlayer(playerId);
      if (room && player) room.setConnected(player, false);
    }
    session.playerIds = [];
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

      case "add_player":
        this.handleAddPlayer(session, message.nickname);
        return;

      case "leave_room":
        this.handleLeave(session, message.seat);
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
    const credentials = readSeatCredentials(message.seats);
    if (!message.code || credentials.length === 0) return;

    const room = this.rooms.get(message.code);
    const resumed = credentials
      .map((seat) => room?.resume(seat.playerId, seat.token))
      .filter((player): player is Player => Boolean(player));

    const [first] = resumed;
    if (!room || !first) {
      // Stale credentials - the room expired or was reaped. Tell the client so
      // it can clear storage instead of retrying forever.
      this.send(session, { t: "goodbye", reason: "room_not_found" });
      return;
    }

    // Adopt the seats' own device id rather than the one minted for this
    // socket, so a refresh keeps two shared seats recognised as one phone.
    session.deviceId = first.deviceId;
    session.roomCode = room.code;
    for (const player of resumed) this.claimSeat(session, room, player.id);

    this.sendWelcome(session, room);
    // Always broadcast explicitly here: if the server had not yet noticed the
    // old socket was dead, `resume` sees the seat as already connected and
    // emits no change of its own, leaving the new tab with a blank screen.
    this.broadcast(room);
  }

  private handleCreateRoom(session: Session, nickname: string): void {
    const room = this.rooms.create();
    const result = room.join(nickname, session.deviceId);
    if ("error" in result) {
      this.rooms.destroy(room.code);
      this.sendCommandError(session, result.error);
      return;
    }

    this.unbind(session);
    this.claimSeat(session, room, result.player.id);
    this.sendWelcome(session, room);
    room.setConnected(result.player, true);
    this.broadcast(room);
  }

  private handleJoinRoom(session: Session, code: string, nickname: string): void {
    const room = this.rooms.get(normalizeCode(code));
    if (!room) {
      this.sendError(session, "room_not_found", "No room with that code.");
      return;
    }

    const result = room.join(nickname, session.deviceId);
    if ("error" in result) {
      this.sendCommandError(session, result.error);
      return;
    }

    this.unbind(session);
    this.claimSeat(session, room, result.player.id);
    this.sendWelcome(session, room);
    room.setConnected(result.player, true);
    this.broadcast(room);
  }

  /**
   * Seats a second player on a device that already holds one.
   *
   * It is an ordinary `join`: the new seat is a full player with its own card,
   * turn and vote. All that is special is the device it sits on, which is what
   * makes the client hand the screen over rather than show both at once.
   */
  private handleAddPlayer(session: Session, nickname: string): void {
    const room = this.resolveRoom(session);
    if (!room) {
      this.sendError(session, "not_in_room", "You are not in a room.");
      return;
    }

    const result = room.join(nickname, session.deviceId);
    if ("error" in result) {
      this.sendCommandError(session, result.error);
      return;
    }

    this.claimSeat(session, room, result.player.id);
    this.sendWelcome(session, room);
    room.setConnected(result.player, true);
    this.broadcast(room);
  }

  /**
   * Releases one seat, or the whole device when `seat` is omitted.
   *
   * A device that still holds a seat afterwards stays in the room and gets a
   * fresh `welcome`; one that does not is told the socket is now unbound.
   */
  private handleLeave(session: Session, seat?: PlayerId): void {
    const room = this.resolveRoom(session);
    if (!room) {
      this.unbind(session);
      this.send(session, { t: "goodbye", reason: "left" });
      return;
    }

    if (seat !== undefined && !session.playerIds.includes(seat)) {
      this.sendError(session, "bad_request", "That seat is not on this device.");
      return;
    }
    const leaving = seat === undefined ? [...session.playerIds] : [seat];

    for (const playerId of leaving) {
      this.releaseSeat(session, room.code, playerId);
      const player = room.getPlayer(playerId);
      if (!player) continue;

      if (room.inGame) {
        // Mid-round a seat cannot vanish: its card is part of everyone else's
        // deduction. The player simply shows as disconnected and may come back.
        room.setConnected(player, false);
      } else {
        room.removePlayer(playerId);
      }
    }

    if (session.playerIds.length > 0) {
      this.send(session, { t: "goodbye", reason: "left", seat });
      this.sendWelcome(session, room);
    } else {
      session.roomCode = null;
      this.send(session, { t: "goodbye", reason: "left" });
    }

    if (room.playerCount === 0) this.rooms.destroy(room.code);
  }

  /** Every command that acts on behalf of one seat this device holds. */
  private handleSeatedCommand(session: Session, message: ClientMessage): void {
    if (!("seat" in message) || typeof message.seat !== "string") {
      this.sendError(session, "bad_request", "Missing seat.");
      return;
    }

    const bound = this.resolve(session, message.seat);
    if (!bound) {
      this.sendError(session, "not_in_room", "That seat is not on this device.");
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
    if (victim) this.evictSeat(victim, room, targetId, "kicked");
    return null;
  }

  /* ---------------------------------------------------------------------- */
  /* Session binding                                                        */
  /* ---------------------------------------------------------------------- */

  /**
   * Attaches one seat to this session, taking it from whichever device held it
   * before. The newest device always wins, and the old one is told *which*
   * seat it lost, so a shared phone carries on with the seat it kept.
   */
  private claimSeat(session: Session, room: Room, playerId: PlayerId): void {
    const key = seatKey(room.code, playerId);
    const previous = this.seats.get(key);
    if (previous && previous !== session) this.evictSeat(previous, room, playerId, "kicked");

    if (!session.playerIds.includes(playerId)) session.playerIds.push(playerId);
    session.roomCode = room.code;
    this.seats.set(key, session);
  }

  /**
   * Takes one seat away from a device and tells it why. A device left with no
   * seat at all is unbound; one that kept a seat just gets a shorter list.
   */
  private evictSeat(
    session: Session,
    room: Room,
    playerId: PlayerId,
    reason: ErrorCode,
  ): void {
    this.releaseSeat(session, room.code, playerId);
    if (session.playerIds.length > 0) {
      this.send(session, { t: "goodbye", reason, seat: playerId });
      this.sendWelcome(session, room);
      return;
    }
    session.roomCode = null;
    this.send(session, { t: "goodbye", reason });
  }

  /** Detaches one seat from a session without touching the room. */
  private releaseSeat(session: Session, code: string, playerId: PlayerId): void {
    const key = seatKey(code, playerId);
    if (this.seats.get(key) === session) this.seats.delete(key);
    session.playerIds = session.playerIds.filter((id) => id !== playerId);
  }

  private unbind(session: Session): void {
    if (session.roomCode) {
      for (const playerId of [...session.playerIds]) {
        this.releaseSeat(session, session.roomCode, playerId);
      }
    }
    session.playerIds = [];
    session.roomCode = null;
  }

  /** The room this device is in, or null when it holds no seat. */
  private resolveRoom(session: Session): Room | null {
    if (!session.roomCode || session.playerIds.length === 0) return null;
    return this.rooms.get(session.roomCode) ?? null;
  }

  /** Resolves a seat this device owns, refusing anybody else's. */
  private resolve(session: Session, playerId: PlayerId): { room: Room; playerId: PlayerId } | null {
    const room = this.resolveRoom(session);
    if (!room) return null;
    if (!session.playerIds.includes(playerId)) return null;
    if (!room.getPlayer(playerId)) return null;
    return { room, playerId };
  }

  /* ---------------------------------------------------------------------- */
  /* Outbound                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Tells a device the exact set of seats it now holds. The client mirrors it
   * into localStorage, so this is the only thing that has to be right for a
   * refresh to reclaim both halves of a shared phone.
   */
  private sendWelcome(session: Session, room: Room): void {
    const seats: SeatCredentials[] = [];
    for (const playerId of session.playerIds) {
      const player = room.getPlayer(playerId);
      if (player) seats.push({ playerId: player.id, token: player.token });
    }
    this.send(session, { t: "welcome", code: room.code, seats });
  }

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
