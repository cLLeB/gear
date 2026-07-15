/**
 * Split a command line into argv tokens the way a POSIX shell would, honouring
 * single quotes (literal), double quotes (allowing \" and \\), and backslash
 * escapes outside quotes. Does not perform expansion — just tokenisation.
 */
export function parseArgv(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let hasToken = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (ch === "'") {
      hasToken = true;
      i += 1;
      while (i < line.length && line[i] !== "'") current += line[i++];
      i += 1; // closing quote
    } else if (ch === '"') {
      hasToken = true;
      i += 1;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\" && (line[i + 1] === '"' || line[i + 1] === "\\")) {
          current += line[i + 1];
          i += 2;
        } else {
          current += line[i++];
        }
      }
      i += 1;
    } else if (ch === "\\") {
      hasToken = true;
      if (i + 1 < line.length) current += line[i + 1];
      i += 2;
    } else if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      i += 1;
    } else {
      hasToken = true;
      current += ch;
      i += 1;
    }
  }

  if (hasToken) tokens.push(current);
  return tokens;
}
