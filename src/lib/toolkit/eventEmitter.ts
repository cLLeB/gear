type Listener<T> = (payload: T) => void;

/**
 * A tiny type-safe event emitter. Event names and their payload types are
 * described by the generic map, so `on`/`emit` are fully checked.
 */
export class EventEmitter<Events extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof Events, Set<Listener<unknown>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<unknown>);
    return () => this.off(event, listener);
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<unknown>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) (listener as Listener<Events[K]>)(payload);
  }

  removeAll(event?: keyof Events): void {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
  }

  listenerCount(event: keyof Events): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
