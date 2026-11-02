// Server entry point. The real game world will run here, and this file will
// later become the Cloudflare Worker handler. For now it only reports that the
// server package builds and can use the shared code.

import { BUILD_TAG, GAME_NAME } from "@naval/shared";

export interface ServerStatus {
  readonly game: string;
  readonly build: string;
  readonly worldLoaded: boolean;
}

/** A placeholder status, so later code has a known shape to start from. */
export function serverStatus(): ServerStatus {
  return {
    game: GAME_NAME,
    build: BUILD_TAG,
    worldLoaded: false,
  };
}

console.log(`${GAME_NAME}: server placeholder (build ${BUILD_TAG}). No game world yet.`);
