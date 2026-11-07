import { describe, it, expect, vi } from "vitest";
import { realtimeBus } from "@/lib/realtime/event-bus";

describe("Morrow Realtime Engine & Settings Integration Suite", () => {
  it("broadcasts booking and cancellation events across host channels with payload integrity", () => {
    const hostAEvents: any[] = [];
    const hostBEvents: any[] = [];

    const unsubA = realtimeBus.subscribe("host:user-alpha", (e) => hostAEvents.push(e));
    const unsubB = realtimeBus.subscribe("host:user-beta", (e) => hostBEvents.push(e));

    // Emit booking for Host Alpha
    realtimeBus.broadcast("host:user-alpha", "booking.created", {
      id: "booking-1",
      guestName: "Alice Walker",
      eventTitle: "30 Min Discovery",
    });

    // Emit cancellation for Host Alpha
    realtimeBus.broadcast("host:user-alpha", "booking.cancelled", {
      id: "booking-1",
      guestName: "Alice Walker",
    });

    // Emit booking for Host Beta
    realtimeBus.broadcast("host:user-beta", "booking.created", {
      id: "booking-2",
      guestName: "Bob Dylan",
      eventTitle: "Keynote Prep",
    });

    expect(hostAEvents).toHaveLength(2);
    expect(hostAEvents[0].type).toBe("booking.created");
    expect(hostAEvents[0].payload.guestName).toBe("Alice Walker");
    expect(hostAEvents[1].type).toBe("booking.cancelled");

    expect(hostBEvents).toHaveLength(1);
    expect(hostBEvents[0].type).toBe("booking.created");
    expect(hostBEvents[0].payload.guestName).toBe("Bob Dylan");

    unsubA();
    unsubB();
  });

  it("broadcasts event type CRUD events in real-time", () => {
    const received: any[] = [];
    const unsub = realtimeBus.subscribe("host:user-alpha", (e) => received.push(e));

    realtimeBus.broadcast("host:user-alpha", "event_type.created", {
      id: "et-100",
      title: "15 Min Speed Chat",
      slug: "15-min-speed-chat",
    });

    realtimeBus.broadcast("host:user-alpha", "event_type.updated", {
      id: "et-100",
      title: "20 Min Speed Chat",
      durationMins: 20,
    });

    realtimeBus.broadcast("host:user-alpha", "event_type.deleted", {
      id: "et-100",
    });

    expect(received).toHaveLength(3);
    expect(received[0].type).toBe("event_type.created");
    expect(received[1].type).toBe("event_type.updated");
    expect(received[2].type).toBe("event_type.deleted");
    expect(received[2].payload.id).toBe("et-100");

    unsub();
  });

  it("broadcasts profile and availability updates to keep all tabs and public views in sync", () => {
    const receivedHost: any[] = [];
    const receivedPublic: any[] = [];

    const unsubHost = realtimeBus.subscribe("host:user-alpha", (e) => receivedHost.push(e));
    const unsubPublic = realtimeBus.subscribe("public:host:alex-m", (e) => receivedPublic.push(e));

    // User updates profile
    realtimeBus.broadcast("host:user-alpha", "user.updated", {
      name: "Alex Morgan",
      defaultLocationType: "zoom",
      brandColor: "#059669",
    });
    realtimeBus.broadcast("public:host:alex-m", "user.updated", {
      name: "Alex Morgan",
      brandColor: "#059669",
    });

    // User updates working hours
    realtimeBus.broadcast("host:user-alpha", "availability.updated", {
      timezone: "America/New_York",
      updatedAt: new Date().toISOString(),
    });
    realtimeBus.broadcast("public:host:alex-m", "availability.updated", {
      updatedAt: new Date().toISOString(),
    });

    expect(receivedHost).toHaveLength(2);
    expect(receivedHost[0].type).toBe("user.updated");
    expect(receivedHost[0].payload.defaultLocationType).toBe("zoom");
    expect(receivedHost[1].type).toBe("availability.updated");

    expect(receivedPublic).toHaveLength(2);
    expect(receivedPublic[0].type).toBe("user.updated");
    expect(receivedPublic[1].type).toBe("availability.updated");

    unsubHost();
    unsubPublic();
  });

  it("broadcasts virtual office doorbell rings and status changes instantaneously", () => {
    const hostKnocks: any[] = [];
    const unsub = realtimeBus.subscribe("host:user-alpha", (e) => hostKnocks.push(e));

    realtimeBus.broadcast("host:user-alpha", "knock.created", {
      id: "knock-99",
      visitorName: "David",
      status: "ringing",
    });

    realtimeBus.broadcast("host:user-alpha", "office.status_changed", {
      officeStatus: "busy",
    });

    expect(hostKnocks).toHaveLength(2);
    expect(hostKnocks[0].type).toBe("knock.created");
    expect(hostKnocks[0].payload.visitorName).toBe("David");
    expect(hostKnocks[1].type).toBe("office.status_changed");
    expect(hostKnocks[1].payload.officeStatus).toBe("busy");

    unsub();
  });
});
