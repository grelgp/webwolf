/**
 * Protocol-level constants shared by the server and the browser client.
 *
 * This module must stay free of any environment-specific API (no `window`,
 * no `process`) because it is bundled into both runtimes.
 */

/**
 * Bumped whenever the wire format changes in a backwards-incompatible way.
 * The server refuses `hello` frames carrying a different version, which turns
 * a stale cached client into a clear error instead of a silent desync.
 */
export const PROTOCOL_VERSION = 2;

/** Length of the room code players type in to join. */
export const ROOM_CODE_LENGTH = 4;

/**
 * Alphabet used for room codes. Vowels are excluded so generated codes can
 * never spell a real (or rude) word, and so are the glyphs that are easy to
 * misread out loud across a table: I/1, O/0, U/V ambiguity, Y/J.
 */
export const ROOM_CODE_ALPHABET = "BCDFGHKMNPQRSTWXZ";

/** Face-down cards left in the middle of the table, as in the physical game. */
export const CENTER_CARD_COUNT = 3;

/** One Night Ultimate Werewolf is unplayable below three players. */
export const MIN_PLAYERS = 3;

/** Hard ceiling, independent of the deck; keeps the no-scroll grid readable. */
export const MAX_PLAYERS = 10;

export const NICKNAME_MAX_LENGTH = 16;

/**
 * Seats one physical device may hold.
 *
 * Two people can share a phone: the round then hands the screen from one to
 * the other behind a confirmation gate, which is what lets a five-player table
 * run on three devices instead of five. Raising this is a matter of the
 * hand-over UI staying readable, not of any rule.
 */
export const MAX_SEATS_PER_DEVICE = 2;

/**
 * Pause between the last card being put down and the first role being called.
 *
 * The role reveal ends the instant the last player taps "ready", which can be
 * seconds before the others have looked up from their screens. Calling the
 * werewolves straight into that would have people opening their eyes on a
 * table that is still settling. Short enough not to drag, long enough for the
 * narration to finish and for every phone to go face down.
 */
export const NIGHT_SETTLE_SECONDS = 5;

/**
 * Round settings the host can tweak in the lobby. Every duration is in seconds
 * so the lobby UI can present plain steppers.
 */
export interface RoomSettings {
  /** How long each player sees their own card before the night starts. */
  roleRevealSeconds: number;
  /** Length of one night step (one role being called by the narrator). */
  nightStepSeconds: number;
  /** Day discussion timer. */
  discussionSeconds: number;
  /** Time allowed to cast the final vote once discussion is over. */
  voteSeconds: number;
  /** Whether the host device narrates phases out loud with text-to-speech. */
  narrationEnabled: boolean;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  roleRevealSeconds: 10,
  nightStepSeconds: 15,
  discussionSeconds: 300,
  voteSeconds: 60,
  narrationEnabled: true,
};

/**
 * Allowed range and stepper increment for each numeric setting. The server
 * clamps to these bounds, the lobby UI renders its +/- buttons from them, so
 * the two can never disagree.
 */
export const SETTINGS_BOUNDS = {
  roleRevealSeconds: { min: 5, max: 60, step: 5 },
  nightStepSeconds: { min: 5, max: 90, step: 5 },
  discussionSeconds: { min: 60, max: 1200, step: 30 },
  voteSeconds: { min: 15, max: 300, step: 15 },
} as const;

export type NumericSettingKey = keyof typeof SETTINGS_BOUNDS;

export const NUMERIC_SETTING_KEYS = Object.keys(SETTINGS_BOUNDS) as NumericSettingKey[];
