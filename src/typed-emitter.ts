/**
 * Tiny typed-emitter helper.
 *
 * Wraps `node:events` `EventEmitter` with a generic event-map so
 * `.on(name, ...)` / `.once(name, ...)` / `.off(name, ...)` and
 * `.emit(name, ...)` are type-checked against the supplied event map.
 *
 * Used by `DreameSubscription`, `Vacuum`, and `MapManager` to catch
 * event-name typos at compile time. Runtime behaviour is identical to
 * the bare `EventEmitter` (we just narrow the public methods).
 */

import { EventEmitter as NodeEventEmitter } from "node:events";

/**
 * Event-map shape — open enough that interface-typed maps don't
 * trip TS's lack of implicit index-signature inference for interfaces.
 */
export type EventMap = { [K in string]: unknown[] };

type Listener<Args extends unknown[]> = (...args: Args) => void;

export class TypedEmitter<E extends EventMap> extends NodeEventEmitter {
  override on<K extends keyof E & string>(event: K, listener: Listener<E[K]>): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override once<K extends keyof E & string>(event: K, listener: Listener<E[K]>): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }
  override off<K extends keyof E & string>(event: K, listener: Listener<E[K]>): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
  override addListener<K extends keyof E & string>(event: K, listener: Listener<E[K]>): this {
    return super.addListener(event, listener as (...args: unknown[]) => void);
  }
  override removeListener<K extends keyof E & string>(event: K, listener: Listener<E[K]>): this {
    return super.removeListener(event, listener as (...args: unknown[]) => void);
  }
  override emit<K extends keyof E & string>(event: K, ...args: E[K]): boolean {
    return super.emit(event, ...args);
  }
}
