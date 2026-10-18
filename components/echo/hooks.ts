"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// Small browser hooks for the Echo Show simulator.

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// True when the user asked the OS for less motion.
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

function subscribeClock(onChange: () => void) {
  const timer = window.setInterval(onChange, 5_000);
  return () => window.clearInterval(timer);
}

// Current time, rounded to the minute. Null during server rendering (no clock there).
export function useClock(): Date | null {
  const minute = useSyncExternalStore(
    subscribeClock,
    () => Math.floor(Date.now() / 60_000),
    () => null,
  );
  return minute === null ? null : new Date(minute * 60_000);
}

const noSubscribe = () => () => {};

// True if this browser has the Web Speech API (Chrome, Edge).
export function useSpeechSupported(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
    () => false,
  );
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

// Counts from 0 up to `target` once, after `delayMs` (so it starts with its card's fade-in).
export function useCountUp(target: number, delayMs = 0, durationMs = 700): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    const start = performance.now() + delayMs;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / durationMs));
      setValue(target * easeOutCubic(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, delayMs, durationMs, reduced]);

  return reduced ? target : value;
}

// Scale that fits the fixed-size simulator (designed at 1920x1080) into smaller windows.
export function useFitScale(width: number, height: number): number | null {
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    const update = () => {
      const fit = Math.min(1, (window.innerWidth - 32) / width, (window.innerHeight - 32) / height);
      setScale(Math.max(0.3, fit));
    };
    const frame = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
    };
  }, [width, height]);

  return scale;
}
