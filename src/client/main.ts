/**
 * Client entry point: wires the socket, the store, the narrator and the
 * renderer together, and implements the `Actions` surface the screens call.
 *
 * Everything below is plumbing. The rules live on the server, and the screens
 * are pure functions of the snapshot it sends - which is why a player can
 * refresh mid-round and land exactly where they left off.
 */

import { ROOM_CODE_LENGTH, type RoomSettings } from "../shared/constants.js";
import type { PlayerId, ServerMessage } from "../shared/protocol.js";
import type { CardSlot, RoleId } from "../shared/roles.js";
import type { Actions } from "./actions.js";
import { errorMessage, UI } from "./i18n/fr.js";
import { Narrator } from "./narrator.js";
import { GameSocket, type ConnectionStatus } from "./net/socket.js";
import { Store } from "./store.js";
import { createRenderer } from "./ui/render.js";
import { applyTap } from "./ui/screens/night.js";
import { presetJoinCode, resetHomeDraft } from "./ui/screens/home.js";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root element");

const store = new Store();
const narrator = new Narrator();

const socket = new GameSocket({
  onMessage: (message) => handleMessage(message),
  onStatus: (status: ConnectionStatus) => store.setStatus(status),
});

const actions: Actions = {
  createRoom(nickname) {
    // Must happen inside the tap handler: browsers only arm speech synthesis
    // from a user gesture, and the host device starts narrating moments later.
    narrator.unlock();
    store.setNickname(nickname);
    store.setError(null);
    socket.send({ t: "create_room", nickname });
  },

  joinRoom(code, nickname) {
    narrator.unlock();
    store.setNickname(nickname);
    store.setError(null);
    socket.send({ t: "join_room", code, nickname });
  },

  leaveRoom() {
    socket.send({ t: "leave_room" });
    GameSocket.clearSession();
    resetHomeDraft();
    store.clearRoom();
  },

  setDeck(counts: Partial<Record<RoleId, number>>) {
    socket.send({ t: "set_deck", deck: counts });
  },

  setSettings(patch: Partial<RoomSettings>) {
    if (typeof patch.narrationEnabled === "boolean") {
      narrator.setEnabled(patch.narrationEnabled);
      if (patch.narrationEnabled) narrator.unlock();
    }
    socket.send({ t: "set_settings", settings: patch });
  },

  kickPlayer(playerId: PlayerId) {
    socket.send({ t: "kick_player", playerId });
  },

  startGame() {
    narrator.unlock();
    socket.send({ t: "start_game" });
  },

  ready() {
    socket.send({ t: "ready" });
  },

  tapSlot(slot: CardSlot) {
    const turn = store.state.server?.private?.turn;
    if (!turn || turn.resolved) return;

    const result = applyTap(turn, store.state.selection, slot);
    if (result.submit) {
      socket.send({
        t: "night_action",
        groupId: result.submit.groupId,
        slots: result.submit.slots,
      });
    }
    store.setSelection(result.selection);
  },

  skipNight() {
    socket.send({ t: "night_skip" });
  },

  endDiscussion() {
    socket.send({ t: "end_discussion" });
  },

  castVote(targetId: PlayerId) {
    socket.send({ t: "cast_vote", targetId });
  },

  playAgain() {
    socket.send({ t: "play_again" });
  },

  testVoice() {
    narrator.unlock();
    narrator.say(UI.testVoiceLine);
  },
};

const render = createRenderer(root, store, actions);
store.subscribe(render);

function handleMessage(message: ServerMessage): void {
  switch (message.t) {
    case "welcome":
      GameSocket.saveSession({
        code: message.code,
        playerId: message.playerId,
        token: message.token,
      });
      return;

    case "state":
      // Narration is a host-device setting, and the host can change between
      // rounds, so it is re-applied from every snapshot rather than once.
      narrator.setEnabled(message.state.isHost && message.state.settings.narrationEnabled);
      store.applyServerState(message.state);
      return;

    case "narrate":
      narrator.speak(message.key, message.params ?? {});
      return;

    case "error":
      store.setError(errorMessage(message.code));
      return;

    case "goodbye":
      // The seat is gone: stale credentials, a kick, or a deliberate exit.
      // Clearing storage stops the client from trying to resume a dead seat.
      GameSocket.clearSession();
      narrator.cancel();
      resetHomeDraft();
      store.clearRoom();
      if (message.reason !== "left") store.setError(errorMessage(message.reason));
      return;

    case "pong":
      return;
  }
}

// A shared link such as https://example.com/ABCD lands here; lift the code out
// of the path so the player only has to type a nickname.
const deepLink = location.pathname.slice(1).toUpperCase();
if (new RegExp(`^[A-Z]{${ROOM_CODE_LENGTH}}$`).test(deepLink)) presetJoinCode(deepLink);

socket.connect();
render();

// A phone that has been asleep wakes with a socket the OS quietly killed;
// nudging it here makes the round resume as soon as the screen comes back on.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") socket.connect();
});
