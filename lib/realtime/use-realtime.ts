"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "./event-bus";

export interface UseMorrowRealtimeOptions {
  channels: string | string[];
  enabled?: boolean;
  onEvent: (event: RealtimeEvent) => void;
}

export interface UseMorrowRealtimeResult {
  status: "connected" | "connecting" | "disconnected";
  isConnected: boolean;
}

export function useMorrowRealtime({
  channels,
  enabled = true,
  onEvent,
}: UseMorrowRealtimeOptions): UseMorrowRealtimeResult {
  const [status, setStatus] = useState<"connected" | "connecting" | "disconnected">("disconnected");
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const channelList = Array.isArray(channels) ? channels.filter(Boolean) : [channels].filter(Boolean);
  const channelsKey = channelList.sort().join(",");

  useEffect(() => {
    if (!enabled || !channelsKey) {
      setStatus("disconnected");
      return;
    }

    let eventSource: EventSource | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let isSubscribed = true;

    setStatus("connecting");

    function connect() {
      if (!isSubscribed) return;

      const url = `/api/realtime/stream?channels=${encodeURIComponent(channelsKey)}`;
      eventSource = new EventSource(url);

      eventSource.onopen = () => {
        if (isSubscribed) {
          setStatus("connected");
        }
      };

      eventSource.onmessage = (e) => {
        if (!e.data || e.data.startsWith(":")) return; // ignore comments / keepalives
        try {
          const parsed: RealtimeEvent = JSON.parse(e.data);
          if (parsed && parsed.type) {
            onEventRef.current(parsed);
          }
        } catch {
          // ignore malformed data
        }
      };

      eventSource.onerror = () => {
        if (isSubscribed) {
          setStatus("connecting");
        }
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        // Attempt automatic reconnection with 3s backoff
        if (isSubscribed && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 3000);
        }
      };
    }

    connect();

    return () => {
      isSubscribed = false;
      setStatus("disconnected");
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (eventSource) eventSource.close();
    };
  }, [channelsKey, enabled]);

  return {
    status,
    isConnected: status === "connected",
  };
}
