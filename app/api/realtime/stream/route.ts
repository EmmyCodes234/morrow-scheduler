import { NextRequest } from "next/server";
import { realtimeBus, type RealtimeEvent } from "@/lib/realtime/event-bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const channelsParam = searchParams.get("channels") || "";
  const channels = channelsParam
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  if (channels.length === 0) {
    return new Response(JSON.stringify({ error: "No channels specified" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const unsubs: Array<() => void> = [];
  let heartbeatTimer: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection confirmation
      const initMessage = `data: ${JSON.stringify({ type: "connection.ready", channels })}\n\n`;
      controller.enqueue(encoder.encode(initMessage));

      // Subscribe to all requested channels
      for (const channel of channels) {
        const unsub = realtimeBus.subscribe(channel, (event: RealtimeEvent) => {
          try {
            const data = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(data));
          } catch {
            // Stream was closed
          }
        });
        unsubs.push(unsub);
      }

      // 15-second heartbeat to keep SSE connection alive
      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
      }, 15000);
    },
    cancel() {
      // Cleanup all event bus subscriptions and timers
      for (const unsub of unsubs) {
        unsub();
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform, no-store",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
