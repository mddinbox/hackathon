/**
 * A small generic undo stack. The shell pushes a snapshot before any
 * user-driven mutation (slot move, notes edit, mutation-draft dismissal) and
 * pops it on Undo. Kept intentionally simple — this is a demo affordance,
 * not a full command pattern.
 */
export class UndoStack<T> {
  private stack: T[] = [];
  private readonly limit: number;

  constructor(limit = 20) {
    this.limit = limit;
  }

  push(snapshot: T): void {
    this.stack.push(snapshot);
    if (this.stack.length > this.limit) this.stack.shift();
  }

  canUndo(): boolean {
    return this.stack.length > 0;
  }

  undo(): T | undefined {
    return this.stack.pop();
  }

  clear(): void {
    this.stack = [];
  }
}
