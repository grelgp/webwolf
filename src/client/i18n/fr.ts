/**
 * Every string a player ever reads or hears, in French.
 *
 * The server is deliberately language-free: it sends role ids, slot
 * references and narration *keys*. This module is the only place that turns
 * them into words, which means adding a locale later is a matter of copying
 * this file and picking one at startup - no rules code has to move.
 *
 * Keep the copy short. The whole UI is designed to fit a phone screen without
 * scrolling, and half of it is read by someone who has just opened their eyes.
 */

import type { ErrorCode, RoundOutcome } from "../../shared/protocol.js";
import type { RoleId } from "../../shared/roles.js";

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

/** Names as printed on the French edition of the cards. */
export const ROLE_NAMES: Record<RoleId, string> = {
  werewolf: "Loup-Garou",
  villager: "Villageois",
  seer: "Voyante",
  robber: "Voleur",
  troublemaker: "Noiseuse",
};

/** Plural form, used by the deck builder. */
export const ROLE_NAMES_PLURAL: Record<RoleId, string> = {
  werewolf: "Loups-Garous",
  villager: "Villageois",
  seer: "Voyantes",
  robber: "Voleurs",
  troublemaker: "Noiseuses",
};

/** One line shown under the card during the reveal. */
export const ROLE_TAGLINES: Record<RoleId, string> = {
  werewolf: "Vous dévorez le village. Ne vous faites pas démasquer.",
  villager: "Aucun pouvoir. Votre seule arme, c'est la parole.",
  seer: "Vous voyez une carte cachée pendant la nuit.",
  robber: "Vous volez la carte d'un joueur et devenez son rôle.",
  troublemaker: "Vous échangez les cartes de deux joueurs, à l'aveugle.",
};

/** Instruction shown to the acting player at the top of their night turn. */
export const ROLE_NIGHT_PROMPTS: Record<RoleId, string> = {
  werewolf: "Repérez vos complices.",
  villager: "Vous dormez.",
  seer: "Regardez la carte d'un joueur, ou deux cartes du centre.",
  robber: "Choisissez un joueur : vous prenez sa carte, il reçoit la vôtre.",
  troublemaker: "Échangez les cartes de deux autres joueurs, sans les voir.",
};

export const ROLE_EMOJI: Record<RoleId, string> = {
  werewolf: "🐺",
  villager: "🧑‍🌾",
  seer: "🔮",
  robber: "🥷",
  troublemaker: "🔀",
};

/* -------------------------------------------------------------------------- */
/* Narration (spoken by the host device)                                      */
/* -------------------------------------------------------------------------- */

type NarrationParams = Record<string, string | number>;

/**
 * Keyed exactly as the server emits them: `phase.*`, `wake.<roleId>`,
 * `sleep.<roleId>`, `outcome.*`. A role that never wakes needs no entry.
 */
const NARRATION: Record<string, (params: NarrationParams) => string> = {
  "phase.roleReveal": (p) =>
    `Regardez votre carte et mémorisez-la. Vous avez ${p.seconds} secondes.`,
  "phase.night": () => "La nuit tombe sur le village. Tout le monde ferme les yeux.",

  "wake.werewolf": () =>
    "Loups-garous, réveillez-vous et regardez-vous. Si vous êtes seul, vous pouvez regarder une carte du centre.",
  "sleep.werewolf": () => "Loups-garous, fermez les yeux.",

  "wake.seer": () =>
    "Voyante, réveille-toi. Tu peux regarder la carte d'un autre joueur, ou deux cartes du centre.",
  "sleep.seer": () => "Voyante, ferme les yeux.",

  "wake.robber": () =>
    "Voleur, réveille-toi. Tu peux échanger ta carte avec celle d'un autre joueur, puis regarder ta nouvelle carte.",
  "sleep.robber": () => "Voleur, ferme les yeux.",

  "wake.troublemaker": () =>
    "Noiseuse, réveille-toi. Tu peux échanger les cartes de deux autres joueurs, sans les regarder.",
  "sleep.troublemaker": () => "Noiseuse, ferme les yeux.",

  "phase.day": (p) =>
    `Le jour se lève. Tout le monde ouvre les yeux. Vous avez ${spokenDuration(Number(p.seconds))} pour débattre.`,
  "phase.vote": () => "Le temps est écoulé. Le vote commence : désignez un joueur.",

  "outcome.village": () => "Le village l'emporte !",
  "outcome.werewolf": () => "Les loups-garous l'emportent !",
  "outcome.nobody": () => "Personne ne l'emporte. Un innocent est mort pour rien.",
};

/** Returns the line to speak, or null for an unknown key (never throws). */
export function narrationLine(key: string, params: NarrationParams = {}): string | null {
  const template = NARRATION[key];
  return template ? template(params) : null;
}

/** "5 minutes", "90 secondes" - phrased for text-to-speech, not for a clock. */
function spokenDuration(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? "une minute" : `${minutes} minutes`;
  }
  return `${seconds} secondes`;
}

/* -------------------------------------------------------------------------- */
/* Interface                                                                  */
/* -------------------------------------------------------------------------- */

export const UI = {
  appName: "WebWolf",
  tagline: "Une nuit chez les loups-garous, sans cartes ni déplacements.",

  // Home ------------------------------------------------------------------
  nicknameLabel: "Votre pseudo",
  nicknamePlaceholder: "Camille",
  createRoom: "Créer une partie",
  joinRoom: "Rejoindre",
  codeLabel: "Code du salon",
  codePlaceholder: "ABCD",
  connecting: "Connexion…",
  reconnecting: "Reconnexion…",
  offline: "Hors ligne — nouvelle tentative…",

  // Lobby -----------------------------------------------------------------
  lobbyTitle: "Salon",
  shareCode: "Donnez ce code à vos amis",
  playersTitle: (n: number) => `Joueurs (${n})`,
  hostBadge: "Animateur",
  youBadge: "Vous",
  disconnectedBadge: "Déconnecté",
  removePlayer: "Retirer",
  deckTitle: "Composition",
  deckCount: (actual: number, required: number) => `${actual} / ${required} cartes`,
  deckHint: (players: number) =>
    `${players} joueurs + 3 cartes au centre — le deck doit contenir exactement ${players + 3} cartes.`,
  settingsTitle: "Réglages de la manche",
  settingRoleReveal: "Découverte du rôle",
  settingNightStep: "Durée d'un tour de nuit",
  settingDiscussion: "Discussion",
  settingVote: "Vote",
  settingNarration: "Narration vocale",
  narrationHint: "Cet appareil lit les phases à voix haute. Posez-le au centre de la table.",
  testVoice: "Tester la voix",
  testVoiceLine: "Loups-garous, réveillez-vous.",
  startGame: "Lancer la partie",
  waitingForHost: "En attente de l'animateur…",
  leaveRoom: "Quitter",

  // Shared device ----------------------------------------------------------
  deviceTitle: "Cet appareil",
  deviceHint:
    "Deux joueurs peuvent partager ce téléphone : chacun a sa carte, son tour et son vote, et l'écran passe de l'un à l'autre.",
  deviceFull: "Cet appareil accueille déjà deux joueurs.",
  roomFullHint: "La table est complète.",
  deviceBadge: (group: number) => `Appareil ${group}`,
  addPlayer: "Ajouter un 2e joueur",
  addPlayerTitle: "Deuxième joueur",
  addPlayerIntro:
    "Ce joueur partage votre téléphone. Il reçoit sa propre carte et vote de son côté ; vous vous passerez l'écran au bon moment.",
  addPlayerLabel: "Pseudo du 2e joueur",
  addPlayerConfirm: "Ajouter à la table",
  removeSeat: "Retirer de la table",
  cancel: "Annuler",
  /** Ends one player's turn with the screen and hands the phone back. */
  handoverDone: "Terminé — rendre le téléphone",

  // Role reveal -----------------------------------------------------------
  revealTitle: "Votre carte",
  revealTitleFor: (nickname: string) => `Carte de ${nickname}`,
  revealWarning: "Mémorisez-la : vous ne pourrez plus la revoir.",
  revealAck: "C'est mémorisé",
  revealWaiting: (ready: number, total: number) => `${ready} / ${total} prêts`,
  /** Gate shown before any card is drawn, so nobody uncovers someone else's. */
  revealGateSolo: "Votre carte est prête.",
  revealGateShared: (nickname: string) => `Passez le téléphone à ${nickname}.`,
  revealGateCaution: "Personne d'autre ne doit voir l'écran.",
  revealGateButtonSolo: "Voir ma carte",
  revealGateButton: (nickname: string) => `Je suis ${nickname} — voir ma carte`,
  revealSeatDone: "carte mémorisée",
  revealSeatWaiting: "n'a pas encore regardé",

  // Night -----------------------------------------------------------------
  nightTitle: "La nuit",
  nightKeepEyesClosed: "Gardez les yeux fermés.",
  nightStep: (step: number, total: number, role: string) => `Tour ${step}/${total} — ${role}`,
  nightFellows: "Vos complices :",
  fellowNote: "Complice",
  swappedNote: "Échangée",
  nightAlone: "Vous êtes le seul loup-garou. Vous pouvez regarder une carte du centre.",
  nightSkip: "Passer",
  nightSkipped: "Vous avez passé votre tour.",
  nightNothingToDo: "Rien à faire ce tour-ci. Regardez bien, puis refermez les yeux.",
  nightSwapDone: "Échange effectué.",
  nightRobbedInto: "Voici votre nouvelle carte. Mémorisez-la.",
  nightYouSee: "Mémorisez cette carte, puis refermez les yeux.",
  nightCloseAgain: "Refermez les yeux à la fin du tour.",

  // Table ------------------------------------------------------------------
  centerCard: (index: number) => `Centre ${index + 1}`,

  // Day --------------------------------------------------------------------
  dayTitle: "Le jour se lève",
  dayInstruction: "Débattez. Qui est le loup-garou ?",
  endDiscussion: "Passer au vote",

  // Vote -------------------------------------------------------------------
  voteTitle: "Le vote",
  voteInstruction: "Désignez le joueur à éliminer.",
  voteProgress: (voted: number, total: number) => `${voted} / ${total} ont voté`,
  voteYours: (nickname: string) => `Votre vote : ${nickname}`,
  voteChangeable: "Vous pouvez encore changer d'avis.",
  voteGateInstruction: "Chacun vote de son côté, sans montrer son choix à l'autre.",
  voteGateButton: (nickname: string) => `${nickname} — voter`,
  voteSeatDone: "a voté",
  voteSeatWaiting: "n'a pas encore voté",
  voteTitleFor: (nickname: string) => `Vote de ${nickname}`,

  // Reveal -----------------------------------------------------------------
  revealResultTitle: "Résultat",
  outcomeTitle: (outcome: RoundOutcome) =>
    outcome === "village"
      ? "Le village gagne !"
      : outcome === "werewolf"
        ? "Les loups-garous gagnent !"
        : "Personne ne gagne",
  outcomeDetail: (outcome: RoundOutcome) =>
    outcome === "village"
      ? "Un loup-garou a été éliminé — ou le village a su n'accuser personne."
      : outcome === "werewolf"
        ? "Aucun loup-garou n'a été éliminé."
        : "Il n'y avait aucun loup-garou, et un innocent a été éliminé.",
  nobodyDied: "Personne n'a été éliminé : chaque joueur a reçu exactement une voix.",
  eliminatedLabel: "Éliminé",
  votesReceived: (n: number) => (n === 1 ? "1 voix" : `${n} voix`),
  dealtToFinal: "→",
  centerTitle: "Cartes du centre",
  playAgain: "Rejouer",
} as const;

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  bad_protocol: "Cette page n'est plus à jour. Rechargez-la.",
  bad_request: "Requête invalide.",
  room_not_found: "Aucun salon avec ce code.",
  room_full: "Ce salon est complet.",
  game_in_progress: "Une manche est déjà en cours dans ce salon.",
  not_host: "Seul l'animateur peut faire ça.",
  not_in_room: "Vous n'êtes plus dans le salon.",
  invalid_deck: "La composition n'est pas jouable.",
  device_full: "Cet appareil accueille déjà deux joueurs.",
  invalid_action: "Action impossible pour l'instant.",
  kicked: "Vous avez été retiré du salon.",
  internal: "Erreur interne. Réessayez.",
};

export function errorMessage(code: ErrorCode): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal;
}

/** Why the current deck cannot be played, phrased for the host. */
export function deckProblem(
  reason: string | undefined,
  detail: Record<string, string | number> | undefined,
): string {
  switch (reason) {
    case "too_few_players":
      return `Il faut au moins ${detail?.min ?? 3} joueurs.`;
    case "wrong_size":
      return `Il faut exactement ${detail?.required ?? "?"} cartes.`;
    case "too_many_copies":
      return "Trop d'exemplaires d'une carte.";
    case "no_werewolf":
      return "Ajoutez au moins un Loup-Garou.";
    default:
      return "Composition invalide.";
  }
}

/** mm:ss for on-screen countdowns. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}`;
}

/** "5 min", "45 s" - compact form for the lobby's settings steppers. */
export function formatDuration(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  return `${seconds} s`;
}
