export interface ExpandEnvOptions {
  /** Value used for variables missing from the map. Defaults to "" (empty). */
  fallback?: string;
  /** Keep the original token (e.g. "$FOO") when unset instead of fallback. */
  keepUnset?: boolean;
}

/**
 * Expand $VAR and ${VAR} references in a string from a variable map. Escaped
 * "\$" is left as a literal dollar sign.
 */
export function expandEnvVars(
  input: string,
  env: Record<string, string | undefined>,
  options: ExpandEnvOptions = {},
): string {
  const { fallback = "", keepUnset = false } = options;

  return input.replace(
    /\\\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (match, braced?: string, bare?: string) => {
      if (match === "\\$") return "$";
      const name = braced ?? bare;
      const value = env[name!];
      if (value !== undefined) return value;
      return keepUnset ? match : fallback;
    },
  );
}
