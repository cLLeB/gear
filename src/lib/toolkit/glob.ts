export interface GlobOptions {
  /** Treat "/" as a boundary that "*" cannot cross. Defaults to true. */
  pathMode?: boolean;
  /** Case-insensitive matching. Defaults to false. */
  nocase?: boolean;
}

/**
 * Compile a glob pattern into a RegExp. Supports `*`, `**`, `?`, and character
 * classes `[...]`. In path mode, `*` stops at "/" while `**` spans directories.
 */
export function globToRegExp(pattern: string, options: GlobOptions = {}): RegExp {
  const { pathMode = true, nocase = false } = options;
  let re = "";
  let i = 0;

  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 2;
        if (pattern[i] === "/") i += 1; // consume trailing slash of **/
      } else {
        re += pathMode ? "[^/]*" : ".*";
        i += 1;
      }
    } else if (c === "?") {
      re += pathMode ? "[^/]" : ".";
      i += 1;
    } else if (c === "[") {
      let cls = "[";
      i += 1;
      if (pattern[i] === "!") {
        cls += "^";
        i += 1;
      }
      while (i < pattern.length && pattern[i] !== "]") {
        const ch = pattern[i];
        cls += /[\\^\]]/.test(ch) ? `\\${ch}` : ch;
        i += 1;
      }
      cls += "]";
      i += 1;
      re += cls;
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }

  return new RegExp(`^${re}$`, nocase ? "i" : "");
}

/** Test whether a path matches a glob pattern. */
export function matchGlob(pattern: string, path: string, options?: GlobOptions): boolean {
  return globToRegExp(pattern, options).test(path);
}
