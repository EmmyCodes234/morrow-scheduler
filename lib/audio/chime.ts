/**
 * Pure Web Audio API Chime & Knock Synthesizer.
 * Zero external audio files, zero CDN latency, 100% offline-ready and reliable.
 */

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioContext || sharedAudioContext.state === "closed") {
      sharedAudioContext = new AudioCtx();
    }
    if (sharedAudioContext.state === "suspended") {
      sharedAudioContext.resume().catch(() => {});
    }
    return sharedAudioContext;
  } catch {
    return null;
  }
}

/**
 * Synthesizes a realistic double wooden knock sound effect.
 */
export function playDoorKnock(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const playSingleKnock = (delaySeconds: number) => {
    const now = ctx.currentTime + delaySeconds;

    // Resonant bandpass filter to simulate solid wood thump
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(320, now);
    filter.Q.setValueAtTime(4.0, now);

    // Short low sine pop for body resonance
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.7, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.1);
  };

  // Two knocks spaced 120ms apart (standard door knock rhythm)
  playSingleKnock(0);
  playSingleKnock(0.12);
}

/**
 * Synthesizes a pleasant acoustic doorbell chime (Ding-Dong / Marimba tone).
 */
export function playDoorbellChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const playTone = (freq: number, startTime: number, duration: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(0.4, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  };

  const now = ctx.currentTime;
  // High note (Ding) followed by lower note (Dong)
  playTone(880, now, 0.7);        // A5
  playTone(659.25, now + 0.25, 1.0); // E5
}

/**
 * Subtle wrap-up chime for 1 minute remaining in speed-chat.
 */
export function playTimerWarningChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(587.33, now); // D5
  osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.45);
}

/**
 * Delightful marimba triad chime when a new booking arrives in real-time.
 * Notes: C5 -> E5 -> G5 -> C6
 */
export function playBookingChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const notes = [
    { freq: 523.25, time: 0 },     // C5
    { freq: 659.25, time: 0.08 },  // E5
    { freq: 783.99, time: 0.16 },  // G5
    { freq: 1046.5, time: 0.24 },  // C6
  ];

  const baseTime = ctx.currentTime;

  notes.forEach(({ freq, time }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, baseTime + time);

    gain.gain.setValueAtTime(0.001, baseTime + time);
    gain.gain.linearRampToValueAtTime(0.35, baseTime + time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, baseTime + time + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(baseTime + time);
    osc.stop(baseTime + time + 0.65);
  });
}

/**
 * Gentle two-tone descend chime when a meeting is cancelled.
 */
export function playCancelChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const baseTime = ctx.currentTime;
  const notes = [
    { freq: 783.99, time: 0 },     // G5
    { freq: 587.33, time: 0.14 },  // D5
  ];

  notes.forEach(({ freq, time }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, baseTime + time);

    gain.gain.setValueAtTime(0.001, baseTime + time);
    gain.gain.linearRampToValueAtTime(0.2, baseTime + time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, baseTime + time + 0.45);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(baseTime + time);
    osc.stop(baseTime + time + 0.5);
  });
}
