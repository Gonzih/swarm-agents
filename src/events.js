/**
 * EventBus — singleton that connects Display → WebSocket server.
 * Any module can emit events here; the UI server broadcasts them to browsers.
 */
import { EventEmitter } from 'events';

export const bus = new EventEmitter();
bus.setMaxListeners(50);

export function emit(type, payload = {}) {
  bus.emit('event', { type, ...payload, ts: Date.now() });
}
