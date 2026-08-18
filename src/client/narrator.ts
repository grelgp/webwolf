/**
 * The speaker phone.
 *
 * Only the host device receives `narrate` frames, so only the host speaks -
 * mirroring the physical setup where one phone in the middle of the table
 * narrates and everyone else just listens with their eyes shut.
 *
 * Two browser quirks shape this module:
 *
 * 1. `speechSynthesis.getVoices()` is empty until the engine has loaded, and
 *    fires `voiceschanged` when it is ready. We therefore resolve the voice
 *    lazily, at the moment we speak, rather than caching one at startup.
 *
 * 2. iOS and Chrome refuse to speak until the page has had a user gesture.
 *    `unlock()` is called from the first real tap (creating or joining a room,
 *    or the lobby's "test the voice" button) and utters an empty string, which
 *    is enough to arm the engine for the rest of the session.
 */

import { narrationLine } from "./i18n/fr.js";

const LANG = "fr-FR";

export class Narrator {
  private enabled = true;
  private unlocked = false;
  private voice: SpeechSynthesisVoice | null = null;
  /** URI of the voice the host picked in the lobby, or null for automatic. */
  private preferredURI: string | null = null;
  /** Recent lines, newest last, shown on the host screen as a transcript. */
  private readonly history: string[] = [];

  get supported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  get transcript(): readonly string[] {
    return this.history;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancel();
  }

  /**
   * French voices this engine offers, for the lobby's voice picker. Empty
   * until `voiceschanged` has fired once - callers should re-read it then.
   */
  listVoices(): SpeechSynthesisVoice[] {
    if (!this.supported) return [];
    return window.speechSynthesis.getVoices().filter((candidate) => candidate.lang.startsWith("fr"));
  }

  /** Pins narration to one voice by URI, or null to let the engine pick. */
  setPreferredVoice(uri: string | null): void {
    this.preferredURI = uri;
  }

  /** Must be called from inside a user gesture handler. */
  unlock(): void {
    if (this.unlocked || !this.supported) return;
    this.unlocked = true;
    try {
      const primer = new SpeechSynthesisUtterance("");
      primer.volume = 0;
      window.speechSynthesis.speak(primer);
    } catch {
      // Some engines reject the primer; speaking still tends to work.
    }
  }

  /**
   * Speaks a narration key. Unknown keys are ignored rather than thrown, so a
   * server that learns a new phase before the client does simply stays quiet.
   */
  speak(key: string, params: Record<string, string | number> = {}): void {
    const line = narrationLine(key, params);
    if (!line) return;

    this.history.push(line);
    if (this.history.length > 12) this.history.shift();

    if (!this.enabled || !this.supported) return;
    this.utter(line);
  }

  /** Speaks an arbitrary line, for the lobby's voice test. */
  say(line: string): void {
    if (!this.enabled || !this.supported) return;
    this.utter(line);
  }

  private utter(line: string): void {
    const utterance = new SpeechSynthesisUtterance(line);
    utterance.lang = LANG;
    // Slightly slower than default: the narrator is competing with a room of
    // people settling down, and every line is an instruction.
    utterance.rate = 0.95;
    utterance.pitch = 1;

    const voice = this.resolveVoice();
    if (voice) utterance.voice = voice;

    // Utterances queue natively, which is what we want: "close your eyes" for
    // one role and "wake up" for the next arrive back to back and must be read
    // in order rather than interrupt each other.
    window.speechSynthesis.speak(utterance);
  }

  private resolveVoice(): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return this.voice;

    if (this.preferredURI) {
      const preferred = voices.find((candidate) => candidate.voiceURI === this.preferredURI);
      if (preferred) return preferred;
    }

    if (this.voice && voices.includes(this.voice)) return this.voice;

    this.voice =
      voices.find((candidate) => candidate.lang === LANG) ??
      voices.find((candidate) => candidate.lang.startsWith("fr")) ??
      null;
    return this.voice;
  }

  cancel(): void {
    if (!this.supported) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Cancelling an idle queue throws on some engines; harmless.
    }
  }
}
