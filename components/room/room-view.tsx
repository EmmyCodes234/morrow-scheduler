"use client";

import { useState, useEffect, useRef } from "react";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badge";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { FileUpload, formatFileSize } from "@/components/base/file-upload/file-upload";
import { MorrowLogo } from "@/components/brand/morrow-logo";
import { ScrollFade, useScrollFade } from "@/components/foundations/scroll-fade/scroll-fade";
import { cx } from "@/utils/cx";
import {
  RiMicLine,
  RiMicOffLine,
  RiVideoOnLine,
  RiVideoOffLine,
  RiShareForwardBoxLine,
  RiPresentationLine,
  RiCloseLine,
  RiFullscreenLine,
  RiFullscreenExitLine,
  RiExternalLinkLine,
  RiLayoutRightLine,
  RiAttachment2,
  RiFileLine,
  RiImageLine,
  RiTableLine,
  RiDownloadLine,
  RiFileCopyLine,
  RiCheckLine,
  RiFileListLine,
  RiEditLine,
  RiBookOpenLine,
  RiAddLine,
  RiTimeLine,
  RiVolumeUpLine,
  RiCalendarCloseLine,
  RiRefreshLine,
  RiAlertLine,
  RiSparklingLine,
  RiLoader4Line,
} from "@remixicon/react";
import type { RoomDetails, RoomFileItem } from "@/lib/room/room-service";
import type { VeraAgendaItem, VeraLedger } from "@/lib/intelligence/vera";

type LiveKitRoomType = import("livekit-client").Room;

export interface RoomViewProps {
  initialRoom: RoomDetails;
  isHost?: boolean;
}

export function RoomView({ initialRoom, isHost = false }: RoomViewProps) {
  const [room, setRoom] = useState<RoomDetails>(initialRoom);
  const [activeTab, setActiveTab] = useState<"agenda" | "notes" | "files" | "summary">("agenda");
  const [mobileMode, setMobileMode] = useState<"call" | "canvas">("call");

  // Call & Media State
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenSharePresenter, setScreenSharePresenter] = useState<{ name: string; isLocal: boolean } | null>(null);
  const [isCallActive, setIsCallActive] = useState(room.status === "in_progress");
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connecting" | "connected" | "disconnected">("idle");
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);

  // In-Room File Presentation & Focus Mode
  const [activeStageFile, setActiveStageFile] = useState<RoomFileItem | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);

  // Video / Audio DOM elements
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenShareVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const lkRoomRef = useRef<LiveKitRoomType | null>(null);

  // Collaborative Canvas State
  const [notes, setNotes] = useState(room.sharedNotes || "");
  const [agenda, setAgenda] = useState<VeraAgendaItem[]>(room.agenda || []);
  const [files, setFiles] = useState<RoomFileItem[]>(room.files || []);
  const [newAgendaText, setNewAgendaText] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesisState, setSynthesisState] = useState<
    "idle" | "synthesizing" | "completed" | "failed" | "timed_out_waiting"
  >(
    room.veraLedger
      ? "completed"
      : room.synthesisStatus === "synthesizing"
      ? "synthesizing"
      : room.synthesisStatus === "failed"
      ? "failed"
      : "idle"
  );
  const [summary, setSummary] = useState<VeraLedger | null>(
    room.veraLedger
      ? {
          executiveSummary: room.veraLedger.executiveSummary || [],
          actionItems: (room.veraLedger.actionItems || []).map((a) => ({
            id: a.id,
            task: a.task,
            assignee: a.assignee,
            priority: (a.priority || "medium") as "high" | "medium" | "low",
            done: Boolean(a.done),
          })),
          keyDecisions: room.veraLedger.keyDecisions || [],
          suggestedFollowUp: room.veraLedger.suggestedFollowUp,
        }
      : null
  );

  // Background polling when room is actively synthesizing
  // Ensures browser refresh does not re-trigger synthesis, but safely tracks completion
  useEffect(() => {
    if (synthesisState !== "synthesizing") return;

    let isMounted = true;
    let attempts = 0;
    const maxAttempts = 16; // 16 * 2500ms = 40 seconds (covers 25s timeout + db write)

    const interval = setInterval(async () => {
      attempts++;
      try {
        const checkRes = await fetch(`/api/room/${room.accessToken}`);
        const checkData = await checkRes.json().catch(() => ({}));

        if (!isMounted) return;

        if (checkData.success && checkData.room) {
          if (checkData.room.veraLedger) {
            setSummary(checkData.room.veraLedger);
            setSynthesisState("completed");
            setIsSynthesizing(false);
            clearInterval(interval);
            return;
          }

          if (checkData.room.synthesisStatus === "failed") {
            setSynthesisState("failed");
            setIsSynthesizing(false);
            clearInterval(interval);
            return;
          }
        }

        if (attempts >= maxAttempts) {
          clearInterval(interval);
          setSynthesisState("timed_out_waiting");
          setIsSynthesizing(false);
        }
      } catch (err) {
        console.warn("[Room] Error polling synthesis status:", err);
      }
    }, 2500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [synthesisState, room.accessToken]);

  // Scroll fades for internal scroll regions (BoardUI compliance)
  const summaryFade = useScrollFade();
  const agendaFade = useScrollFade();
  const filesFade = useScrollFade();

  // =========================================================================
  // LiveKit WebRTC Session Lifecycle & Real-Time Sync
  // =========================================================================
  useEffect(() => {
    if (!isCallActive) return;

    let isCancelled = false;
    let cleanupRoom: LiveKitRoomType | null = null;

    async function initLiveKit() {
      setConnectionStatus("connecting");
      try {
        const { Room, RoomEvent, Track } = await import("livekit-client");

        if (isCancelled) return;

        const lk = new Room({
          adaptiveStream: true,
          dynacast: true,
        });
        lkRoomRef.current = lk;
        cleanupRoom = lk;

        // Remote Track Subscriptions
        lk.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          if (publication.source === Track.Source.ScreenShare && track.kind === Track.Kind.Video) {
            if (screenShareVideoRef.current) {
              track.attach(screenShareVideoRef.current);
            }
            setScreenSharePresenter({ name: participant.name || "Guest", isLocal: false });
          } else if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
            track.attach(remoteVideoRef.current);
            setRemoteHasVideo(true);
          } else if (track.kind === Track.Kind.Audio && remoteAudioRef.current) {
            track.attach(remoteAudioRef.current);
          }
        });

        // Remote Track Unsubscriptions
        lk.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
          track.detach();
          if (publication.source === Track.Source.ScreenShare) {
            setScreenSharePresenter(null);
          } else if (track.kind === Track.Kind.Video) {
            setRemoteHasVideo(false);
          }
        });

        // Local Track Published (for Screen Share self-view)
        lk.on(RoomEvent.LocalTrackPublished, (pub) => {
          if (pub.source === Track.Source.ScreenShare && pub.videoTrack && screenShareVideoRef.current) {
            pub.videoTrack.attach(screenShareVideoRef.current);
            setScreenSharePresenter({ name: "You", isLocal: true });
            setIsScreenSharing(true);
          }
        });

        // Local Track Unpublished
        lk.on(RoomEvent.LocalTrackUnpublished, (pub) => {
          if (pub.source === Track.Source.ScreenShare) {
            setScreenSharePresenter(null);
            setIsScreenSharing(false);
          }
        });

        // Active Speakers Event
        lk.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          const remoteSpeaker = speakers.find((s) => s.identity !== lk.localParticipant.identity);
          setIsRemoteSpeaking(Boolean(remoteSpeaker));
        });

        // Real-Time Room Data Channel (Sync files, stage presentation & canvas across peers instantly)
        lk.on(RoomEvent.DataReceived, (payload) => {
          try {
            const data = JSON.parse(new TextDecoder().decode(payload));
            if (data.type === "FILE_ADDED" && data.file) {
              setFiles((prev) => [data.file, ...prev.filter((f) => f.id !== data.file.id)]);
            } else if (data.type === "PRESENT_STAGE_FILE" && data.file) {
              setActiveStageFile(data.file);
            } else if (data.type === "STOP_STAGE_FILE") {
              setActiveStageFile(null);
            } else if (data.type === "AGENDA_UPDATED" && Array.isArray(data.agenda)) {
              setAgenda(data.agenda);
            }
          } catch (err) {
            console.warn("[DataChannel] Parse error:", err);
          }
        });

        // Connection State Changes
        lk.on(RoomEvent.Connected, () => setConnectionStatus("connected"));
        lk.on(RoomEvent.Disconnected, () => setConnectionStatus("disconnected"));
        lk.on(RoomEvent.Reconnecting, () => setConnectionStatus("connecting"));
        lk.on(RoomEvent.Reconnected, () => setConnectionStatus("connected"));

        // Fetch Room Access Token securely via server-authoritative POST
        const res = await fetch(`/api/room/${room.accessToken}/livekit`, {
          method: "POST",
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Could not acquire room connection token");
        }
        const { token, url } = await res.json();

        if (isCancelled) return;

        // Connect
        await lk.connect(url, token);
        if (isCancelled) {
          lk.disconnect();
          return;
        }

        setConnectionStatus("connected");

        // Enable Local Media (Mic & Cam)
        try {
          await lk.localParticipant.setCameraEnabled(!isCamOff);
          await lk.localParticipant.setMicrophoneEnabled(!isMicMuted);

          const cameraPub = lk.localParticipant.getTrackPublication(Track.Source.Camera);
          if (cameraPub?.videoTrack && localVideoRef.current) {
            cameraPub.videoTrack.attach(localVideoRef.current);
          }
        } catch (mediaErr) {
          console.warn("[Media] Device initialization notice:", mediaErr);
        }
      } catch (err) {
        console.warn("[Connection] Fallback activated:", err);
        setConnectionStatus("disconnected");
      }
    }

    initLiveKit();

    return () => {
      isCancelled = true;
      if (cleanupRoom) {
        cleanupRoom.disconnect();
        lkRoomRef.current = null;
      }
    };
  }, [isCallActive, room.accessToken]);

  // Toggle Microphone
  const toggleMic = async () => {
    const nextState = !isMicMuted;
    setIsMicMuted(nextState);
    if (lkRoomRef.current) {
      try {
        await lkRoomRef.current.localParticipant.setMicrophoneEnabled(!nextState);
      } catch (err) {
        console.warn("[Audio] Toggle notice:", err);
      }
    }
  };

  // Toggle Camera
  const toggleCam = async () => {
    const nextState = !isCamOff;
    setIsCamOff(nextState);
    if (lkRoomRef.current) {
      try {
        await lkRoomRef.current.localParticipant.setCameraEnabled(!nextState);
        const { Track } = await import("livekit-client");
        const camPub = lkRoomRef.current.localParticipant.getTrackPublication(Track.Source.Camera);
        if (!nextState && camPub?.videoTrack && localVideoRef.current) {
          camPub.videoTrack.attach(localVideoRef.current);
        }
      } catch (err) {
        console.warn("[Video] Toggle notice:", err);
      }
    }
  };

  // Toggle Screen Sharing
  const toggleScreenShare = async () => {
    if (!lkRoomRef.current) return;
    try {
      const nextState = !isScreenSharing;
      await lkRoomRef.current.localParticipant.setScreenShareEnabled(nextState);
      setIsScreenSharing(nextState);
      if (!nextState) {
        setScreenSharePresenter(null);
      }
    } catch (err) {
      console.warn("[ScreenShare] Presentation toggle notice:", err);
      setIsScreenSharing(false);
    }
  };

  // Present or Stop Presenting a Document on the Stage
  const togglePresentFile = (file: RoomFileItem | null) => {
    if (file && activeStageFile?.id === file.id) {
      // Toggle off
      setActiveStageFile(null);
      setIsFocusMode(false);
      if (lkRoomRef.current) {
        const payload = new TextEncoder().encode(JSON.stringify({ type: "STOP_STAGE_FILE" }));
        lkRoomRef.current.localParticipant.publishData(payload, { reliable: true });
      }
    } else if (file) {
      // Present this file
      setActiveStageFile(file);
      setMobileMode("call"); // Switch to stage on mobile
      if (lkRoomRef.current) {
        const payload = new TextEncoder().encode(
          JSON.stringify({ type: "PRESENT_STAGE_FILE", file })
        );
        lkRoomRef.current.localParticipant.publishData(payload, { reliable: true });
      }
    } else {
      setActiveStageFile(null);
      setIsFocusMode(false);
      if (lkRoomRef.current) {
        const payload = new TextEncoder().encode(JSON.stringify({ type: "STOP_STAGE_FILE" }));
        lkRoomRef.current.localParticipant.publishData(payload, { reliable: true });
      }
    }
  };

  // Handle File Upload to Room
  const handleFileUpload = async (file: File) => {
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const newFileItem: RoomFileItem = {
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          size: file.size,
          type: file.type || "application/octet-stream",
          dataUrl,
          uploadedBy: isHost ? room.booking.host.name : (room.booking.guest.name || "Guest"),
          uploadedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };

        const nextFiles = [newFileItem, ...files];
        setFiles(nextFiles);

        // Persist to server
        await fetch(`/api/room/${room.accessToken}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: newFileItem }),
        });

        // Broadcast to peer via WebRTC data channel
        if (lkRoomRef.current) {
          const payload = new TextEncoder().encode(
            JSON.stringify({ type: "FILE_ADDED", file: newFileItem })
          );
          lkRoomRef.current.localParticipant.publishData(payload, { reliable: true });
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error("[Room] Error processing file upload:", err);
    }
  };

  // Agenda Item Toggle
  const handleToggleAgendaItem = async (itemId: string) => {
    const nextAgenda = agenda.map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item
    );
    setAgenda(nextAgenda);

    try {
      await fetch(`/api/room/${room.accessToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agenda: nextAgenda }),
      });

      // Broadcast to peer
      if (lkRoomRef.current) {
        const payload = new TextEncoder().encode(
          JSON.stringify({ type: "AGENDA_UPDATED", agenda: nextAgenda })
        );
        lkRoomRef.current.localParticipant.publishData(payload, { reliable: true });
      }
    } catch (err) {
      console.error("[Room] Error saving agenda update:", err);
    }
  };

  // Add Agenda Item
  const handleAddAgendaItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgendaText.trim()) return;

    const newItem: VeraAgendaItem = {
      id: `agenda-manual-${Date.now()}`,
      text: newAgendaText.trim(),
      done: false,
      addedBy: "host",
    };

    const nextAgenda = [...agenda, newItem];
    setAgenda(nextAgenda);
    setNewAgendaText("");

    try {
      await fetch(`/api/room/${room.accessToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agenda: nextAgenda }),
      });

      // Broadcast to peer
      if (lkRoomRef.current) {
        const payload = new TextEncoder().encode(
          JSON.stringify({ type: "AGENDA_UPDATED", agenda: nextAgenda })
        );
        lkRoomRef.current.localParticipant.publishData(payload, { reliable: true });
      }
    } catch (err) {
      console.error("[Room] Error adding agenda item:", err);
    }
  };

  // Auto-save notes debounce
  useEffect(() => {
    if (notes === room.sharedNotes) return;

    setIsSavingNotes(true);
    const timer = setTimeout(async () => {
      try {
        await fetch(`/api/room/${room.accessToken}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes }),
        });
      } catch (err) {
        console.error("[Room] Error auto-saving notes:", err);
      } finally {
        setIsSavingNotes(false);
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [notes, room.accessToken, room.sharedNotes]);

  // Conclude Call and trigger Vera Summary Synthesis
  const handleConcludeCall = async () => {
    if (!isHost) return;
    setIsSynthesizing(true);
    setSynthesisState("synthesizing");
    setActiveTab("summary");

    try {
      if (lkRoomRef.current) {
        lkRoomRef.current.disconnect();
        lkRoomRef.current = null;
      }
      setIsCallActive(false);

      const res = await fetch(`/api/room/${room.accessToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "conclude" }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.status === 200 && data.success && data.veraLedger) {
        setSummary(data.veraLedger);
        setSynthesisState("completed");
        setIsSynthesizing(false);
      } else if (res.status === 202 || data.processing) {
        // Synthesis is currently processing on server. Polling effect handles waiting.
        setSynthesisState("synthesizing");
      } else {
        setSynthesisState("failed");
        setIsSynthesizing(false);
      }
    } catch (err) {
      console.error("[Room] Error concluding call with Vera:", err);
      setSynthesisState("failed");
      setIsSynthesizing(false);
    }
  };

  // Safely leave live media session without concluding persistent room or triggering AI synthesis
  const handleLeaveCall = () => {
    if (lkRoomRef.current) {
      lkRoomRef.current.disconnect();
      lkRoomRef.current = null;
    }
    setIsCallActive(false);
    setConnectionStatus("idle");
  };

  const currentUserName = isHost ? room.booking.host.name : (room.booking.guest.name || "Guest");
  const remoteParticipantName = isHost ? (room.booking.guest.name || "Guest") : room.booking.host.name;
  const isBookingCancelled = room.booking.status === "cancelled";
  const isBookingRejected = room.booking.status === "rejected";
  const isCancelledOrRejected = isBookingCancelled || isBookingRejected;
  const isBookingEligible = room.booking.status === "confirmed";

  const copyRoomLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const hostInitials = room.booking.host.name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const guestInitials = (room.booking.guest.name || "Guest")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isConcluded = summary !== null || room.status === "concluded";
  const hasActivePresentation = Boolean(screenSharePresenter);
  const isDisplayingStageFile = Boolean(activeStageFile);

  return (
    <div className="h-screen max-h-screen w-screen overflow-hidden flex flex-col bg-background-full text-text-primary selection:bg-accent-500/20">
      {/* Hidden audio element for remote audio track */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* ========================================================================= */}
      {/* 1. ROOM HEADER BAR */}
      {/* ========================================================================= */}
      <header className="h-14 px-4 sm:px-6 border-b border-border-button-default bg-background-primary-default/80 backdrop-blur-md flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          <MorrowLogo size={22} />
          <div className="h-4 w-px bg-border-button-default shrink-0" />
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-body-medium font-semibold text-text-primary truncate">
              {room.booking.eventTitle}
            </span>
            <span className="text-caption-2-medium text-text-tertiary hidden sm:inline truncate">
              ({room.booking.host.name} and {room.booking.guest.name})
            </span>
          </div>
        </div>

        {/* Participant Strip & Vera Identity */}
        <div className="hidden md:flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border-button-default bg-background-secondary-default text-caption-1-semibold">
            <Avatar size="xs" initials={hostInitials} color="blue" />
            <span className="text-text-secondary">{room.booking.host.name} {isHost ? "(Host, You)" : "(Host)"}</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border-button-default bg-background-secondary-default text-caption-1-semibold">
            <Avatar size="xs" initials={guestInitials} color="lime" />
            <span className="text-text-secondary">{room.booking.guest.name || "Guest"} {!isHost ? "(You)" : ""}</span>
          </div>

          {/* Vera Participant Badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border-button-default bg-background-primary-default shadow-2xs">
            <Avatar size="xs" initials="V" color="neutral" />
            <span className="text-text-primary text-caption-1-semibold">Vera</span>
            <Chip color="soft" variant="caption">Scribe</Chip>
          </div>
        </div>

        {/* Header Action Controls */}
        <div className="flex items-center gap-2">
          {isConcluded ? (
            <Badge color="primary">Concluded</Badge>
          ) : isCancelledOrRejected ? (
            <Badge color="neutral">{isBookingCancelled ? "Cancelled" : "Declined"}</Badge>
          ) : isCallActive ? (
            <Badge color="primary">In Session</Badge>
          ) : (
            <Badge color="neutral">Pre-Meeting</Badge>
          )}

          <Button
            variant="secondary"
            size="xs"
            leadingIcon={copiedLink ? RiCheckLine : RiFileCopyLine}
            onClick={copyRoomLink}
          >
            {copiedLink ? "Link Copied" : "Share Link"}
          </Button>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. MAIN COCKPIT VIEWPORT (FITS 100% OF AVAILABLE VIEWPORT HEIGHT) */}
      {/* ========================================================================= */}
      <main className="flex-1 flex flex-col lg:flex-row p-3 sm:p-4 gap-3 sm:gap-4 min-h-0 overflow-hidden">
        {/* ======================================================================= */}
        {/* LEFT POD: IMMERSIVE CINEMA VIDEO & DOCUMENT STAGE */}
        {/* ======================================================================= */}
        <section
          className={cx(
            "h-full flex flex-col relative rounded-3xl border border-border-button-default bg-background-tertiary-default overflow-hidden shadow-sm transition-all duration-300",
            mobileMode === "canvas" ? "hidden lg:flex" : "flex",
            isFocusMode ? "w-full flex-1" : "flex-1 min-w-0"
          )}
        >
          {/* Main Stage Viewport */}
          <div className="relative flex-1 w-full h-full overflow-hidden flex flex-col items-center justify-center min-h-0">
            {/* ----------------------------------------------------------------- */}
            {/* CASE 1: ACTIVE IN-ROOM DOCUMENT STAGE (PRESENTED FILE) */}
            {/* ----------------------------------------------------------------- */}
            {activeStageFile && (
              <div className="relative w-full h-full flex flex-col bg-background-primary-default overflow-hidden z-10">
                {/* Stage Header Banner — Clean, uncluttered layout */}
                <div className="h-12 px-3 sm:px-4 border-b border-border-button-default bg-background-secondary-default/90 backdrop-blur-md flex items-center justify-between shrink-0 z-20 gap-2">
                  <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
                    <div className="size-7 rounded-lg bg-background-primary-default border border-border-button-default flex items-center justify-center shrink-0 text-accent-500">
                      <RiPresentationLine className="size-4" />
                    </div>
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-body-2-medium font-semibold text-text-primary truncate" title={activeStageFile.name}>
                        {activeStageFile.name}
                      </span>
                      <Chip color="lime" variant="caption" className="shrink-0 hidden xs:inline-flex">
                        {activeStageFile.name.split(".").pop()?.toUpperCase() || "DOC"}
                      </Chip>
                    </div>
                  </div>

                  {/* Stage Right Actions */}
                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    {/* Open External / In New Tab */}
                    {activeStageFile.dataUrl && (
                      <a
                        href={activeStageFile.dataUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="size-8 rounded-lg border border-border-button-default bg-background-primary-default hover:bg-background-secondary-hover flex items-center justify-center text-text-secondary transition-colors"
                        title="Open file in new tab"
                      >
                        <RiExternalLinkLine className="size-4" />
                      </a>
                    )}

                    {/* Toggle Focus Mode (Expands stage to 100% full width) */}
                    <Button
                      variant={isFocusMode ? "primary" : "secondary"}
                      size="xs"
                      leadingIcon={isFocusMode ? RiLayoutRightLine : RiFullscreenLine}
                      onClick={() => setIsFocusMode(!isFocusMode)}
                    >
                      {isFocusMode ? "Show Workspace" : "Focus"}
                    </Button>

                    {/* Close Document Stage */}
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => togglePresentFile(null)}
                      leadingIcon={RiCloseLine}
                    >
                      Close Stage
                    </Button>
                  </div>
                </div>

                {/* Stage Document Content Area — Unobstructed, pristine desk canvas */}
                <div className="flex-1 w-full min-h-0 relative overflow-hidden flex items-center justify-center p-2.5 sm:p-3 bg-background-tertiary-default/20">
                  {activeStageFile.type.includes("pdf") || activeStageFile.name.toLowerCase().endsWith(".pdf") ? (
                    <div className="w-full h-full rounded-2xl border border-border-button-default bg-white shadow-sm overflow-hidden flex flex-col">
                      <iframe
                        src={`${activeStageFile.dataUrl}#toolbar=0&navpanes=0`}
                        className="w-full h-full border-0"
                        title={activeStageFile.name}
                      />
                    </div>
                  ) : activeStageFile.type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "svg"].some((ext) => activeStageFile.name.toLowerCase().endsWith(ext)) ? (
                    <div className="w-full h-full flex items-center justify-center overflow-auto p-2">
                      <img
                        src={activeStageFile.dataUrl}
                        alt={activeStageFile.name}
                        className="max-h-full max-w-full object-contain rounded-2xl border border-border-button-default shadow-md"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center p-6 gap-3 max-w-sm bg-background-primary-default rounded-3xl border border-border-button-default shadow-sm">
                      <div className="size-12 rounded-2xl bg-background-secondary-default border border-border-button-default flex items-center justify-center text-accent-500">
                        <RiFileLine className="size-6" />
                      </div>
                      <div>
                        <h4 className="text-title-3-semibold text-text-primary">{activeStageFile.name}</h4>
                        <p className="text-body-2-regular text-text-secondary mt-1">
                          Document presented on stage. You can download or preview locally.
                        </p>
                      </div>
                      {activeStageFile.dataUrl && (
                        <a
                          href={activeStageFile.dataUrl}
                          download={activeStageFile.name}
                          className="px-3.5 py-1.5 rounded-xl bg-accent-500 text-text-primary text-caption-1-semibold font-semibold hover:opacity-90 flex items-center gap-1.5 shadow-sm"
                        >
                          <RiDownloadLine className="size-4" />
                          <span>Download File</span>
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* ------------------------------------------------------------- */}
                {/* DEDICATED BOTTOM ACTION SHELF (WHEN PRESENTING A FILE)        */}
                {/* Sits BELOW the document so ZERO pixels of text are covered!   */}
                {/* ------------------------------------------------------------- */}
                <div className="h-14 px-4 sm:px-6 border-t border-border-button-default bg-background-primary-default/95 backdrop-blur-md flex items-center justify-between shrink-0 z-20">
                  <div className="flex items-center gap-2 min-w-0 ps-10 lg:ps-0">
                    <Avatar size="xs" initials={hostInitials} color="blue" />
                    <span className="text-caption-1-semibold text-text-secondary hidden sm:inline truncate">
                      {room.booking.host.name} (Host)
                    </span>
                    <Chip color="soft" variant="caption" className="hidden md:inline-flex">
                      Stage Live
                    </Chip>
                  </div>

                  {/* Centered Controls Strip */}
                  <div className="flex items-center gap-2">
                    {/* Microphone Toggle */}
                    <button
                      type="button"
                      onClick={toggleMic}
                      aria-label={isMicMuted ? "Unmute microphone" : "Mute microphone"}
                      className={cx(
                        "size-9 rounded-full border flex items-center justify-center transition-colors cursor-pointer",
                        isMicMuted
                          ? "border-border-error-default bg-status-danger-background text-text-error-primary"
                          : "border-border-button-default bg-background-secondary-default text-text-primary hover:bg-background-secondary-hover"
                      )}
                    >
                      {isMicMuted ? <RiMicOffLine className="size-4" /> : <RiMicLine className="size-4" />}
                    </button>

                    {/* Camera Toggle */}
                    <button
                      type="button"
                      onClick={toggleCam}
                      aria-label={isCamOff ? "Turn on camera" : "Turn off camera"}
                      className={cx(
                        "size-9 rounded-full border flex items-center justify-center transition-colors cursor-pointer",
                        isCamOff
                          ? "border-border-error-default bg-status-danger-background text-text-error-primary"
                          : "border-border-button-default bg-background-secondary-default text-text-primary hover:bg-background-secondary-hover"
                      )}
                    >
                      {isCamOff ? <RiVideoOffLine className="size-4" /> : <RiVideoOnLine className="size-4" />}
                    </button>

                    {/* Screen Share Toggle */}
                    <button
                      type="button"
                      onClick={toggleScreenShare}
                      aria-label={isScreenSharing ? "Stop sharing screen" : "Share screen"}
                      className={cx(
                        "size-9 rounded-full border flex items-center justify-center transition-colors cursor-pointer",
                        isScreenSharing
                          ? "border-accent-500 bg-accent-500 text-text-primary shadow-sm"
                          : "border-border-button-default bg-background-secondary-default text-text-primary hover:bg-background-secondary-hover"
                      )}
                    >
                      <RiShareForwardBoxLine className="size-4" />
                    </button>
                  </div>

                  {/* Call State Button */}
                  <div>
                    {isConcluded ? (
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => {
                          window.location.href = "/dashboard";
                        }}
                      >
                        Exit
                      </Button>
                    ) : isCancelledOrRejected ? (
                      <Badge color="neutral">
                        {isBookingCancelled ? "Cancelled" : "Declined"}
                      </Badge>
                    ) : !isCallActive ? (
                      <Button
                        variant="primary"
                        size="xs"
                        leadingIcon={RiVideoOnLine}
                        onClick={() => setIsCallActive(true)}
                        disabled={!isBookingEligible}
                      >
                        Start Call
                      </Button>
                    ) : isHost ? (
                      <Button
                        variant="primary"
                        size="xs"
                        onClick={handleConcludeCall}
                        disabled={isSynthesizing}
                      >
                        {isSynthesizing ? "Synthesizing..." : "End Meeting"}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={handleLeaveCall}
                      >
                        Leave Call
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ----------------------------------------------------------------- */}
            {/* CASE 2: ACTIVE OS SCREEN SHARE */}
            {/* ----------------------------------------------------------------- */}
            {!isDisplayingStageFile && (
              <video
                ref={screenShareVideoRef}
                autoPlay
                playsInline
                className={cx(
                  "w-full h-full object-contain bg-background-tertiary-default",
                  hasActivePresentation ? "block" : "hidden"
                )}
              />
            )}

            {/* ----------------------------------------------------------------- */}
            {/* CASE 3: GUEST HERO VIDEO FEED */}
            {/* ----------------------------------------------------------------- */}
            {!isDisplayingStageFile && (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className={cx(
                  "w-full h-full object-cover",
                  !hasActivePresentation && remoteHasVideo ? "block" : "hidden"
                )}
              />
            )}

            {/* ----------------------------------------------------------------- */}
            {/* CASE 4: HOST CAMERA STREAMING (HERO PREVIEW BEFORE GUEST ARRIVAL) */}
            {/* ----------------------------------------------------------------- */}
            {isCallActive && !isDisplayingStageFile && !hasActivePresentation && !remoteHasVideo && !isCamOff && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
            )}

            {/* ----------------------------------------------------------------- */}
            {/* CASE 0: MEETING CONCLUDED (EXECUTIVE RECORD HERO)                */}
            {/* ----------------------------------------------------------------- */}
            {isConcluded && !isDisplayingStageFile && (
              <div className="flex flex-col items-center justify-center text-center p-6 gap-4 z-10 max-w-md">
                <div className="size-16 rounded-3xl bg-background-primary-default border border-border-button-default flex items-center justify-center text-accent-500 shadow-sm">
                  <RiBookOpenLine className="size-8" />
                </div>
                <div>
                  <h3 className="text-title-2-medium font-semibold text-text-primary">
                    Meeting Concluded
                  </h3>
                  <p className="text-body-2-regular text-text-secondary mt-1.5 leading-relaxed">
                    Vera has synthesized the executive summary, decisions, and action items. This room remains permanently available to review records, notes, and attached documents.
                  </p>
                </div>

                <div className="flex items-center gap-2.5 mt-2">
                  <Button
                    variant="primary"
                    size="small"
                    leadingIcon={RiBookOpenLine}
                    onClick={() => setActiveTab("summary")}
                  >
                    View Summary
                  </Button>
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => {
                      window.location.href = "/dashboard";
                    }}
                  >
                    Exit to Dashboard
                  </Button>
                </div>
              </div>
            )}

            {/* ----------------------------------------------------------------- */}
            {/* CASE: CANCELLED OR DECLINED BOOKING */}
            {/* ----------------------------------------------------------------- */}
            {!isConcluded && isCancelledOrRejected && (
              <div className="flex flex-col items-center justify-center text-center p-6 gap-3 z-10 max-w-sm">
                <div className="size-16 rounded-3xl bg-background-primary-default border border-border-button-default flex items-center justify-center text-text-error-primary shadow-sm">
                  <RiCalendarCloseLine className="size-8" />
                </div>
                <div>
                  <h3 className="text-title-3-semibold text-text-primary">
                    {isBookingCancelled ? "Meeting Cancelled" : "Meeting Declined"}
                  </h3>
                  <p className="text-body-2-regular text-text-secondary mt-1">
                    {isBookingCancelled
                      ? "This booking was cancelled and video sessions are disabled."
                      : "This booking was declined."}
                    {" "}Collaborative agenda, shared notes, and files remain preserved.
                  </p>
                </div>
              </div>
            )}

            {/* ----------------------------------------------------------------- */}
            {/* CASE 5: PRE-MEETING SCREEN / AWAITING PEER */}
            {/* ----------------------------------------------------------------- */}
            {!isConcluded && !isCancelledOrRejected && !isDisplayingStageFile && (!isCallActive || (!hasActivePresentation && !remoteHasVideo && isCamOff)) && (
              <div className="flex flex-col items-center justify-center text-center p-6 gap-3 z-10 max-w-sm">
                <div className="relative">
                  <Avatar size="lg" initials={isHost ? guestInitials : hostInitials} color={isHost ? "lime" : "blue"} />
                  <span className="absolute -bottom-1 -end-1 size-3.5 rounded-full bg-status-lime-text ring-2 ring-background-primary-default animate-pulse" />
                </div>
                <div>
                  <h3 className="text-title-3-semibold text-text-primary">
                    {remoteParticipantName}
                  </h3>
                  <p className="text-body-2-regular text-text-secondary mt-1">
                    {isCallActive
                      ? `Awaiting ${remoteParticipantName} in Morrow room...`
                      : "The room is ready. Start the session when you are set."}
                  </p>
                </div>
              </div>
            )}

            {/* Screen Share Overlay Tag */}
            {hasActivePresentation && !isDisplayingStageFile && !isConcluded && (
              <div className="absolute top-4 start-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-background-primary-default/90 backdrop-blur-md border border-border-button-default text-caption-1-semibold text-text-primary shadow-lg z-20">
                <span className="size-2 rounded-full bg-accent-500 animate-pulse" />
                <span>{screenSharePresenter?.name} is presenting screen</span>
                {screenSharePresenter?.isLocal && (
                  <button
                    type="button"
                    onClick={toggleScreenShare}
                    className="text-caption-2-medium text-text-error-primary hover:underline ms-1 cursor-pointer"
                  >
                    Stop Sharing
                  </button>
                )}
              </div>
            )}

            {/* Speaking / Audio Indicator Pill */}
            {isRemoteSpeaking && !hasActivePresentation && !isDisplayingStageFile && !isConcluded && (
              <div className="absolute top-4 start-4 flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent-500 text-text-primary text-caption-1-semibold shadow-lg z-20">
                <RiVolumeUpLine className="size-4" />
                <span>{remoteParticipantName} speaking</span>
              </div>
            )}

            {/* Floating Picture-in-Picture Self-View (When Guest Video, Screen Share or File Presentation is Active) */}
            {isCallActive && !isConcluded && (remoteHasVideo || hasActivePresentation || isDisplayingStageFile) && (
              <div className="absolute top-14 end-3 sm:top-14 sm:end-4 w-32 h-20 sm:w-40 sm:h-24 rounded-2xl border border-border-button-default bg-background-primary-default overflow-hidden shadow-xl z-30">
                {!isCamOff ? (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover scale-x-[-1]"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-text-secondary">
                    <Avatar size="xs" initials={isHost ? hostInitials : guestInitials} color={isHost ? "blue" : "lime"} />
                    <span className="text-caption-2-medium text-text-tertiary">Camera Off</span>
                  </div>
                )}
                <div className="absolute bottom-1.5 start-1.5 px-2 py-0.5 rounded-full bg-background-primary-default/80 backdrop-blur-xs text-caption-2-medium text-text-primary">
                  You
                </div>
              </div>
            )}

            {/* Participant Status Watermark */}
            {!hasActivePresentation && !isDisplayingStageFile && !isConcluded && (
              <div className="absolute bottom-20 start-4 z-10 flex items-center gap-2 px-3 py-1 rounded-full bg-background-primary-default/80 backdrop-blur-md border border-border-button-default text-caption-1-semibold text-text-primary shadow-2xs">
                <span className="size-2 rounded-full bg-accent-500" />
                <span>
                  {remoteHasVideo ? remoteParticipantName : `${currentUserName} (You)`}
                </span>
                {isMicMuted && <RiMicOffLine className="size-3.5 text-text-error-primary" />}
              </div>
            )}

            {/* =================================================================== */}
            {/* FLOATING ORBIT CONTROL DOCK (ONLY SHOWN DURING ACTIVE / PRE-CALL)  */}
            {/* When a document is presented or call concluded, dock adjusts        */}
            {/* =================================================================== */}
            {!isDisplayingStageFile && !isConcluded && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
                <div className="p-1.5 sm:p-2 rounded-full border border-border-button-default bg-background-primary-default/95 backdrop-blur-xl shadow-2xl flex items-center gap-2">
                  {/* Microphone Toggle */}
                  <button
                    type="button"
                    onClick={toggleMic}
                    aria-label={isMicMuted ? "Unmute microphone" : "Mute microphone"}
                    className={cx(
                      "size-10 sm:size-11 rounded-full border flex items-center justify-center transition-colors cursor-pointer",
                      isMicMuted
                        ? "border-border-error-default bg-status-danger-background text-text-error-primary"
                        : "border-border-button-default bg-background-secondary-default text-text-primary hover:bg-background-secondary-hover"
                    )}
                  >
                    {isMicMuted ? <RiMicOffLine className="size-5" /> : <RiMicLine className="size-5" />}
                  </button>

                  {/* Camera Toggle */}
                  <button
                    type="button"
                    onClick={toggleCam}
                    aria-label={isCamOff ? "Turn on camera" : "Turn off camera"}
                    className={cx(
                      "size-10 sm:size-11 rounded-full border flex items-center justify-center transition-colors cursor-pointer",
                      isCamOff
                        ? "border-border-error-default bg-status-danger-background text-text-error-primary"
                        : "border-border-button-default bg-background-secondary-default text-text-primary hover:bg-background-secondary-hover"
                    )}
                  >
                    {isCamOff ? <RiVideoOffLine className="size-5" /> : <RiVideoOnLine className="size-5" />}
                  </button>

                  {/* Screen Share Toggle */}
                  <button
                    type="button"
                    onClick={toggleScreenShare}
                    aria-label={isScreenSharing ? "Stop sharing screen" : "Share screen"}
                    className={cx(
                      "size-10 sm:size-11 rounded-full border flex items-center justify-center transition-colors cursor-pointer",
                      isScreenSharing
                        ? "border-accent-500 bg-accent-500 text-text-primary shadow-sm"
                        : "border-border-button-default bg-background-secondary-default text-text-primary hover:bg-background-secondary-hover"
                      )}
                  >
                    <RiShareForwardBoxLine className="size-5" />
                  </button>

                  {/* Mobile View Toggle */}
                  <button
                    type="button"
                    onClick={() => setMobileMode("canvas")}
                    aria-label="Open collaborative canvas"
                    className="lg:hidden size-10 rounded-full border border-border-button-default bg-background-secondary-default text-text-primary flex items-center justify-center cursor-pointer"
                  >
                    <RiFileListLine className="size-5" />
                  </button>

                  <div className="h-6 w-px bg-border-button-default mx-0.5 hidden sm:block" />

                  {/* Call State Button */}
                  {!isCallActive ? (
                    <Button
                      variant="primary"
                      size="small"
                      leadingIcon={RiVideoOnLine}
                      onClick={() => setIsCallActive(true)}
                      disabled={!isBookingEligible}
                    >
                      Start Call
                    </Button>
                  ) : isHost ? (
                    <Button
                      variant="primary"
                      size="small"
                      onClick={handleConcludeCall}
                      disabled={isSynthesizing}
                    >
                      {isSynthesizing ? "Synthesizing..." : "End Meeting"}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={handleLeaveCall}
                    >
                      Leave Call
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ======================================================================= */}
        {/* RIGHT POD: COLLABORATIVE CANVAS WORKSPACE */}
        {/* ======================================================================= */}
        <section
          className={cx(
            "w-full lg:w-[400px] xl:w-[440px] shrink-0 h-full flex flex-col rounded-3xl border border-border-button-default bg-background-primary-default overflow-hidden shadow-sm min-h-0 transition-all duration-300",
            mobileMode === "call" ? "hidden lg:flex" : "flex",
            isFocusMode ? "hidden" : "flex"
          )}
        >
          {/* Canvas Navigation Tabs — Rock-solid 4-column Segmented Control */}
          <div className="p-3 border-b border-border-button-default bg-background-secondary-default/30 shrink-0">
            {/* Mobile Back-to-Stage Header (only visible on mobile screens) */}
            <div className="lg:hidden flex items-center justify-between pb-2 mb-2 border-b border-border-button-default">
              <span className="text-caption-1-semibold text-text-secondary">Workspace Canvas</span>
              <button
                type="button"
                onClick={() => setMobileMode("call")}
                className="text-caption-1-semibold text-accent-600 hover:text-accent-500 flex items-center gap-1 cursor-pointer"
              >
                Back to Stage →
              </button>
            </div>

            <div className="w-full grid grid-cols-4 p-1 rounded-xl bg-background-secondary-default border border-border-button-default gap-0.5">
              {/* Agenda Tab */}
              <button
                type="button"
                onClick={() => setActiveTab("agenda")}
                className={cx(
                  "py-1.5 px-1 rounded-lg text-caption-1-semibold transition-all cursor-pointer flex items-center justify-center gap-1 min-w-0",
                  activeTab === "agenda"
                    ? "bg-background-primary-default text-text-primary shadow-2xs font-semibold"
                    : "text-text-secondary hover:text-text-primary"
                )}
                title="Agenda"
              >
                <RiFileListLine className="size-3.5 shrink-0" />
                <span className="truncate">Agenda</span>
                {agenda.filter((a) => a.done).length > 0 && (
                  <span className="text-caption-2-medium text-text-tertiary shrink-0">
                    ({agenda.filter((a) => a.done).length}/{agenda.length})
                  </span>
                )}
              </button>

              {/* Notes Tab */}
              <button
                type="button"
                onClick={() => setActiveTab("notes")}
                className={cx(
                  "py-1.5 px-1 rounded-lg text-caption-1-semibold transition-all cursor-pointer flex items-center justify-center gap-1 min-w-0",
                  activeTab === "notes"
                    ? "bg-background-primary-default text-text-primary shadow-2xs font-semibold"
                    : "text-text-secondary hover:text-text-primary"
                )}
                title="Shared Notes"
              >
                <RiEditLine className="size-3.5 shrink-0" />
                <span className="truncate">Notes</span>
                {isSavingNotes && <span className="size-1.5 rounded-full bg-accent-500 animate-pulse shrink-0" />}
              </button>

              {/* Files Tab */}
              <button
                type="button"
                onClick={() => setActiveTab("files")}
                className={cx(
                  "py-1.5 px-1 rounded-lg text-caption-1-semibold transition-all cursor-pointer flex items-center justify-center gap-1 min-w-0",
                  activeTab === "files"
                    ? "bg-background-primary-default text-text-primary shadow-2xs font-semibold"
                    : "text-text-secondary hover:text-text-primary"
                )}
                title="Room Documents"
              >
                <RiAttachment2 className="size-3.5 shrink-0" />
                <span className="truncate">Files</span>
                {files.length > 0 && (
                  <span className="text-caption-2-medium px-1.5 py-0.2 rounded-full bg-background-tertiary-default text-text-tertiary shrink-0">
                    {files.length}
                  </span>
                )}
              </button>

              {/* Summary Tab */}
              <button
                type="button"
                onClick={() => setActiveTab("summary")}
                className={cx(
                  "py-1.5 px-1 rounded-lg text-caption-1-semibold transition-all cursor-pointer flex items-center justify-center gap-1 min-w-0",
                  activeTab === "summary"
                    ? "bg-background-primary-default text-text-primary shadow-2xs font-semibold"
                    : "text-text-secondary hover:text-text-primary"
                )}
                title="Executive Summary"
              >
                <RiBookOpenLine className="size-3.5 shrink-0" />
                <span className="truncate">Summary</span>
                {summary && <span className="size-1.5 rounded-full bg-status-lime-text shrink-0" />}
              </button>
            </div>
          </div>

          {/* ===================================================================== */}
          {/* TAB 1: AGENDA & INTENT VIEW */}
          {/* ===================================================================== */}
          {activeTab === "agenda" && (
            <div className="relative min-h-0 flex-1 h-full overflow-hidden">
              <div
                onScroll={agendaFade.onScroll}
                className="h-full overflow-y-auto p-4 sm:p-5 flex flex-col gap-5"
              >
                {/* Meeting Intent Card */}
                {room.veraBrief?.intent && (
                  <div className="p-4 rounded-2xl border border-border-button-default bg-background-secondary-default/40 flex flex-col gap-1.5">
                    <span className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider">
                      Session Purpose
                    </span>
                    <p className="text-body-medium text-text-primary leading-relaxed font-medium">
                      {room.veraBrief.intent}
                    </p>
                    {room.veraBrief.background && (
                      <p className="text-body-2-regular text-text-secondary mt-1">
                        {room.veraBrief.background}
                      </p>
                    )}
                  </div>
                )}

                {/* Agenda Checklist */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-title-3-semibold text-text-primary">Collaborative Agenda</h3>
                    <span className="text-caption-2-medium text-text-tertiary">
                      Click items to mark complete
                    </span>
                  </div>

                  <div className="flex flex-col gap-2">
                    {agenda.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => handleToggleAgendaItem(item.id)}
                        className={cx(
                          "p-3 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 select-none",
                          item.done
                            ? "border-border-button-default bg-background-secondary-default/30 opacity-60 line-through"
                            : "border-border-button-default bg-background-primary-default hover:border-accent-500/50 shadow-2xs"
                        )}
                      >
                        <Checkbox
                          isSelected={item.done}
                          onChange={() => handleToggleAgendaItem(item.id)}
                          aria-label={item.text}
                        />
                        <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                          <span className="text-body-medium text-text-primary break-words">
                            {item.text}
                          </span>
                          {item.addedBy === "vera" && (
                            <Chip color="soft" variant="caption" className="shrink-0">
                              Vera
                            </Chip>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add Custom Agenda Item Form */}
                  <form onSubmit={handleAddAgendaItem} className="mt-1 flex items-center gap-2">
                    <input
                      type="text"
                      value={newAgendaText}
                      onChange={(e) => setNewAgendaText(e.target.value)}
                      placeholder="Add an agenda topic..."
                      className="flex-1 h-9 px-3 rounded-xl border border-border-button-default bg-background-secondary-default/50 text-body-medium text-text-primary placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-border-focus-ring"
                    />
                    <Button type="submit" variant="secondary" size="xs" leadingIcon={RiAddLine}>
                      Add
                    </Button>
                  </form>
                </div>

                {/* Vera Discussion Points */}
                {room.veraBrief?.talkingPoints && room.veraBrief.talkingPoints.length > 0 && (
                  <div className="p-4 rounded-2xl border border-border-button-default bg-background-secondary-default/20 flex flex-col gap-2">
                    <span className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider">
                      Recommended Discussion Points
                    </span>
                    <ul className="flex flex-col gap-1.5 list-disc list-inside text-body-2-regular text-text-secondary">
                      {room.veraBrief.talkingPoints.map((tp, idx) => (
                        <li key={idx} className="leading-relaxed">
                          {tp}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <ScrollFade progress={agendaFade.progress} surfaceClassName="from-background-primary-default" />
            </div>
          )}

          {/* ===================================================================== */}
          {/* TAB 2: LIVE SHARED NOTES SURFACE */}
          {/* ===================================================================== */}
          {activeTab === "notes" && (
            <div className="flex-1 p-4 sm:p-5 flex flex-col gap-3 min-h-0 h-full">
              <div className="flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-title-3-semibold text-text-primary">Shared Notes</h3>
                  <p className="text-body-2-regular text-text-secondary">
                    Changes save automatically and sync to the meeting summary.
                  </p>
                </div>
                <span className="text-caption-2-medium text-text-tertiary">
                  {isSavingNotes ? "Saving..." : "All changes saved"}
                </span>
              </div>

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Capture thoughts, links, and notes during the session..."
                className="flex-1 w-full h-full min-h-[380px] p-4 rounded-2xl border border-border-button-default bg-background-secondary-default/30 text-body-medium text-text-primary placeholder:text-text-placeholder resize-none focus:outline-none focus:ring-2 focus:ring-border-focus-ring leading-relaxed"
              />
            </div>
          )}

          {/* ===================================================================== */}
          {/* TAB 3: SHARED DOCUMENTS & ATTACHMENTS (PERSISTENT ROOM FILES) */}
          {/* ===================================================================== */}
          {activeTab === "files" && (
            <div className="relative min-h-0 flex-1 h-full overflow-hidden">
              <div
                onScroll={filesFade.onScroll}
                className="h-full overflow-y-auto p-4 sm:p-5 flex flex-col gap-5"
              >
                <div>
                  <h3 className="text-title-3-semibold text-text-primary">Room Documents & Files</h3>
                  <p className="text-body-2-regular text-text-secondary mt-0.5">
                    Files dropped here remain permanently accessible and can be presented live on stage during the call.
                  </p>
                </div>

                {/* BoardUI Drag-and-Drop Uploader */}
                <div className="p-1">
                  <FileUpload
                    onUploadComplete={handleFileUpload}
                    allowedExtensions={["pdf", "jpg", "jpeg", "png", "xlsx", "docx", "csv", "pptx"]}
                    maxBytes={15 * 1024 * 1024}
                  />
                </div>

                {/* File List */}
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider shrink-0">
                      Attached Files ({files.length})
                    </span>
                    {activeStageFile && (
                      <Chip color="lime" variant="caption" className="shrink-0">
                        Live on stage
                      </Chip>
                    )}
                  </div>

                  {files.length === 0 ? (
                    <div className="p-6 rounded-2xl border border-dashed border-border-button-default flex flex-col items-center justify-center text-center gap-2 bg-background-secondary-default/20">
                      <RiAttachment2 className="size-6 text-text-tertiary" />
                      <p className="text-body-2-regular text-text-secondary">
                        No files uploaded yet. Drop pitch decks, proposals, or assets above.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {files.map((file) => {
                        const isImage = file.type.startsWith("image/");
                        const isSpreadsheet = file.type.includes("sheet") || file.name.endsWith(".xlsx") || file.name.endsWith(".csv");
                        const Icon = isImage ? RiImageLine : isSpreadsheet ? RiTableLine : RiFileLine;
                        const isCurrentlyPresented = activeStageFile?.id === file.id;

                        return (
                          <div
                            key={file.id}
                            className={cx(
                              "p-3.5 rounded-2xl border transition-all flex flex-col gap-2.5 shadow-2xs",
                              isCurrentlyPresented
                                ? "border-accent-500 bg-accent-500/5 ring-1 ring-accent-500/20"
                                : "border-border-button-default bg-background-primary-default hover:border-accent-500/40"
                            )}
                          >
                            {/* Top Row: File Details */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <div className="size-9 rounded-xl bg-background-secondary-default border border-border-button-default flex items-center justify-center shrink-0 text-text-secondary">
                                  <Icon className="size-4" />
                                </div>
                                <div className="flex flex-col min-w-0 flex-1">
                                  <span className="text-body-medium font-semibold text-text-primary truncate" title={file.name}>
                                    {file.name}
                                  </span>
                                  <span className="text-caption-2-medium text-text-tertiary truncate">
                                    {formatFileSize(file.size)} • {file.uploadedAt}
                                  </span>
                                </div>
                              </div>

                              {isCurrentlyPresented && (
                                <Chip color="lime" variant="caption" className="shrink-0">
                                  On Stage
                                </Chip>
                              )}
                            </div>

                            {/* Bottom Row: Separated Actions to ensure ZERO overlapping */}
                            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-button-default/50">
                              <Button
                                variant={isCurrentlyPresented ? "secondary" : "primary"}
                                size="xs"
                                leadingIcon={isCurrentlyPresented ? RiCloseLine : RiPresentationLine}
                                onClick={() => togglePresentFile(file)}
                              >
                                {isCurrentlyPresented ? "Close Stage" : "Present"}
                              </Button>

                              {file.dataUrl && (
                                <a
                                  href={file.dataUrl}
                                  download={file.name}
                                  className="px-3 py-1.5 rounded-xl border border-border-button-default bg-background-secondary-default hover:bg-background-secondary-hover text-text-primary text-caption-1-semibold flex items-center gap-1.5 transition-colors"
                                >
                                  <RiDownloadLine className="size-3.5" />
                                  <span>Download</span>
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <ScrollFade progress={filesFade.progress} surfaceClassName="from-background-primary-default" />
            </div>
          )}

          {/* ===================================================================== */}
          {/* TAB 4: VERA'S SUMMARY (PERMANENT RECORD) */}
          {/* ===================================================================== */}
          {activeTab === "summary" && (
            <div className="relative min-h-0 flex-1 h-full flex flex-col overflow-hidden">
              {!summary ? (
                <>
                  {synthesisState === "synthesizing" && (
                    <div className="p-8 rounded-3xl border border-border-button-default flex flex-col items-center text-center gap-4 bg-background-secondary-default/20 my-auto m-4">
                      <div className="size-12 rounded-2xl bg-accent-500/10 border border-accent-500/20 flex items-center justify-center text-accent-500 animate-pulse">
                        <RiSparklingLine className="size-6" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <h4 className="text-title-3-semibold text-text-primary">
                          Vera is Synthesizing the Record
                        </h4>
                        <p className="text-body-2-regular text-text-secondary max-w-sm">
                          Analyzing conversation context, notes, and agenda to extract definitive decisions and action items.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-caption-1-medium text-text-tertiary">
                        <RiLoader4Line className="size-4 animate-spin" />
                        <span>Processing with Vera Intelligence...</span>
                      </div>
                    </div>
                  )}

                  {synthesisState === "timed_out_waiting" && (
                    <div className="p-8 rounded-3xl border border-border-button-default flex flex-col items-center text-center gap-4 bg-background-secondary-default/20 my-auto m-4">
                      <Avatar size="lg" initials="V" color="neutral" />
                      <div className="flex flex-col gap-1">
                        <h4 className="text-title-3-semibold text-text-primary">
                          Synthesis Still in Progress
                        </h4>
                        <p className="text-body-2-regular text-text-secondary max-w-sm">
                          Vera is taking a bit longer than usual to analyze this session. You can safely close or revisit this room at any time; your record will be preserved when ready.
                        </p>
                      </div>
                      {isHost && (
                        <Button
                          variant="secondary"
                          size="small"
                          leadingIcon={RiRefreshLine}
                          onClick={async () => {
                            const res = await fetch(`/api/room/${room.accessToken}`);
                            const data = await res.json().catch(() => ({}));
                            if (data.success && data.room?.veraLedger) {
                              setSummary(data.room.veraLedger);
                              setSynthesisState("completed");
                            } else if (data.success && data.room?.synthesisStatus === "failed") {
                              setSynthesisState("failed");
                            }
                          }}
                        >
                          Check Status
                        </Button>
                      )}
                    </div>
                  )}

                  {synthesisState === "failed" && (
                    <div className="p-8 rounded-3xl border border-border-button-default flex flex-col items-center text-center gap-4 bg-background-secondary-default/20 my-auto m-4">
                      <div className="size-12 rounded-2xl bg-border-error-default/10 border border-border-error-default/20 flex items-center justify-center text-text-error-primary">
                        <RiAlertLine className="size-6" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <h4 className="text-title-3-semibold text-text-primary">
                          Summary Generation Incomplete
                        </h4>
                        <p className="text-body-2-regular text-text-secondary max-w-sm">
                          Vera encountered an error while synthesizing the meeting record. No decisions or action items were invented or assumed.
                        </p>
                      </div>
                      {isHost ? (
                        <Button
                          variant="primary"
                          size="small"
                          leadingIcon={RiRefreshLine}
                          onClick={handleConcludeCall}
                          disabled={isSynthesizing}
                        >
                          {isSynthesizing ? "Retrying Synthesis..." : "Retry Vera Synthesis"}
                        </Button>
                      ) : (
                        <p className="text-caption-1-medium text-text-tertiary">
                          The host can retry summary generation from this room.
                        </p>
                      )}
                    </div>
                  )}

                  {synthesisState === "idle" && (
                    <div className="p-8 rounded-3xl border border-dashed border-border-button-default flex flex-col items-center text-center gap-3 bg-background-secondary-default/20 my-auto m-4">
                      <Avatar size="lg" initials="V" color="neutral" />
                      <h4 className="text-title-3-semibold text-text-primary">
                        Summary Awaiting Call Conclusion
                      </h4>
                      <p className="text-body-2-regular text-text-secondary max-w-sm">
                        Once the discussion wraps, conclude the call to have Vera extract key decisions, assign action items, and generate the executive summary.
                      </p>
                      {isHost ? (
                        <Button
                          variant="primary"
                          size="small"
                          onClick={handleConcludeCall}
                          disabled={isSynthesizing}
                        >
                          {isSynthesizing ? "Vera Generating Summary..." : "End Meeting & Generate Summary"}
                        </Button>
                      ) : (
                        <p className="text-caption-1-medium text-text-tertiary">
                          Meeting takeaways and action items will be generated once the host concludes the call.
                        </p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="relative min-h-0 flex-1 h-full">
                  <div
                    onScroll={summaryFade.onScroll}
                    className="h-full overflow-y-auto p-4 sm:p-5 flex flex-col gap-5"
                  >
                    {/* Executive Summary */}
                    <div className="p-4 rounded-2xl border border-border-button-default bg-background-secondary-default/40 flex flex-col gap-2">
                      <span className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider">
                        Executive Summary
                      </span>
                      <div className="flex flex-col gap-2">
                        {summary.executiveSummary.map((item, idx) => (
                          <p key={idx} className="text-body-medium text-text-primary leading-relaxed">
                            {item}
                          </p>
                        ))}
                      </div>
                    </div>

                    {/* Key Decisions */}
                    {summary.keyDecisions && summary.keyDecisions.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <span className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider">
                          Key Decisions Made
                        </span>
                        <div className="grid grid-cols-1 gap-2">
                          {summary.keyDecisions.map((decision, idx) => (
                            <div
                              key={idx}
                              className="p-3 rounded-xl border border-border-button-default bg-background-primary-default flex items-start gap-2.5 shadow-2xs"
                            >
                              <RiCheckLine className="size-4 text-accent-500 shrink-0 mt-0.5" />
                              <span className="text-body-medium text-text-primary font-medium leading-relaxed">
                                {decision}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Assigned Action Items */}
                    {summary.actionItems && summary.actionItems.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <span className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider">
                          Assigned Action Items ({summary.actionItems.length})
                        </span>
                        <div className="flex flex-col gap-2.5">
                          {summary.actionItems.map((action) => (
                            <div
                              key={action.id}
                              className="p-3.5 rounded-2xl border border-border-button-default bg-background-primary-default flex flex-col gap-2 shadow-2xs"
                            >
                              <span className="text-body-medium text-text-primary font-medium leading-snug break-words">
                                {action.task}
                              </span>
                              <div className="flex items-center justify-between pt-2 border-t border-border-button-default/50 text-caption-1-semibold">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <Avatar size="xs" initials={action.assignee.slice(0, 2).toUpperCase()} color="neutral" />
                                  <span className="text-caption-2-medium text-text-secondary truncate">{action.assignee}</span>
                                </div>
                                <Chip
                                  color={action.priority === "high" ? "rose" : "blue"}
                                  variant="caption"
                                  className="shrink-0"
                                >
                                  {action.priority.toUpperCase()}
                                </Chip>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Suggested Follow-up */}
                    {summary.suggestedFollowUp && (
                      <div className="p-4 rounded-2xl border border-border-button-default bg-background-secondary-default/30 flex items-start gap-3">
                        <RiTimeLine className="size-4 text-text-secondary shrink-0 mt-0.5" />
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <span className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider">
                            Suggested Next Step
                          </span>
                          <span className="text-body-2-regular text-text-secondary leading-relaxed">
                            {summary.suggestedFollowUp}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <ScrollFade progress={summaryFade.progress} surfaceClassName="from-background-primary-default" />
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
