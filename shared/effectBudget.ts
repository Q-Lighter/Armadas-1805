// Keep only effects that are on screen, newest first, up to a fixed budget.
// The client copies the result back into its live array, so this allocates only
// the returned list (tests and non-frame callers can use it directly).

export function selectVisibleEffects<T>(
  effects: readonly T[],
  isVisible: (effect: T) => boolean,
  limit = 150,
): T[] {
  const max = Math.max(0, Math.floor(limit));
  const out: T[] = [];
  for (let index = effects.length - 1; index >= 0 && out.length < max; index -= 1) {
    const effect = effects[index]!;
    if (isVisible(effect)) out.push(effect);
  }
  out.reverse();
  return out;
}
