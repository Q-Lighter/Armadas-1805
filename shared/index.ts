// Shared game code: rules and data that both the client and the server use.
// Everything in this folder must be plain TypeScript, so it can run anywhere.

export * from "./settings.js";

/** The name shown to players. */
export const GAME_NAME = "Armada's 1805";

/** The current build label, used by the placeholder page and the server. */
export const BUILD_TAG = "0B";

/** What this build is for, shown under the game name. */
export const BUILD_NOTE = "deployment test";
