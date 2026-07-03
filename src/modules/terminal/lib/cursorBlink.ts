export function shouldCursorBlink(
  blinkEnabled: boolean,
  windowActive: boolean,
  // Retained for call-site compatibility. Blink no longer depends on per-slot
  // focus: the setting is meant to be immediately visible when toggled, and
  // gating on a focus-adapter signal made it appear to do nothing.
  _slotFocused: boolean,
): boolean {
  return blinkEnabled && windowActive;
}
