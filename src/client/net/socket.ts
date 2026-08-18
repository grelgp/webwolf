/**
 * The client half of the connection: one auto-reconnecting WebSocket plus the
 * credentials that let a refreshed browser reclaim its seat.
 *
 * Reconnection is intentionally aggressive. Phones lock, tabs get backgrounded
 * and hotel wifi drops, all of which happen constantly during a round. The
 * socket retries with a capped exponential backoff, and every successful open
 * replays `hello` with the stored credentials, so the server puts the player
 * back where they were - the UI never has to special-case "was disconnected".
 *
 * A device may hold more than one seat, so the stored credentials are a list.
 * A refresh reclaims every seat on the phone in a single `hello`.
 */

import { PROTOCOL_VERSION } from "../../shared/constants.js";
import type {
  ClientMessage,
  PlayerId,
  SeatCredentials,
  ServerMessage,
} from "../../shared/protocol.js";

const STORAGE_KEY = "webwolf.session";

export interface StoredSession {
  code: string;
  /** Every seat this device holds, in the order the server listed them. */
  seats: SeatCredentials[];
}

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface SocketHandlers {
  onMessage(message: ServerMessage): void;
  onStatus(status: ConnectionStatus): void;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8_000;

export class GameSocket {
  private socket: WebSocket | null = null;
  private attempts = 0;
  private reconnectTimer: number | null = null;
  private closedByUs = false;

  constructor(private readonly handlers: SocketHandlers) {}

  /* ---------------------------------------------------------------------- */
  /* Stored credentials                                                     */
  /* ---------------------------------------------------------------------- */

  static loadSession(): StoredSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredSession>;
      if (!parsed.code || !Array.isArray(parsed.seats)) return null;

      // A single malformed entry must not cost the device its other seat, so
      // the list is filtered rather than rejected outright.
      const seats = parsed.seats.filter(
        (seat): seat is SeatCredentials =>
          typeof seat?.playerId === "string" && typeof seat?.token === "string",
      );
      return seats.length > 0 ? { code: parsed.code, seats } : null;
    } catch {
      return null;
    }
  }

  static saveSession(session: StoredSession): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Private browsing with storage disabled: the round still works, only
      // reconnecting after a refresh does not.
    }
  }

  /** Forgets one seat, e.g. after a companion left or was removed. */
  static dropSeat(playerId: PlayerId): void {
    const session = GameSocket.loadSession();
    if (!session) return;
    const seats = session.seats.filter((seat) => seat.playerId !== playerId);
    if (seats.length > 0) GameSocket.saveSession({ code: session.code, seats });
    else GameSocket.clearSession();
  }

  static clearSession(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to do; see saveSession.
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Lifecycle                                                              */
  /* ---------------------------------------------------------------------- */

  connect(): void {
    this.closedByUs = false;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;

    this.handlers.onStatus("connecting");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.attempts = 0;
      this.handlers.onStatus("open");
      this.sayHello();
    });

    socket.addEventListener("message", (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handlers.onMessage(message);
    });

    socket.addEventListener("close", () => {
      this.socket = null;
      this.handlers.onStatus("closed");
      if (!this.closedByUs) this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // `close` always follows, and that is where reconnection is handled.
    });
  }

  /** Announces the protocol version and, if we have any, the seats to restore. */
  private sayHello(): void {
    const session = GameSocket.loadSession();
    this.send(
      session
        ? { t: "hello", protocol: PROTOCOL_VERSION, code: session.code, seats: session.seats }
        : { t: "hello", protocol: PROTOCOL_VERSION },
    );
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempts);
    this.attempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  /** Closes without reconnecting; used when the player deliberately leaves. */
  disconnect(): void {
    this.closedByUs = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }
}
