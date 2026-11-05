import { describe, it, expect } from "vitest";
import { createLiveKitToken } from "@/lib/room/livekit-token";

describe("LiveKit Token Security & Grant Verification", () => {
  const apiKey = "APIVJ3Tjwdsh9p2";
  const apiSecret = "EqM4mtNrpcGnQkLX6tu2oyLJXxsypmxaOHAz9igWJOF";

  it("creates a properly structured JWT with verified media grants", () => {
    const token = createLiveKitToken({
      apiKey,
      apiSecret,
      identity: "host-host-123-abcde",
      name: "Emmanuel Enyi",
      room: "room-uuid-456",
      ttlSeconds: 7200,
    });

    expect(token).toBeDefined();
    const parts = token.split(".");
    expect(parts.length).toBe(3);

    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    expect(header.alg).toBe("HS256");
    expect(header.typ).toBe("JWT");

    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    expect(payload.iss).toBe(apiKey);
    expect(payload.sub).toBe("host-host-123-abcde");
    expect(payload.name).toBe("Emmanuel Enyi");

    // Room and grant restrictions
    expect(payload.video).toBeDefined();
    expect(payload.video.room).toBe("room-uuid-456");
    expect(payload.video.roomJoin).toBe(true);
    expect(payload.video.canPublish).toBe(true);
    expect(payload.video.canSubscribe).toBe(true);

    // Required collaborative data channel grant
    expect(payload.video.canPublishData).toBe(true);

    // Security verification: NO unintended roomAdmin or moderation permissions
    expect(payload.video.roomAdmin).toBeUndefined();
    expect(payload.video.roomList).toBeUndefined();
    expect(payload.video.roomRecord).toBeUndefined();

    // Verify token expiration is constrained (7200s / 2 hours, not 6+ hours)
    expect(payload.exp - payload.nbf).toBe(7205); // nbf is now - 5
  });

  it("mints guest tokens with guest identity and without elevation", () => {
    const token = createLiveKitToken({
      apiKey,
      apiSecret,
      identity: "guest-booking-789-fghij",
      name: "Lito Enyi",
      room: "room-uuid-456",
    });

    const parts = token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));

    expect(payload.sub).toBe("guest-booking-789-fghij");
    expect(payload.name).toBe("Lito Enyi");
    expect(payload.video.room).toBe("room-uuid-456");
    expect(payload.video.canPublish).toBe(true);
    expect(payload.video.canSubscribe).toBe(true);
    expect(payload.video.canPublishData).toBe(true);
    expect(payload.video.roomAdmin).toBeUndefined();
  });
});
