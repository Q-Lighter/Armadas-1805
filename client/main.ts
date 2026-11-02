// Client entry point. For now it only shows the build label from shared/,
// which proves the browser page is built from the shared game code.

import { BUILD_TAG, GAME_NAME } from "@naval/shared";

const label = `${GAME_NAME}: build ${BUILD_TAG}`;

function showBuildLabel(): void {
  const heading = document.querySelector<HTMLElement>("#build-label");
  if (heading) {
    heading.textContent = label;
  }
  document.title = label;
}

showBuildLabel();
