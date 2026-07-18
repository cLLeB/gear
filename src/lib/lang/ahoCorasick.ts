// Aho-Corasick multi-pattern string matching. Highlighting every TODO/FIXME
// keyword, scanning for a list of banned words, or matching many search terms at
// once all reduce to "find all occurrences of a *set* of patterns in one pass".
// Running a separate search per pattern is O(patterns × text); Aho-Corasick
// builds a single automaton with failure links so the whole set is matched in
// one linear scan of the text, reporting overlapping matches too (searching
// "ushers" for {he, she, his, hers} finds she, he, and hers). Construction is
// linear in the total pattern length.

interface ACNode {
  children: Map<string, ACNode>;
  fail: ACNode | null;
  outputs: number[]; // indices into the pattern list
}

export interface Match {
  pattern: string;
  patternIndex: number;
  start: number;
  end: number;
}

export class AhoCorasick {
  private readonly root: ACNode = { children: new Map(), fail: null, outputs: [] };
  private readonly patterns: string[];

  constructor(patterns: readonly string[]) {
    this.patterns = patterns.filter((p) => p.length > 0);
    this.build();
  }

  private build(): void {
    // 1. Build the trie of patterns.
    this.patterns.forEach((pattern, index) => {
      let node = this.root;
      for (const ch of pattern) {
        let next = node.children.get(ch);
        if (!next) { next = { children: new Map(), fail: null, outputs: [] }; node.children.set(ch, next); }
        node = next;
      }
      node.outputs.push(index);
    });

    // 2. BFS to wire up failure links and merge outputs along them.
    const queue: ACNode[] = [];
    for (const child of this.root.children.values()) {
      child.fail = this.root;
      queue.push(child);
    }
    while (queue.length > 0) {
      const node = queue.shift()!;
      for (const [ch, child] of node.children) {
        let f = node.fail;
        while (f !== null && !f.children.has(ch)) f = f.fail;
        child.fail = f ? f.children.get(ch)! : this.root;
        child.outputs.push(...child.fail.outputs);
        queue.push(child);
      }
    }
  }

  /** Find all matches (including overlaps) of any pattern in `text`. */
  search(text: string): Match[] {
    const matches: Match[] = [];
    let node = this.root;
    let i = 0;
    for (const ch of text) {
      while (node !== this.root && !node.children.has(ch)) node = node.fail!;
      node = node.children.get(ch) ?? this.root;
      const end = i + 1;
      for (const index of node.outputs) {
        const pattern = this.patterns[index];
        matches.push({ pattern, patternIndex: index, start: end - pattern.length, end });
      }
      i += 1;
    }
    return matches;
  }

  /** Whether the text contains any of the patterns. */
  test(text: string): boolean {
    let node = this.root;
    for (const ch of text) {
      while (node !== this.root && !node.children.has(ch)) node = node.fail!;
      node = node.children.get(ch) ?? this.root;
      if (node.outputs.length > 0) return true;
    }
    return false;
  }
}
