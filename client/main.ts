// Client entry point. For now it only shows the game name and build line from
// shared/, which proves the browser page is built from the shared game code.

import { BUILD_NOTE, BUILD_TAG, GAME_NAME } from "@naval/shared";

const buildLine = `Build ${BUILD_TAG}: ${BUILD_NOTE}`;

function showPageText(): void {
  const heading = document.querySelector<HTMLElement>("#game-name");
  const build = document.querySelector<HTMLElement>("#build-label");

  if (heading) {
    heading.textContent = GAME_NAME;
  }
  if (build) {
    build.textContent = buildLine;
  }
  document.title = `${GAME_NAME} - ${buildLine}`;
}

showPageText();
