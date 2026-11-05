import { describe, it, expect } from "vitest";
import { createLiveKitToken } from "@/lib/room/livekit-token";

describe("LiveKit Token Generator", () => {
  it("creates a properly structured JWT for LiveKit Cloud", () => {
    const token = createLiveKitToken({
      apiKey: "APIVJ3Tjwdsh9p2",
      apiSecret: "EqM4mtNrpcGnQkLX6tu2oyLJXxsypmxaOHAz9igWJOF",
      identity: "host-test-user",
      name: "Emmanuel Enyi",
      room: "room-room-123",
    });

    expect(token).toBeDefined();
    const parts = token.split(".");
    expect(parts.length).toBe(3);

    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    expect(header.alg).toBe("HS256");
    expect(header.typ).toBe("JWT");

    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    expect(payload.iss).toBe("APIVJ3Tjwdsh9p2");
    expect(payload.sub).toBe("host-test-user");
    expect(payload.name).toBe("Emmanuel Enyi");
    expect(payload.video).toBeDefined();
    expect(payload.video.room).toBe("room-room-123");
    expect(payload.video.roomJoin).toBe(true);
    expect(payload.video.canPublish).toBe(true);
    expect(payload.video.canSubscribe).toBe(true);
  });
});
