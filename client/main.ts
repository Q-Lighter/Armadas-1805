// Client entry point for the style test page. It shows the game name and build
// line from shared/ and remembers the reader's chosen UI size.

import { BUILD_NOTE, BUILD_TAG, GAME_NAME } from "@naval/shared";

type UiSize = "small" | "medium" | "large";

const UI_SIZE_KEY = "armadas.uiSize";
const buildLine = `Build ${BUILD_TAG}: ${BUILD_NOTE}`;

function readSavedSize(): UiSize {
  try {
    const saved = localStorage.getItem(UI_SIZE_KEY);
    if (saved === "small" || saved === "medium" || saved === "large") {
      return saved;
    }
  } catch {
    // Storage can be blocked; medium is a safe fallback.
  }
  return "medium";
}

function setUiSize(size: UiSize): void {
  document.documentElement.dataset.uiSize = size;
  try {
    localStorage.setItem(UI_SIZE_KEY, size);
  } catch {
    // Remembering the choice is optional.
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-size]")) {
    button.setAttribute("aria-pressed", String(button.dataset.size === size));
  }
}

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
setUiSize(readSavedSize());

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-size]")) {
  button.addEventListener("click", () => {
    const size = button.dataset.size;
    if (size === "small" || size === "medium" || size === "large") {
      setUiSize(size);
    }
  });
}
