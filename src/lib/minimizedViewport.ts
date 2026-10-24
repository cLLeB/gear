// Minimizing on Windows doesn't hide the webview: it lays the page out at the
// minimized frame's size (about 231×26), and panes inside it at 0 height.
// Anything that measures the viewport and keeps the result (terminal grids,
// collapsible panels, floating window geometry) would store that squashed
// layout and keep it after restore. The window's minimum size (420×280 in
// tauri.conf.json) can't produce a viewport this short, so a short viewport
// means "minimized": skip the measurement and wait for the real size.
const MIN_REAL_VIEWPORT_HEIGHT = 120;

export function isMinimizedViewport(): boolean {
  return window.innerHeight < MIN_REAL_VIEWPORT_HEIGHT;
}
