import type { IMarker, Terminal } from "@xterm/xterm";

/**
 * Cross-handler state shared between the OSC 7 cwd handler and the OSC 133
 * prompt-marker handler. Tracks whether we are currently inside a running
 * command (between OSC 133 B and the next OSC 133 D / A), so the cwd handler
 * can ignore OSC 7 updates emitted by *command output* (e.g. a remote SSH
 * server, a `cat` of an attacker-controlled file). Only OSC 7 issued by the
 * local shell — which fires between commands — should be honored.
 */
export type ShellIntegrationState = {
  inCommand: boolean;
};

export function createShellIntegrationState(): ShellIntegrationState {
  return { inCommand: false };
}

export function registerCwdHandler(
  term: Terminal,
  onCwd: (cwd: string) => void,
  state?: ShellIntegrationState,
): () => void {
  const d = term.parser.registerOscHandler(7, (data) => {
    // Reject OSC 7 emitted while a command is running: command stdout/stderr
    // is untrusted (it can come from a remote shell, an SSH session, a `cat`
    // of attacker-controlled bytes). The local shell only emits OSC 7
    // between commands via its precmd/PROMPT_COMMAND hook.
    if (state?.inCommand) return true;
    const cwd = parseOsc7(data);
    if (cwd) onCwd(cwd);
    return true;
  });
  return () => d.dispose();
}

export type PromptTracker = {
  getMarker: () => IMarker | null;
  dispose: () => void;
};

/** A completed command, surfaced on the OSC 133 D marker. */
export interface CommandRecord {
  /** Command text, when the shell reports it (OSC 133 C;<cmd>). May be empty. */
  command: string;
  /** Exit status from OSC 133 D;<code>, when present. */
  exitCode: number | null;
  /** Wall-clock duration between the C and D markers, in ms. */
  durationMs: number | null;
}

/** Strip the leading marker letter and optional `;` from OSC 133 payloads. */
export function parseOsc133Field(data: string): string {
  const semi = data.indexOf(";");
  return semi === -1 ? "" : data.slice(semi + 1);
}

export function registerPromptTracker(
  term: Terminal,
  state?: ShellIntegrationState,
  onCommand?: (cmd: CommandRecord) => void,
): PromptTracker {
  let marker: IMarker | null = null;
  let pendingCommand = "";
  let commandStart: number | null = null;
  const d = term.parser.registerOscHandler(133, (data) => {
    // OSC 133 A — start of new prompt (between commands).
    if (data.startsWith("A")) {
      if (state) state.inCommand = false;
      marker?.dispose();
      marker = term.registerMarker(0);
    } else if (data.startsWith("B")) {
      // OSC 133 B — command begins. From here on, treat all output as
      // untrusted until we see D (command exit) or the next A (new prompt).
      if (state) state.inCommand = true;
    } else if (data.startsWith("C")) {
      // OSC 133 C — command pre-execution marker; still inside command. Some
      // shells (fish) include the command text as C;<cmd>.
      if (state) state.inCommand = true;
      const cmd = parseOsc133Field(data);
      if (cmd) pendingCommand = cmd;
      commandStart = Date.now();
    } else if (data.startsWith("D")) {
      // OSC 133 D — command ends; D;<code> carries the exit status.
      if (state) state.inCommand = false;
      if (onCommand) {
        const codeStr = parseOsc133Field(data);
        const exitCode = codeStr === "" ? null : Number.parseInt(codeStr, 10);
        onCommand({
          command: pendingCommand,
          exitCode: Number.isNaN(exitCode as number) ? null : exitCode,
          durationMs: commandStart === null ? null : Date.now() - commandStart,
        });
      }
      pendingCommand = "";
      commandStart = null;
    }
    return true;
  });
  return {
    getMarker: () => (marker && !marker.isDisposed ? marker : null),
    dispose: () => {
      d.dispose();
      marker?.dispose();
      marker = null;
    },
  };
}

function parseOsc7(data: string): string | null {
  const m = data.match(/^file:\/\/[^/]*(\/.*)$/);
  if (!m) return null;
  let path = m[1];
  try {
    path = decodeURIComponent(path);
  } catch {}
  // Strip Windows extended-length path prefix that survives the backslash→slash
  // conversion when profile.ps1's StartsWith check doesn't fire:
  //   \\?\C:\Users\foo  →  //?/C:/Users/foo  (after \→/ and decode)
  if (path.startsWith("//?/")) path = path.slice(4);
  // /C:/Users/foo -> C:/Users/foo so it's a valid Windows path.
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return path;
}
