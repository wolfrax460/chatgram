/**
 * Voice-note playback rules shared by every `VoiceNotePlayer`:
 *
 *  - exactly one voice note plays at a time (starting one pauses the other);
 *  - the 1× / 1.5× / 2× speed choice is remembered across sessions.
 */

export const VOICE_SPEEDS = [1, 1.5, 2] as const;
export type VoiceSpeed = (typeof VOICE_SPEEDS)[number];

const SPEED_STORAGE_KEY = 'chatgram.voiceNoteSpeed';

/** Last chosen playback speed, or 1× when nothing valid is stored. */
export function readVoiceSpeed(): VoiceSpeed {
  try {
    const raw = Number(localStorage.getItem(SPEED_STORAGE_KEY));
    return VOICE_SPEEDS.find((speed) => speed === raw) ?? 1;
  } catch {
    // Private mode / WebView with storage disabled.
    return 1;
  }
}

export function persistVoiceSpeed(speed: VoiceSpeed): void {
  try {
    localStorage.setItem(SPEED_STORAGE_KEY, String(speed));
  } catch {
    /* storage unavailable — speed still applies for this session */
  }
}

/** 1× → 1.5× → 2× → 1× */
export function nextVoiceSpeed(speed: VoiceSpeed): VoiceSpeed {
  const index = VOICE_SPEEDS.indexOf(speed);
  return VOICE_SPEEDS[(index + 1) % VOICE_SPEEDS.length] ?? 1;
}

let activePause: (() => void) | null = null;

/**
 * Take the single playback slot. The previous voice note (if any) is paused
 * immediately. Returns the release function for when this player pauses, ends
 * or unmounts.
 */
export function claimVoicePlayback(pause: () => void): () => void {
  const previous = activePause;
  activePause = pause;
  if (previous && previous !== pause) previous();
  return () => {
    if (activePause === pause) activePause = null;
  };
}
