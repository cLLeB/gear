// Operational Transformation (OT) for collaborative editing. When two users edit
// the same document at once, their operations are created against the same base
// but must be applied one after the other; `transform` rewrites each operation
// so it still makes sense after the other has been applied, guaranteeing both
// sites converge to the same document. This is the core algorithm behind
// real-time collaboration (Google Docs, ShareDB). An operation is a sequence of
// components over the document: retain N characters, insert a string, or delete
// N characters — together they describe a full transformation of the text.

type Component = number | string; // >0 retain, <0 delete, string insert

export class TextOperation {
  readonly ops: Component[] = [];
  /** Length of the document this operation applies to. */
  baseLength = 0;
  /** Length of the document after applying this operation. */
  targetLength = 0;

  /** Keep N characters unchanged. */
  retain(n: number): this {
    if (n <= 0) return this;
    this.baseLength += n;
    this.targetLength += n;
    const last = this.ops[this.ops.length - 1];
    if (typeof last === "number" && last > 0) this.ops[this.ops.length - 1] = last + n;
    else this.ops.push(n);
    return this;
  }

  /** Insert a string at the current position. */
  insert(str: string): this {
    if (str === "") return this;
    this.targetLength += str.length;
    const ops = this.ops;
    const last = ops[ops.length - 1];
    if (typeof last === "string") {
      ops[ops.length - 1] = last + str;
    } else if (typeof last === "number" && last < 0) {
      // Keep inserts ordered before an adjacent delete for canonical form.
      const prev = ops[ops.length - 2];
      if (typeof prev === "string") ops[ops.length - 2] = prev + str;
      else ops.splice(ops.length - 1, 0, str);
    } else {
      ops.push(str);
    }
    return this;
  }

  /** Delete the next N characters. */
  delete(n: number): this {
    const count = Math.abs(n);
    if (count === 0) return this;
    this.baseLength += count;
    const last = this.ops[this.ops.length - 1];
    if (typeof last === "number" && last < 0) this.ops[this.ops.length - 1] = last - count;
    else this.ops.push(-count);
    return this;
  }

  /** Apply this operation to a document string. */
  apply(doc: string): string {
    if (doc.length !== this.baseLength) throw new Error("operation base length mismatch");
    let result = "";
    let index = 0;
    for (const op of this.ops) {
      if (typeof op === "string") result += op;
      else if (op > 0) { result += doc.slice(index, index + op); index += op; }
      else index += -op;
    }
    return result;
  }
}

const isRetain = (op: Component | undefined): op is number => typeof op === "number" && op > 0;
const isDelete = (op: Component | undefined): op is number => typeof op === "number" && op < 0;
const isInsert = (op: Component | undefined): op is string => typeof op === "string";

/**
 * Transform two operations created against the same document. Returns
 * `[aPrime, bPrime]` such that applying `bPrime` after `a` yields the same
 * document as applying `aPrime` after `b`. Concurrent inserts at the same spot
 * are ordered with `a` first, deterministically.
 */
export function transform(a: TextOperation, b: TextOperation): [TextOperation, TextOperation] {
  if (a.baseLength !== b.baseLength) throw new Error("transform() requires equal base lengths");

  const aPrime = new TextOperation();
  const bPrime = new TextOperation();
  const ops1 = a.ops;
  const ops2 = b.ops;
  let i1 = 0;
  let i2 = 0;
  let op1: Component | undefined = ops1[i1++];
  let op2: Component | undefined = ops2[i2++];

  for (;;) {
    if (op1 === undefined && op2 === undefined) break;

    // Inserts: `a`'s insert wins the tie and goes first.
    if (isInsert(op1)) {
      aPrime.insert(op1);
      bPrime.retain(op1.length);
      op1 = ops1[i1++];
      continue;
    }
    if (isInsert(op2)) {
      aPrime.retain(op2.length);
      bPrime.insert(op2);
      op2 = ops2[i2++];
      continue;
    }

    if (op1 === undefined) throw new Error("cannot transform: first operation is too short");
    if (op2 === undefined) throw new Error("cannot transform: second operation is too short");

    if (isRetain(op1) && isRetain(op2)) {
      const min = Math.min(op1, op2);
      aPrime.retain(min);
      bPrime.retain(min);
      op1 = op1 > min ? op1 - min : ops1[i1++];
      op2 = op2 > min ? op2 - min : ops2[i2++];
    } else if (isDelete(op1) && isDelete(op2)) {
      const min = Math.min(-op1, -op2);
      op1 = -op1 > min ? op1 + min : ops1[i1++];
      op2 = -op2 > min ? op2 + min : ops2[i2++];
    } else if (isDelete(op1) && isRetain(op2)) {
      const min = Math.min(-op1, op2);
      aPrime.delete(min);
      op1 = -op1 > min ? op1 + min : ops1[i1++];
      op2 = op2 > min ? op2 - min : ops2[i2++];
    } else if (isRetain(op1) && isDelete(op2)) {
      const min = Math.min(op1, -op2);
      bPrime.delete(min);
      op1 = op1 > min ? op1 - min : ops1[i1++];
      op2 = -op2 > min ? op2 + min : ops2[i2++];
    } else {
      throw new Error("unreachable transform state");
    }
  }

  return [aPrime, bPrime];
}
