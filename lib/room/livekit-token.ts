import crypto from "crypto";

export interface LiveKitTokenOptions {
  apiKey: string;
  apiSecret: string;
  identity: string;
  name: string;
  room: string;
  ttlSeconds?: number;
}

/**
 * Generates an HMAC-SHA256 LiveKit JWT token compatible with LiveKit Cloud and self-hosted LiveKit servers.
 * Implements the official LiveKit token protocol with zero external dependencies.
 */
export function createLiveKitToken({
  apiKey,
  apiSecret,
  identity,
  name,
  room,
  ttlSeconds = 7200,
}: LiveKitTokenOptions): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: apiKey,
    sub: identity,
    nbf: now - 5,
    exp: now + ttlSeconds,
    name,
    video: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };

  const base64Url = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const encodedHeader = base64Url(header);
  const encodedPayload = base64Url(payload);
  const data = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${data}.${signature}`;
}
