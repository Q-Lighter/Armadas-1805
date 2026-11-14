// 3H sailing overhaul: automatic square-rig manoeuvres.
//
// The helm never turns a ship in place. A big course change under way is made
// as a tack, a wear, a box-haul, or (in port waters) a warp. The same helpers
// are used by the real ship, the route ghost and the tests.

import { settings } from "./settings.js";
import type { ShipClassId } from "./data/ships.js";

const DEG = Math.PI / 180;

export type ManoeuvreKind = "tack" | "wear" | "boxHaul" | "irons" | "warp";
export type ManoeuvrePhase = "turnToWind" | "turnDownwind" | "sternway" | "payOff";

export interface ManoeuvreState {
  kind: ManoeuvreKind;
  phase: ManoeuvrePhase;
  /** The course the helm wants when the manoeuvre has finished. */
  finalHeadingRad: number;
  /** Game seconds spent in the current phase. */
  phaseSeconds: number;
  /** A tack that missed stays ends in irons. */
  missed: boolean;
  /** Distance of sternway still to run, in km. */
  sternwayLeftKm: number;
}

export interface ManoeuvreInput {
  state: ManoeuvreState | undefined;
  classId: ShipClassId;
  headingRad: number;
  desiredHeadingRad: number;
  speedKnots: number;
  windFromDeg: number;
  dtGameSeconds: number;
  sailsPercent: number;
  mastsPercent: number;
  rudderPercent: number;
  crewPercent: number;
  closestAngleDeg: number;
  portWater: boolean;
  confined: boolean;
  coastDownwind: boolean;
  towing?: boolean;
  random: () => number;
}

export interface ManoeuvreOutput {
  state: ManoeuvreState | undefined;
  /** Heading the helm should steer this tick. */
  headingRad: number;
  /** Lower the normal sail speed to this share (1 = no change). */
  speedShare: number;
  /** An explicit speed for backing sails or warping, in knots. */
  speedKnots?: number;
  /** Negative travel is sternway. */
  travelSign: 1 | -1;
  /** True when the manoeuvre ended this tick. */
  finished: boolean;
  label: string | null;
}

export function shortestTurnDegrees(fromRad: number, toRad: number): number {
  let degrees = ((toRad - fromRad) / DEG) % 360;
  if (degrees > 180) degrees -= 360;
  if (degrees <= -180) degrees += 360;
  return degrees;
}

/** The rudder bites only with way on; below steerage the turn rate falls off. */
export function steerageTurnFactor(speedKnots: number): number {
  const steerage = settings.manoeuvres.steerageSpeedKnots;
  if (!(speedKnots > 0.001) || !(steerage > 0)) return 0;
  return Math.max(0, Math.min(1, speedKnots / steerage));
}

/** A ship shortens sail near a coast or in a narrow channel. */
export function shortenedSailSpeedShare(nearCoast: boolean, narrowChannel: boolean): number {
  return nearCoast || narrowChannel
    ? settings.manoeuvres.shortenSailSpeedShare
    : 1;
}

/** How likely a tack is to miss stays, from damage and wind strength. */
export function missStaysChance(
  sailsPercent: number,
  mastsPercent: number,
  rudderPercent: number,
  windSpeedKnots: number = settings.weather.windStrengthKnots,
): number {
  const M = settings.manoeuvres;
  const rig = Math.min(sailsPercent, mastsPercent, rudderPercent);
  const rigPenalty = Math.max(0, 100 - rig) / 100 * M.missedStaysDamageShare;
  const windPenalty = Math.max(
    0,
    windSpeedKnots - M.missedStaysCalmKnots,
  ) * M.missedStaysPerKnot;
  return Math.max(0, Math.min(M.missedStaysMaxChance, M.missedStaysBaseChance + rigPenalty + windPenalty));
}

/** True when the shorter turn from current to desired crosses the wind. */
export function turnPassesThroughWind(
  headingRad: number,
  desiredHeadingRad: number,
  windFromDeg: number,
): boolean {
  const change = shortestTurnDegrees(headingRad, desiredHeadingRad);
  const toWind = shortestTurnDegrees(headingRad, windFromDeg * DEG);
  if (Math.abs(change) < 1e-6) return false;
  // Exactly head to wind: the bow goes through the eye at once.
  if (Math.abs(toWind) < 1e-6) return true;
  return Math.sign(change) === Math.sign(toWind) && Math.abs(toWind) <= Math.abs(change);
}

/**
 * Pick the manoeuvre for a big course change. This is a pure decision; the
 * caller gives the ghost a chance to reject it later.
 */
export function chooseManoeuvre(input: ManoeuvreInput): ManoeuvreKind | "none" {
  const change = Math.abs(shortestTurnDegrees(input.headingRad, input.desiredHeadingRad));
  if (input.portWater) return "warp";
  const offWind = Math.abs(shortestTurnDegrees(input.headingRad, input.windFromDeg * DEG));
  if (
    input.towing &&
    input.speedKnots < settings.manoeuvres.steerageSpeedKnots &&
    offWind < input.closestAngleDeg
  ) {
    // A towed pair has no room to drift while it slowly pivots. Back the sails
    // and pay off just as a ship in irons would.
    return "irons";
  }
  if (change < settings.manoeuvres.largeTurnDeg) return "none";
  if (input.confined && input.coastDownwind) return "boxHaul";
  if (input.speedKnots < settings.manoeuvres.steerageSpeedKnots) return "irons";
  if (
    input.speedKnots < settings.manoeuvres.minTackSpeed ||
    input.sailsPercent < settings.manoeuvres.manoeuvreRigPercent ||
    input.mastsPercent < settings.manoeuvres.manoeuvreRigPercent ||
    input.rudderPercent < settings.manoeuvres.manoeuvreRigPercent ||
    input.crewPercent < settings.manoeuvres.manoeuvreCrewPercent
  ) {
    return "wear";
  }
  if (turnPassesThroughWind(input.headingRad, input.desiredHeadingRad, input.windFromDeg)) {
    return "tack";
  }
  return "wear";
}

export function manoeuvreLabel(kind: ManoeuvreKind | undefined): string | null {
  if (kind === "tack") return "Tacking";
  if (kind === "wear") return "Wearing";
  if (kind === "boxHaul") return "Box-hauling";
  if (kind === "irons") return "Backing sails (in irons)";
  if (kind === "warp") return "Warping";
  return null;
}

function newState(
  kind: ManoeuvreKind,
  desiredHeadingRad: number,
  missed: boolean,
): ManoeuvreState {
  const phase: ManoeuvrePhase = kind === "wear"
    ? "turnDownwind"
    : kind === "warp"
      ? "payOff"
      : kind === "irons"
        ? "sternway"
        : "turnToWind";
  const shipLengthKm = shipLengthKmFor(kind);
  return {
    kind,
    phase,
    finalHeadingRad: desiredHeadingRad,
    phaseSeconds: 0,
    missed,
    sternwayLeftKm: settings.manoeuvres.ironsSternwayLengths * shipLengthKm,
  };
}

function shipLengthKmFor(_kind: ManoeuvreKind): number {
  // All classes share the sternway geometry for now. The setting is a draft
  // hook for class-specific lengths in a later prompt.
  return settings.manoeuvres.referenceLengthM / 1000;
}

/** The current target heading for the active phase. */
function phaseHeadingRad(state: ManoeuvreState, windFromDeg: number, closestAngleDeg: number): number {
  const windRad = windFromDeg * DEG;
  if (state.kind === "warp") return state.finalHeadingRad;
  if (state.kind === "wear") {
    return state.phase === "turnDownwind" ? windRad + Math.PI : state.finalHeadingRad;
  }
  if (state.kind === "tack") {
    return state.phase === "turnToWind" ? windRad : state.finalHeadingRad;
  }
  if (state.kind === "boxHaul") {
    if (state.phase === "turnToWind" || state.phase === "sternway") return windRad;
    return state.finalHeadingRad;
  }
  // In irons: pay off on the nearer tack, not straight at the destination.
  if (state.phase === "payOff") {
    const side = shortestTurnDegrees(state.finalHeadingRad, windRad) >= 0 ? 1 : -1;
    return windRad + side * closestAngleDeg * DEG;
  }
  return state.finalHeadingRad;
}

/**
 * Advance the manoeuvre timers and return this tick's helm target. The caller
 * does the turning and moving with the normal stepShip code.
 */
export function advanceManoeuvre(input: ManoeuvreInput): ManoeuvreOutput {
  const M = settings.manoeuvres;
  let state = input.state;

  if (!state) {
    const kind = chooseManoeuvre(input);
    if (kind === "none") {
      return {
        state: undefined,
        headingRad: input.desiredHeadingRad,
        speedShare: shortenedSailSpeedShare(input.coastDownwind, input.confined),
        travelSign: 1,
        finished: false,
        label: shortenedSailSpeedShare(input.coastDownwind, input.confined) < 1
          ? "Shortening sail"
          : null,
      };
    }
    const missed = kind === "tack" &&
      input.random() < missStaysChance(
        input.sailsPercent,
        input.mastsPercent,
        input.rudderPercent,
      );
    state = newState(kind, input.desiredHeadingRad, missed);
  }

  state = { ...state, phaseSeconds: state.phaseSeconds + input.dtGameSeconds };
  let target = phaseHeadingRad(state, input.windFromDeg, input.closestAngleDeg);
  let speedShare = 1;
  let speedKnots: number | undefined;
  let travelSign: 1 | -1 = 1;
  let finished = false;
  const offTarget = Math.abs(shortestTurnDegrees(input.headingRad, target));

  if (state.kind === "warp") {
    if (!input.portWater) {
      // Leave port waters and the boats are recalled; the normal helm resumes.
      finished = true;
      speedShare = 1;
    } else {
      speedKnots = M.warpSpeedKnots;
      speedShare = 1;
    }
  } else if (state.kind === "tack") {
    if (state.phase === "turnToWind") {
      speedShare = M.tackSpeedShare;
      // Carry way through the eye of the wind even as the sails shake.
      speedKnots = Math.max(1.5, input.speedKnots * M.tackSpeedShare);
      const timeout = M.tackPhaseSeconds;
      if (offTarget <= M.phaseArrivalDeg || state.phaseSeconds >= timeout) {
        if (state.missed) {
          state = {
            ...state,
            kind: "irons",
            phase: "sternway",
            phaseSeconds: 0,
            sternwayLeftKm: M.ironsSternwayLengths * M.referenceLengthM / 1000,
          };
          target = state.finalHeadingRad;
          speedKnots = M.backingSailsKnots;
          travelSign = -1;
        } else {
          state = { ...state, phase: "payOff", phaseSeconds: 0 };
          target = state.finalHeadingRad;
          speedShare = M.tackPayOffSpeedShare;
        }
      }
    } else {
      speedShare = M.tackPayOffSpeedShare;
      if (offTarget <= M.phaseArrivalDeg) finished = true;
    }
  } else if (state.kind === "wear") {
    if (state.phase === "turnDownwind") {
      speedShare = M.wearSpeedShare;
      if (offTarget <= M.phaseArrivalDeg || state.phaseSeconds >= M.wearPhaseSeconds) {
        state = { ...state, phase: "payOff", phaseSeconds: 0 };
        target = state.finalHeadingRad;
      }
    } else {
      speedShare = M.wearSpeedShare;
      if (offTarget <= M.phaseArrivalDeg) finished = true;
    }
  } else if (state.kind === "boxHaul") {
    if (state.phase === "turnToWind") {
      speedShare = M.boxHaulSpeedShare;
      if (offTarget <= M.phaseArrivalDeg || state.phaseSeconds >= M.tackPhaseSeconds) {
        state = { ...state, phase: "sternway", phaseSeconds: 0 };
        speedKnots = M.backingSailsKnots;
        travelSign = -1;
      }
    } else if (state.phase === "sternway") {
      speedKnots = M.backingSailsKnots;
      travelSign = -1;
      const covered = M.backingSailsKnots * 1.852 * input.dtGameSeconds / 3600;
      const left = Math.max(0, state.sternwayLeftKm - covered);
      state = { ...state, sternwayLeftKm: left, phaseSeconds: state.phaseSeconds };
      if (left <= 1e-9 || state.phaseSeconds >= M.boxHaulSeconds) {
        state = { ...state, phase: "payOff", phaseSeconds: 0 };
        target = state.finalHeadingRad;
        speedShare = M.boxHaulSpeedShare;
      }
    } else {
      speedShare = M.boxHaulSpeedShare;
      if (offTarget <= M.phaseArrivalDeg) finished = true;
    }
  } else if (state.kind === "irons") {
    if (state.phase === "sternway") {
      speedKnots = M.backingSailsKnots;
      travelSign = -1;
      const covered = M.backingSailsKnots * 1.852 * input.dtGameSeconds / 3600;
      const left = Math.max(0, state.sternwayLeftKm - covered);
      state = { ...state, sternwayLeftKm: left };
      if (left <= 1e-9 || state.phaseSeconds >= M.ironsRecoverySeconds) {
        state = { ...state, phase: "payOff", phaseSeconds: 0 };
        target = phaseHeadingRad(state, input.windFromDeg, input.closestAngleDeg);
        speedShare = M.ironsPayOffSpeedShare;
      }
    } else {
      speedShare = M.ironsPayOffSpeedShare;
      // Carry a little way while paying off so the rudder can actually bite.
      speedKnots = Math.max(1, input.speedKnots * M.ironsPayOffSpeedShare);
      if (offTarget <= M.phaseArrivalDeg || state.phaseSeconds >= M.ironsRecoverySeconds) {
        finished = true;
      }
    }
  }

  if (finished) {
    return {
      state: undefined,
      // Recovering from irons pays off on the nearer tack; the normal helm
      // then resumes the destination from there.
      headingRad: state.kind === "irons"
        ? phaseHeadingRad(state, input.windFromDeg, input.closestAngleDeg)
        : state.finalHeadingRad,
      speedShare: 1,
      travelSign: 1,
      finished: true,
      label: manoeuvreLabel(state.kind),
    };
  }

  return {
    state,
    headingRad: target,
    speedShare,
    speedKnots,
    travelSign,
    finished: false,
    label: manoeuvreLabel(state.kind),
  };
}
