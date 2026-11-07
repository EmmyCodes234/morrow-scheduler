import { describe, it, expect, vi } from "vitest";
import { realtimeBus, type RealtimeEvent } from "@/lib/realtime/event-bus";

describe("Morrow Realtime Event Bus", () => {
  it("delivers broadcast events to registered channel subscribers", () => {
    const handler = vi.fn();
    const unsubscribe = realtimeBus.subscribe("host:user-123", handler);

    realtimeBus.broadcast("host:user-123", "booking.created", {
      id: "booking-999",
      guestName: "Sarah Jenkins",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const event: RealtimeEvent = handler.mock.calls[0][0];
    expect(event.channel).toBe("host:user-123");
    expect(event.type).toBe("booking.created");
    expect(event.payload.id).toBe("booking-999");
    expect(event.payload.guestName).toBe("Sarah Jenkins");
    expect(new Date(event.timestamp).getTime()).toBeGreaterThan(0);

    unsubscribe();
  });

  it("does not leak events to unrelated channels", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    const unsubA = realtimeBus.subscribe("host:user-A", handlerA);
    const unsubB = realtimeBus.subscribe("host:user-B", handlerB);

    realtimeBus.broadcast("host:user-A", "knock.created", { id: "knock-1" });

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).not.toHaveBeenCalled();

    unsubA();
    unsubB();
  });

  it("stops delivering events after unsubscribe is called", () => {
    const handler = vi.fn();
    const unsubscribe = realtimeBus.subscribe("knock:k-456", handler);

    realtimeBus.broadcast("knock:k-456", "knock.status", { status: "ringing" });
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();

    realtimeBus.broadcast("knock:k-456", "knock.status", { status: "admitted" });
    expect(handler).toHaveBeenCalledTimes(1); // not called again
  });

  it("supports multiple concurrent subscribers on a single channel", () => {
    const listenerOne = vi.fn();
    const listenerTwo = vi.fn();

    const unsub1 = realtimeBus.subscribe("public:host:elena", listenerOne);
    const unsub2 = realtimeBus.subscribe("public:host:elena", listenerTwo);

    realtimeBus.broadcast("public:host:elena", "office.status_changed", {
      officeStatus: "open",
    });

    expect(listenerOne).toHaveBeenCalledTimes(1);
    expect(listenerTwo).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });
});
