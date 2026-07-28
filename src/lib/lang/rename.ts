// Scope-safe rename. A find-and-replace on a name is dangerous: it hits
// shadowed bindings in other scopes, property keys, and matches inside strings
// and comments. This computes a correct rename by reusing the reference engine —
// which already resolves each occurrence to its binding — so only the true uses
// of the symbol under the cursor are edited. It validates the new identifier and
// refuses renames that would collide with an existing binding in the same scope,
// returning a WorkspaceEdit the editor can apply atomically.

import { getLanguageSpec } from "./languages";
import { tokenize, type Token } from "./lexer";
import { findDefinition, findReferences } from "./references";
import { buildScopeTree, scopeAt } from "./scopes";

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

export interface WorkspaceEdit {
  edits: TextEdit[];
}

export interface PrepareRename {
  from: number;
  to: number;
  placeholder: string;
}

export type RenameError = { error: string };

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function identifierAt(tokens: Token[], offset: number): Token | null {
  for (const t of tokens) {
    if (t.type === "identifier" && offset >= t.start && offset <= t.end) return t;
  }
  return null;
}

function isKeyword(name: string, languageId: string): boolean {
  const spec = getLanguageSpec(languageId);
  return spec?.lexer.keywords?.has(name) ?? false;
}

/**
 * Validate that a rename can start at `offset` and report the range and current
 * name (the placeholder an editor pre-fills in its rename box).
 */
export function prepareRename(source: string, languageId: string, offset: number): PrepareRename | RenameError {
  const spec = getLanguageSpec(languageId);
  if (!spec) return { error: "Language not analyzable" };
  const tokens = tokenize(source, spec.lexer);
  const tok = identifierAt(tokens, offset);
  if (!tok) return { error: "Not on a renameable identifier" };
  const def = findDefinition(source, languageId, offset);
  if (!def) return { error: "Cannot resolve symbol to a binding" };
  return { from: tok.start, to: tok.end, placeholder: tok.value };
}

/**
 * Compute a WorkspaceEdit that renames the symbol at `offset` to `newName`, or
 * an error describing why the rename is unsafe.
 */
export function computeRename(
  source: string,
  languageId: string,
  offset: number,
  newName: string,
): WorkspaceEdit | RenameError {
  if (!IDENT_RE.test(newName)) return { error: `"${newName}" is not a valid identifier` };
  if (isKeyword(newName, languageId)) return { error: `"${newName}" is a reserved keyword` };

  const prepared = prepareRename(source, languageId, offset);
  if ("error" in prepared) return prepared;
  if (prepared.placeholder === newName) return { edits: [] };

  const occurrences = findReferences(source, languageId, offset);
  if (occurrences.length === 0) return { error: "No references found to rename" };

  const collision = detectCollision(source, languageId, offset, newName, occurrences.map((o) => o.from));
  if (collision) return { error: collision };

  const edits = occurrences
    .map((o) => ({ from: o.from, to: o.to, insert: newName }))
    .sort((a, b) => a.from - b.from);
  return { edits };
}

/**
 * A collision exists when `newName` already names a binding in the scope that
 * owns the symbol, or in any scope that encloses one of the occurrences (which
 * would cause the renamed uses to resolve to the wrong declaration).
 */
function detectCollision(
  source: string,
  languageId: string,
  offset: number,
  newName: string,
  occurrenceOffsets: number[],
): string | null {
  const root = buildScopeTree(source, languageId);
  const def = findDefinition(source, languageId, offset);
  if (!def) return null;

  // Same-scope collision: the owning scope already declares `newName`.
  const owningScope = scopeAt(root, def.offset);
  if (owningScope.bindings.has(newName)) {
    return `"${newName}" is already declared in this scope`;
  }

  // Capture collision: an occurrence sits in a nested scope that declares
  // `newName`, so after rename the use would bind to that inner declaration.
  for (const occ of occurrenceOffsets) {
    let s = scopeAt(root, occ);
    while (s && s !== owningScope) {
      if (s.bindings.has(newName)) return `Renaming to "${newName}" would be shadowed by an inner declaration`;
      s = s.parent as typeof s;
    }
  }
  return null;
}

/** Apply a WorkspaceEdit to source text (edits must be non-overlapping). */
export function applyWorkspaceEdit(source: string, edit: WorkspaceEdit): string {
  const sorted = [...edit.edits].sort((a, b) => b.from - a.from); // right-to-left
  let out = source;
  for (const e of sorted) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}
