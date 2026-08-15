/** Whether a sidebar width is worth writing to storage.
 *
 * The panel library reports a resize for any layout change, including the
 * proportional reflow that follows a window resize. Persisting those would let
 * the remembered width drift every time the window changed size, so only a
 * direct pointer/keyboard drag counts — and never a collapsed (zero) width,
 * which is tracked separately. */
export function shouldPersistSidebarWidth(
  width: number,
  isUserInteraction: boolean,
): boolean {
  return isUserInteraction && width > 0;
}
