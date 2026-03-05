"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Web Audio tone synthesizer for order events.
// No audio files — procedurally-generated short tones via OscillatorNode.
// AudioContext is created lazily on first user interaction (autoplay policy).
// ---------------------------------------------------------------------------

const STORAGE_KEY = "dr3-order-sounds-muted";

/** Shared singleton so every hook consumer shares one AudioContext + mute state. */
let _audioCtx: AudioContext | null = null;
let _muted: boolean = false;
let _listeners: Set<() => void> = new Set();

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!_audioCtx) {
    try {
      _audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  // Resume if suspended (browser autoplay policy)
  if (_audioCtx.state === "suspended") {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
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
  gainVal = 0.15,
) {
  const ctx = getAudioCtx();
  if (!ctx || _muted) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(gainVal, ctx.currentTime);
  // Fade out over last 30ms to avoid clicks
  gain.gain.setValueAtTime(gainVal, ctx.currentTime + duration - 0.03);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

function playTwoNote(freq1: number, freq2: number, duration = 0.2, type: OscillatorType = "sine") {
  const ctx = getAudioCtx();
  if (!ctx || _muted) return;

  const half = duration / 2;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq1, ctx.currentTime);
  osc.frequency.setValueAtTime(freq2, ctx.currentTime + half);
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.setValueAtTime(0.15, ctx.currentTime + duration - 0.03);
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
  playTwoNote(C5, E5, 0.2);
}

/** Descending E5→C5 — "position closed" */
function playExitFill() {
  playTwoNote(E5, C5, 0.2);
}

/** Low buzz 150Hz — "something wrong" */
function playRejection() {
  playTone(150, 0.3, "sawtooth", 0.12);
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
  if (evt.event === "order_status" && evt.status === "Rejected") {
    playRejection();
    return "rejection";
  }
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

  // Init from localStorage once
  useEffect(() => {
    if (!initialized.current) {
      initMuted();
      setMutedState(_muted);
      initialized.current = true;
    }
    // Subscribe to cross-component mute changes
    const listener = () => setMutedState(_muted);
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []);

  const toggleMute = useCallback(() => {
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
