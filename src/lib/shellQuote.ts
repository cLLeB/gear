import { IS_WINDOWS } from "./platform";

export function quoteShellArg(value: string, windows = IS_WINDOWS): string {
  if (windows) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Quote an argument only when the shell would read it as anything but one plain word.
 * A comma is never plain: PowerShell turns `-L5,9:file` into an array of two arguments.
 */
export function shellWord(value: string, windows = IS_WINDOWS): string {
  return /^[\w%+=:./-][\w@%+=:./-]*$/.test(value) ? value : quoteShellArg(value, windows);
}
