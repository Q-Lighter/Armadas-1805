// The server's land lookup: answers "is this map point land?" in constant time.
//
// The data is a one-bit-per-cell mask built by `npm run build-map` from Natural
// Earth 1:10m land. It is generated into shared/data/landMask.ts. The mask is
// run-length encoded and base64 text so the Worker bundle stays small; it is
// decoded once when this module loads.

import { settings } from "./settings.js";
import { MAP_HEIGHT_KM, MAP_WIDTH_KM } from "./map.js";
import { LAND_MASK } from "./data/landMask.js";

const cellKm = LAND_MASK.cellKm;
const width = LAND_MASK.width;
const height = LAND_MASK.height;
const totalCells = width * height;

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const bits = decodeMask(LAND_MASK.runsBase64, totalCells);

/** Decode base64 without relying on browser or Node globals. */
function decodeBase64(text: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let byte = 0;
  let buffer = 0;
  let held = 0;

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i]!;
    if (character === "=") break;
    const value = BASE64.indexOf(character);
    if (value < 0) continue;

    buffer = (buffer << 6) | value;
    held += 6;
    if (held >= 8) {
      held -= 8;
      bytes[byte] = (buffer >> held) & 0xff;
      byte += 1;
    }
  }

  return bytes.subarray(0, byte);
}

/** Read an unsigned LEB128 number from a byte array. */
function readVarint(bytes: Uint8Array, cursor: { at: number }): number {
  let value = 0;
  let scale = 1;

  for (;;) {
    const byte = bytes[cursor.at];
    if (byte === undefined) throw new Error("land mask ended mid-run");
    cursor.at += 1;
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return value;
    scale *= 128;
  }
}

/** Turn alternating sea/land run lengths into a packed bit mask. */
function decodeMask(runsBase64: string, cells: number): Uint8Array {
  const runs = decodeBase64(runsBase64);
  const packed = new Uint8Array(Math.ceil(cells / 8));
  const cursor = { at: 0 };
  let cell = 0;
  let isLand = false;

  while (cell < cells) {
    const run = readVarint(runs, cursor);
    if (!Number.isFinite(run) || run < 0) throw new Error("bad land mask run");

    if (isLand) {
      const end = Math.min(cells, cell + run);
      for (let index = cell; index < end; index += 1) {
        packed[index >> 3]! |= 1 << (index & 7);
      }
    }

    cell += run;
    isLand = !isLand;
  }

  return packed;
}

/** True when a map point is land, within the lookup's one-kilometre cells. */
export function isLandAt(xKm: number, yKm: number): boolean {
  if (!(xKm >= 0 && xKm < MAP_WIDTH_KM && yKm >= 0 && yKm < MAP_HEIGHT_KM)) {
    return false;
  }

  const x = Math.floor(xKm / cellKm);
  const y = Math.floor(yKm / cellKm);
  if (x < 0 || x >= width || y < 0 || y >= height) return false;

  const index = y * width + x;
  return (bits[index >> 3]! & (1 << (index & 7))) !== 0;
}

/** True when a map point is water inside the chart frame. */
export function isSeaAt(xKm: number, yKm: number): boolean {
  return !isLandAt(xKm, yKm);
}

/** The grid the lookup uses, for tests and documentation. */
export const landLookup = {
  width,
  height,
  cellKm,
  /** Bytes of the unpacked one-bit-per-cell mask. */
  rawBytes: Math.ceil(totalCells / 8),
  /** The cell used by the lookup, from settings. */
  configuredCellKm: settings.map.landCellKm,
} as const;
