"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Web Audio tone synthesizer for order events.
// No audio files — procedurally-generated short tones via OscillatorNode.
//
// IMPORTANT: Browser autoplay policy requires AudioContext to be created or
// resumed during a user gesture (click/keypress/touch). We register a one-shot
// global click listener that warms up the context on the very first interaction.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "dr3-order-sounds-muted";

/** Shared singleton so every hook consumer shares one AudioContext + mute state. */
let _audioCtx: AudioContext | null = null;
let _muted: boolean = false;
let _listeners: Set<() => void> = new Set();
let _warmupRegistered = false;

/** Create or resume AudioContext. Returns null if unavailable. */
function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!_audioCtx) {
    try {
      _audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  return _audioCtx;
}

/**
 * Must be called from a user-gesture handler (click/keypress/touch).
 * Creates the AudioContext if needed and resumes it from suspended state.
 */
function warmupAudioCtx() {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

/** One-shot global listener: first user click warms up audio. */
function ensureWarmupListener() {
  if (_warmupRegistered || typeof window === "undefined") return;
  _warmupRegistered = true;

  const handler = () => {
    warmupAudioCtx();
    // Keep listening — Chrome may re-suspend if no audio plays for a while
  };

  // These are user-gesture events that satisfy autoplay policy
  document.addEventListener("click", handler, { capture: true });
  document.addEventListener("keydown", handler, { capture: true, once: true });
}

function initMuted() {
  if (typeof window === "undefined") return;
  try {
    _muted = localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    _muted = false;
  }
}

function setMuted(val: boolean) {
  _muted = val;
  try {
    localStorage.setItem(STORAGE_KEY, String(val));
  } catch {}
  _listeners.forEach((fn) => fn());
}

// ---------------------------------------------------------------------------
// Tone playback helpers
// ---------------------------------------------------------------------------

function playTone(
  freq: number,
  duration: number,
  type: OscillatorType = "sine",
  gainVal = 0.35,
) {
  const ctx = getAudioCtx();
  if (!ctx || ctx.state !== "running" || _muted) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(gainVal, ctx.currentTime);
  // Fade out over last 40ms to avoid clicks
  gain.gain.setValueAtTime(gainVal, ctx.currentTime + duration - 0.04);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

function playTwoNote(freq1: number, freq2: number, duration = 0.25, type: OscillatorType = "sine") {
  const ctx = getAudioCtx();
  if (!ctx || ctx.state !== "running" || _muted) return;

  const half = duration / 2;
  const gainVal = 0.35;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq1, ctx.currentTime);
  osc.frequency.setValueAtTime(freq2, ctx.currentTime + half);
  gain.gain.setValueAtTime(gainVal, ctx.currentTime);
  gain.gain.setValueAtTime(gainVal, ctx.currentTime + duration - 0.04);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

// Note frequencies: C5=523.25, E5=659.25
const C5 = 523.25;
const E5 = 659.25;

/** Ascending C5→E5 — "money deployed" */
function playEntryFill() {
  playTwoNote(C5, E5, 0.25);
}

/** Descending E5→C5 — "position closed" */
function playExitFill() {
  playTwoNote(E5, C5, 0.25);
}

/** Low buzz 150Hz — "something wrong" */
function playRejection() {
  playTone(150, 0.35, "sawtooth", 0.25);
}

// ---------------------------------------------------------------------------
// Event classification
// ---------------------------------------------------------------------------

export interface AccountEvent {
  event: string;
  status?: string;
  side?: string;
  [key: string]: unknown;
}

/**
 * Classify an account event and play the appropriate sound.
 * Returns the sound type played, or null if no sound.
 */
export function classifyAndPlay(evt: AccountEvent): "entry" | "exit" | "rejection" | null {
  // Rejection: order_status with Rejected or Inactive (IB async rejection)
  if (evt.event === "order_status" && (evt.status === "Rejected" || evt.status === "Inactive")) {
    playRejection();
    return "rejection";
  }
  // Fills: execution events have side field
  // IB sends "BOT" for buys, "SLD" for sells in execDetails callback
  if (evt.event === "execution") {
    if (evt.side === "BOT" || evt.side === "BUY") {
      playEntryFill();
      return "entry";
    }
    if (evt.side === "SLD" || evt.side === "SELL") {
      playExitFill();
      return "exit";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export function useOrderSounds() {
  const [muted, setMutedState] = useState(_muted);
  const initialized = useRef(false);

  // Init from localStorage once + register global warmup listener
  useEffect(() => {
    if (!initialized.current) {
      initMuted();
      setMutedState(_muted);
      initialized.current = true;
    }
    // Register global click/keydown listener to warm up AudioContext
    ensureWarmupListener();
    // Subscribe to cross-component mute changes
    const listener = () => setMutedState(_muted);
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []);

  const toggleMute = useCallback(() => {
    // Toggle also warms up audio (this IS a user gesture)
    warmupAudioCtx();
    setMuted(!_muted);
  }, []);

  return {
    muted,
    toggleMute,
    playEntryFill,
    playExitFill,
    playRejection,
    classifyAndPlay,
  };
}
