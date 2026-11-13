// A draw layer is isolated so one bad layer cannot stop the rest of the scene.
export function runDrawLayer(
  draw: () => void,
  onError: (error: unknown) => void,
): boolean {
  try {
    draw();
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}
