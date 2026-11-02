// Game time. Plain TypeScript so the server owns the clock and the browser and
// tests can read it.
//
// Game milliseconds are elapsed play time, not a calendar. One real second is
// `sailingTimeScale` game seconds. The room starts at Day 1, 08:00.

import { settings } from "./settings.js";

export const GAME_DAY_MS = settings.time.hoursPerDay * 3_600_000;
export const GAME_HOUR_MS = 3_600_000;

export interface GameClock {
  /** Whole game seconds since the room started. */
  elapsedSeconds: number;
  /** Day number, starting at 1. */
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 at night, 1 in full daylight, smoothly blended at dawn and dusk. */
  daylight: number;
  /** True during the nominal 06:00–18:00 daylight window. */
  isDay: boolean;
  /** Long-form display text, for example "Day 3, 14:20". */
  text: string;
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

/** Daylight strength for an hour of the game day, 0 to 1. */
export function daylightAtHour(hour: number): number {
  const dawnStart = settings.time.daylightStartHour;
  const duskEnd = settings.time.daylightEndHour;
  const twilight = Math.max(0.001, settings.time.twilightHours);
  const dawnEnd = dawnStart + twilight;
  const duskStart = duskEnd - twilight;

  if (hour < dawnStart || hour >= duskEnd) return 0;
  if (hour < dawnEnd) return smoothstep((hour - dawnStart) / twilight);
  if (hour < duskStart) return 1;
  return 1 - smoothstep((hour - duskStart) / twilight);
}

/** Turn elapsed game milliseconds into the clock and light shown on screen. */
export function gameClockAt(gameMs: number): GameClock {
  const elapsed = Number.isFinite(gameMs) ? Math.max(0, gameMs) : 0;
  const absoluteMs = settings.time.startHour * GAME_HOUR_MS + elapsed;
  const day = Math.floor(absoluteMs / GAME_DAY_MS) + 1;
  const intoDayMs = absoluteMs % GAME_DAY_MS;
  const totalSeconds = Math.floor(intoDayMs / 1000);
  const hour = Math.floor(totalSeconds / 3600);
  const minute = Math.floor((totalSeconds % 3600) / 60);
  const second = totalSeconds % 60;
  const hourFraction = intoDayMs / GAME_HOUR_MS;

  return {
    elapsedSeconds: Math.floor(elapsed / 1000),
    day,
    hour,
    minute,
    second,
    daylight: daylightAtHour(hourFraction),
    isDay: hour >= settings.time.daylightStartHour && hour < settings.time.daylightEndHour,
    text: `Day ${day}, ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

/** Format a clock in the one design used by the paper panel. */
export function formatGameClock(clock: GameClock): string {
  return clock.text;
}

/**
 * Moon phase from 0 (new) to 1 (back to new), and illuminated fraction from
 * 0 to 1. It repeats every 29.5 game days and is deliberately calendar-free.
 */
export function moonPhase(gameMs: number): { phase: number; illumination: number } {
  const cycleMs = settings.time.moonCycleDays * GAME_DAY_MS;
  const elapsed = Number.isFinite(gameMs) ? Math.max(0, gameMs) : 0;
  const phase = (elapsed % cycleMs) / cycleMs;
  return {
    phase,
    illumination: (1 - Math.cos(phase * Math.PI * 2)) / 2,
  };
}
