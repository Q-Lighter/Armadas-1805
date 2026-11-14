// Browser-free plans for visible fire, the effect gallery and the night
// lights-off ring. The client paints these shapes in its top ship-effect layer.

import { settings } from "./settings.js";

export type FireZoomBand = "close" | "mid" | "far";
export type FireShapeKind = "flame" | "glow" | "smoke" | "dot";

export interface FireShape {
  kind: FireShapeKind;
  x: number;
  y: number;
  radius: number;
  /** A flame polygon in screen pixels, flattened x,y pairs. */
  points?: number[];
  alpha: number;
  color: number;
}

export interface FireVisualPlan {
  band: FireZoomBand;
  layer: "shipEffects";
  strength: number;
  shapes: FireShape[];
}

export interface FireVisualInput {
  screenX: number;
  screenY: number;
  /** Shorter side of the view, in pixels. */
  viewportPx: number;
  kmAcross: number;
  strength: number;
  headingRad: number;
  windFromDeg: number;
  timeMs: number;
  seed?: string | number;
}

const DEG = Math.PI / 180;

function hashSeed(value: string | number | undefined): number {
  const text = String(value ?? "fire");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash % 997) / 997;
}

function strengthShare(strength: number): number {
  return Math.max(0, Math.min(1, strength / 100));
}

/** A pointed, flickering flame polygon. */
function flamePoints(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  flicker: number,
): number[] {
  const lean = (flicker - 0.5) * width * 0.7;
  const local: Array<[number, number]> = [
    [-width * 0.5, height * 0.42],
    [-width * 0.28, -height * 0.08],
    [lean, -height * 0.55],
    [width * 0.28, -height * 0.08],
    [width * 0.5, height * 0.42],
    [0, height * 0.28],
  ];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const flat: number[] = [];
  for (const [lx, ly] of local) {
    flat.push(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
  }
  return flat;
}

/**
 * Fire ink for one ship at any zoom. Ships this size are a fixed 23 px hull,
 * so the effect deliberately keeps a readable minimum rather than shrinking
 * to nothing when the chart is far out.
 */
export function fireVisualPlan(input: FireVisualInput): FireVisualPlan {
  const strength = Math.max(0, Math.min(100, input.strength));
  const share = strengthShare(strength);
  const seed = hashSeed(input.seed);
  const phase = ((input.timeMs / 1000) * settings.effects.flickerHz + seed * 7) % 1;
  const viewport = Math.max(1, input.viewportPx);
  const scale = viewport / Math.max(0.001, input.kmAcross);
  const heading = input.headingRad;
  const forwardX = Math.sin(heading);
  const forwardY = -Math.cos(heading);
  const rightX = Math.cos(heading);
  const rightY = Math.sin(heading);
  const downwind = (input.windFromDeg + 180) * DEG;
  const driftX = Math.sin(downwind);
  const driftY = -Math.cos(downwind);
  const shapes: FireShape[] = [];

  if (input.kmAcross <= settings.effects.closeZoomMaxKm) {
    const count = Math.round(
      settings.effects.closeFlameCountMin +
      (settings.effects.closeFlameCountMax - settings.effects.closeFlameCountMin) * share,
    );
    const deckPx = Math.max(24, Math.min(92, scale * 0.085));
    for (let index = 0; index < count; index += 1) {
      const t = count === 1 ? 0 : index / (count - 1) - 0.5;
      const along = t * deckPx * 0.86;
      const side = ((index % 2 === 0 ? 1 : -1) * deckPx) * 0.1;
      const flicker = 0.5 + 0.5 * Math.sin(
        phase * Math.PI * 2 + index * 2.1 + seed * Math.PI,
      );
      const height = Math.max(
        settings.effects.closeFlameMinPx,
        deckPx * (0.11 + 0.1 * share) * (0.7 + flicker * 0.55),
      );
      const width = height * (0.42 + share * 0.16);
      shapes.push({
        kind: "flame",
        x: input.screenX + forwardX * along + rightX * side,
        y: input.screenY + forwardY * along + rightY * side,
        radius: height * 0.5,
        points: flamePoints(
          input.screenX + forwardX * along + rightX * side,
          input.screenY + forwardY * along + rightY * side,
          width,
          height,
          heading,
          flicker,
        ),
        alpha: settings.effects.flameAlphaMin +
          (settings.effects.flameAlphaMax - settings.effects.flameAlphaMin) *
          (0.35 + flicker * 0.65),
        color: index % 3 === 1 ? 0xd52b1b : index % 3 === 2 ? 0xffb02e : 0xef5a1d,
      });
    }
    for (let puff = 0; puff < settings.effects.smokePuffs; puff += 1) {
      const distance = 8 + puff * settings.effects.smokeDriftPx * 0.55;
      shapes.push({
        kind: "smoke",
        x: input.screenX + driftX * distance + rightX * puff * 2,
        y: input.screenY + driftY * distance + forwardY * 4,
        radius: 4 + puff * 2.5 + share * 3,
        alpha: settings.effects.smokeAlpha * (1 - puff * 0.2),
        color: 0x34383a,
      });
    }
  } else if (input.kmAcross <= settings.effects.midZoomMaxKm) {
    const radius = settings.effects.midGlowMinPx +
      (settings.effects.midGlowMaxPx - settings.effects.midGlowMinPx) * share;
    shapes.push({
      kind: "glow",
      x: input.screenX,
      y: input.screenY,
      radius,
      alpha: settings.effects.midGlowAlpha,
      color: 0xe8581c,
    });
    shapes.push({
      kind: "glow",
      x: input.screenX,
      y: input.screenY,
      radius: radius * 0.55,
      alpha: 0.78,
      color: 0xffa632,
    });
    for (let puff = 0; puff < 2; puff += 1) {
      shapes.push({
        kind: "smoke",
        x: input.screenX + driftX * (10 + puff * 11),
        y: input.screenY + driftY * (10 + puff * 11),
        radius: 5 + puff * 3,
        alpha: settings.effects.smokeAlpha * (1 - puff * 0.25),
        color: 0x34383a,
      });
    }
  } else {
    const pulse = 0.5 + 0.5 * Math.sin(
      (input.timeMs / 1000) * settings.effects.farDotPulseHz * Math.PI * 2 + seed * 6,
    );
    shapes.push({
      kind: "dot",
      x: input.screenX,
      y: input.screenY,
      radius: settings.effects.farDotDiameterPx / 2 * (0.9 + share * 0.2),
      alpha: settings.effects.farDotAlphaMin +
        (settings.effects.farDotAlphaMax - settings.effects.farDotAlphaMin) * pulse,
      color: 0xf06a1f,
    });
    shapes.push({
      kind: "glow",
      x: input.screenX,
      y: input.screenY,
      radius: settings.effects.farDotDiameterPx * 1.2,
      alpha: 0.22,
      color: 0xe8581c,
    });
  }

  return {
    band: input.kmAcross <= settings.effects.closeZoomMaxKm
      ? "close"
      : input.kmAcross <= settings.effects.midZoomMaxKm ? "mid" : "far",
    layer: "shipEffects",
    strength,
    shapes,
  };
}

/** The fire shapes that must read as fire, rather than trailing smoke. */
export function brightFireShapes(plan: FireVisualPlan): FireShape[] {
  return plan.shapes.filter((shape) =>
    (shape.kind === "flame" || shape.kind === "dot" || shape.kind === "glow") &&
    shape.alpha > 0.5,
  );
}

export interface GalleryEffect {
  id: string;
  name: string;
  /** Optional fire strength for the three fire entries. */
  strength?: number;
}

export const EFFECT_GALLERY: readonly GalleryEffect[] = [
  { id: "fire-full", name: "Fire, full strength", strength: 100 },
  { id: "fire-mid", name: "Fire, medium", strength: 60 },
  { id: "fire-light", name: "Fire, light", strength: 30 },
  { id: "smoke", name: "Smoke" },
  { id: "ignition", name: "Ignition flash" },
  { id: "splash", name: "Splash" },
  { id: "hit", name: "Hit flash" },
  { id: "damage-smoke", name: "Damage smoke" },
  { id: "tow", name: "Tow rope" },
  { id: "white-flag", name: "White flag" },
  { id: "lantern", name: "Lantern glow" },
  { id: "pennant", name: "Flagship pennant" },
];

export interface GalleryFrame {
  index: number;
  effect: GalleryEffect;
  elapsedMs: number;
  remainingMs: number;
}

/** Six real seconds per named effect, cycling forever. */
export function galleryFrame(elapsedMs: number): GalleryFrame {
  const cycle = settings.effects.gallerySeconds * 1_000;
  const safe = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const index = Math.floor(safe / cycle) % EFFECT_GALLERY.length;
  const within = safe % cycle;
  return {
    index,
    effect: EFFECT_GALLERY[index]!,
    elapsedMs: within,
    remainingMs: cycle - within,
  };
}

export interface LightsRingPlan {
  shown: boolean;
  radiusKm: number;
  label: string;
}

/** The faint spotting ring only at night, only with the ship's lights off. */
export function lightsRingPlan(night: boolean, lightsOn: boolean): LightsRingPlan {
  return {
    shown: night && !lightsOn,
    radiusKm: settings.ships.fireShips.nightLightsOffSpotRangeKm,
    label: settings.effects.lightsRingLabel,
  };
}
