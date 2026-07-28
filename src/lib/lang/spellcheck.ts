// A spell checker built on a trie with an efficient fuzzy-suggestion search.
// Rather than computing Levenshtein distance against every dictionary word, it
// walks the trie while maintaining a single dynamic-programming row of the edit
// matrix, pruning whole subtrees the moment their best possible distance
// exceeds the budget. It also splits code identifiers (camelCase, snake_case)
// so it can flag typos inside variable and function names.

import { splitWords } from "@/lib/toolkit/caseConvert";

interface TrieNode {
  children: Map<string, TrieNode>;
  word: string | null;
}

function makeNode(): TrieNode {
  return { children: new Map(), word: null };
}

export interface Suggestion {
  word: string;
  distance: number;
}

export class SpellChecker {
  private readonly root = makeNode();
  private readonly known = new Set<string>();

  constructor(words: Iterable<string> = []) {
    for (const word of words) this.add(word);
  }

  /** Add a word to the dictionary (stored case-folded). */
  add(word: string): void {
    const w = word.toLowerCase();
    if (!w || this.known.has(w)) return;
    this.known.add(w);
    let node = this.root;
    for (const ch of w) {
      let next = node.children.get(ch);
      if (!next) {
        next = makeNode();
        node.children.set(ch, next);
      }
      node = next;
    }
    node.word = w;
  }

  /** True when the word is in the dictionary (case-insensitive). */
  has(word: string): boolean {
    return this.known.has(word.toLowerCase());
  }

  /**
   * Suggest corrections within `maxDistance` edits, ranked by distance then
   * alphabetically. Uses the trie DP-row search for efficiency.
   */
  suggest(word: string, maxDistance = 2, limit = 5): Suggestion[] {
    const target = word.toLowerCase();
    const columns = target.length + 1;
    const firstRow = Array.from({ length: columns }, (_, i) => i);
    const results: Suggestion[] = [];

    for (const [ch, child] of this.root.children) {
      this.search(child, ch, target, firstRow, maxDistance, results);
    }

    return results
      .sort((a, b) => a.distance - b.distance || a.word.localeCompare(b.word))
      .slice(0, limit);
  }

  private search(
    node: TrieNode,
    letter: string,
    target: string,
    prevRow: number[],
    maxDistance: number,
    results: Suggestion[],
  ): void {
    const columns = target.length + 1;
    const currentRow = [prevRow[0] + 1];

    for (let col = 1; col < columns; col++) {
      const insertCost = currentRow[col - 1] + 1;
      const deleteCost = prevRow[col] + 1;
      const replaceCost = prevRow[col - 1] + (target[col - 1] === letter ? 0 : 1);
      currentRow.push(Math.min(insertCost, deleteCost, replaceCost));
    }

    const last = currentRow[columns - 1];
    if (last <= maxDistance && node.word !== null) {
      results.push({ word: node.word, distance: last });
    }

    // Prune: only descend if some cell is still within budget.
    if (Math.min(...currentRow) <= maxDistance) {
      for (const [ch, child] of node.children) {
        this.search(child, ch, target, currentRow, maxDistance, results);
      }
    }
  }

  /** Number of dictionary words. */
  get size(): number {
    return this.known.size;
  }
}

export interface MisspelledToken {
  word: string;
  suggestions: string[];
}

/**
 * Check the words inside an identifier (splitting camelCase / snake_case) and
 * return any sub-words the dictionary does not recognise, each with the best
 * suggestions. Short fragments and pure numbers are ignored.
 */
export function checkIdentifier(identifier: string, checker: SpellChecker, maxDistance = 1): MisspelledToken[] {
  const out: MisspelledToken[] = [];
  for (const word of splitWords(identifier)) {
    if (word.length < 3 || /\d/.test(word)) continue;
    if (checker.has(word)) continue;
    out.push({ word, suggestions: checker.suggest(word, maxDistance).map((s) => s.word) });
  }
  return out;
}
