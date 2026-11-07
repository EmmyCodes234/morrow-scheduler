import { EventEmitter } from "events";

export interface RealtimeEvent<T = any> {
  channel: string;
  type: string;
  payload: T;
  timestamp: string;
}

type EventHandler = (event: RealtimeEvent) => void;

class RealtimeEventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(5000);
  }

  public subscribe(channel: string, handler: EventHandler): () => void {
    const eventName = `chan:${channel}`;
    this.emitter.on(eventName, handler);
    return () => {
      this.emitter.off(eventName, handler);
    };
  }

  public broadcast<T = any>(channel: string, type: string, payload: T): void {
    const event: RealtimeEvent<T> = {
      channel,
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    const eventName = `chan:${channel}`;
    this.emitter.emit(eventName, event);
  }
}

// Preserve bus across Next.js dev server module reloads
const globalForRealtime = globalThis as unknown as {
  __morrow_realtime_bus__?: RealtimeEventBus;
};

export const realtimeBus =
  globalForRealtime.__morrow_realtime_bus__ || new RealtimeEventBus();

if (process.env.NODE_ENV !== "production") {
  globalForRealtime.__morrow_realtime_bus__ = realtimeBus;
}
