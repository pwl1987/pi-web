"use client";

import { useRef, useCallback, useEffect, useSyncExternalStore } from "react";

// ============================================================================
// External store (module-level) — mirrors useTheme/useI18n pattern so the
// sound toggle stays in sync across SettingsPanel and ChatInput.
// ============================================================================

const STORAGE_KEY = "pi-sound-enabled";

function readStored(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? true : stored === "true";
}

let soundEnabled = readStored();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): boolean {
  return soundEnabled;
}

function getServerSnapshot(): boolean {
  return true;
}

function setSoundEnabled(next: boolean): void {
  soundEnabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    /* ignore */
  }
  listeners.forEach((cb) => cb());
}

// ============================================================================
// AudioContext management (unchanged — single reused context)
// ============================================================================

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (audioCtx && audioCtx.state !== "closed") return audioCtx;
  try {
    audioCtx = new AudioContext();
  } catch {
    return null;
  }
  return audioCtx;
}

function playTone(ctx: AudioContext) {
  const now = ctx.currentTime;
  const freqs = [523.25, 659.25];
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = now + i * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}

// ============================================================================
// Public API
// ============================================================================

export function useAudio() {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const unlockAudio = useCallback((force = false) => {
    if (!force && !enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx || ctx.state !== "suspended") return;
    ctx.resume().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    if (next) unlockAudio(true);
    setSoundEnabled(next);
  }, [unlockAudio]);

  const playDone = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const play = () => {
      try {
        playTone(ctx);
      } catch {
        // AudioContext not available
      }
    };
    if (ctx.state === "suspended") {
      ctx
        .resume()
        .then(play)
        .catch(() => {});
      return;
    }
    play();
  }, []);

  return {
    soundEnabled: enabled,
    onSoundToggle: toggle,
    playDoneSound: playDone,
    unlockAudio,
    soundEnabledRef: enabledRef,
  };
}
