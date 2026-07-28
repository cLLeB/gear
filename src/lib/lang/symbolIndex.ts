// A workspace-wide symbol index — the data structure behind "Go to Symbol in
// Workspace" (Ctrl+T). It extracts the symbols of every open/known file and
// answers ranked fuzzy queries across all of them. To stay fast as the workspace
// grows it keeps a character-set inverted index: because a subsequence fuzzy
// match requires every query character to appear in the target, intersecting the
// posting lists of the query's characters yields a superset of all possible
// matches with no false negatives, and only that small candidate set is scored
// with the (more expensive) fuzzy ranker.

import { fuzzyFilter } from "./fuzzy";
import { extractSymbols, flattenSymbols, type SymbolKind } from "./symbols";

export interface SymbolEntry {
  path: string;
  name: string;
  kind: SymbolKind;
  from: number;
  to: number;
}

export interface SymbolHit extends SymbolEntry {
  score: number;
  /** Matched character positions within `name`, for highlight rendering. */
  positions: number[];
}

interface StoredEntry extends SymbolEntry {
  id: number;
  chars: Set<string>;
}

export class WorkspaceSymbolIndex {
  private entries = new Map<number, StoredEntry>();
  private byPath = new Map<string, number[]>();
  private byChar = new Map<string, Set<number>>();
  private nextId = 0;

  /** Number of indexed symbols. */
  get size(): number {
    return this.entries.size;
  }

  /** Index (or re-index) a file's symbols. Replaces any previous entries. */
  add(path: string, source: string, languageId: string): void {
    this.remove(path);
    const symbols = flattenSymbols(extractSymbols(source, languageId));
    const ids: number[] = [];
    for (const s of symbols) {
      const id = this.nextId++;
      const chars = new Set(s.name.toLowerCase());
      const entry: StoredEntry = { id, path, name: s.name, kind: s.kind, from: s.from, to: s.to, chars };
      this.entries.set(id, entry);
      ids.push(id);
      for (const c of chars) {
        const set = this.byChar.get(c) ?? new Set<number>();
        set.add(id);
        this.byChar.set(c, set);
      }
    }
    this.byPath.set(path, ids);
  }

  /** Drop every symbol previously indexed for `path`. */
  remove(path: string): void {
    const ids = this.byPath.get(path);
    if (!ids) return;
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      for (const c of entry.chars) {
        const set = this.byChar.get(c);
        if (set) { set.delete(id); if (set.size === 0) this.byChar.delete(c); }
      }
      this.entries.delete(id);
    }
    this.byPath.delete(path);
  }

  /** Symbols declared in a specific file, in declaration order. */
  symbolsIn(path: string): SymbolEntry[] {
    return (this.byPath.get(path) ?? [])
      .map((id) => this.entries.get(id))
      .filter((e): e is StoredEntry => e !== undefined)
      .map(strip);
  }

  /**
   * Ranked fuzzy search across all files. An empty query returns the first
   * `limit` symbols in insertion order.
   */
  search(query: string, limit = 50): SymbolHit[] {
    const q = query.trim();
    if (q === "") {
      return [...this.entries.values()].slice(0, limit).map((e) => ({ ...strip(e), score: 0, positions: [] }));
    }

    const candidates = this.candidateEntries(q.toLowerCase());
    const ranked = fuzzyFilter(q, candidates, (e) => e.name);
    return ranked.slice(0, limit).map((r) => ({ ...strip(r.item), score: r.score, positions: r.positions }));
  }

  /** Entries containing every character of the query (subsequence prerequisite). */
  private candidateEntries(lowerQuery: string): StoredEntry[] {
    const chars = [...new Set(lowerQuery.replace(/\s+/g, ""))];
    if (chars.length === 0) return [...this.entries.values()];

    // Intersect the smallest posting lists first.
    const postings = chars.map((c) => this.byChar.get(c) ?? new Set<number>());
    if (postings.some((p) => p.size === 0)) return [];
    postings.sort((a, b) => a.size - b.size);

    let acc = new Set(postings[0]);
    for (let i = 1; i < postings.length && acc.size > 0; i++) {
      const next = postings[i];
      acc = new Set([...acc].filter((id) => next.has(id)));
    }
    return [...acc].map((id) => this.entries.get(id)!).filter(Boolean);
  }
}

function strip(e: StoredEntry): SymbolEntry {
  return { path: e.path, name: e.name, kind: e.kind, from: e.from, to: e.to };
}
