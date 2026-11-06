"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badge";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { FileUpload, formatFileSize } from "@/components/base/file-upload/file-upload";
import { MorrowLogo } from "@/components/brand/morrow-logo";
import { ScrollFade, useScrollFade } from "@/components/foundations/scroll-fade/scroll-fade";
import { cx } from "@/utils/cx";
import { MarkdownViewer } from "@/components/shared/markdown-viewer";
import {
  RiMicLine,
  RiMicOffLine,
  RiVideoOnLine,
  RiVideoOffLine,
  RiShareForwardBoxLine,
  RiPresentationLine,
  RiCloseLine,
  RiExternalLinkLine,
  RiAttachment2,
  RiDownloadLine,
  RiFileCopyLine,
  RiCheckLine,
  RiFileListLine,
  RiEditLine,
  RiBookOpenLine,
  RiTimeLine,
  RiVolumeUpLine,
  RiCalendarCloseLine,
  RiRefreshLine,
  RiAlertLine,
  RiLoader4Line,
  RiGroupLine,
  RiDeleteBinLine,
  RiMoreFill,
  RiFullscreenLine,
  RiFullscreenExitLine,
  RiArrowRightLine,
} from "@remixicon/react";
import type { RoomDetails, RoomFileItem } from "@/lib/room/room-service";
import type { VeraLedger } from "@/lib/intelligence/vera";

type LiveKitRoomType = import("livekit-client").Room;

export interface RoomViewProps {
  initialRoom: RoomDetails;
  isHost?: boolean;
  attendeeProfile?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

export interface GroupParticipant {
  identity: string;
  name: string;
  isSpeaking: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  videoTrack?: any;
  audioTrack?: any;
}

// =============================================================================
// VIDEO TRACK VIEW (WEBKIT AUTOPLAY & CSS MEDIA CONTROLS SUPPRESSION)
// =============================================================================
function VideoTrackView({
  track,
  stream,
  isLocal = false,
  className,
}: {
  track?: any;
  stream?: MediaStream | null;
  isLocal?: boolean;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    // WebKit / iOS Safari requires muted=true on all video tags to prevent pause overlay & autoplay blocks.
    // Audio is piped through dedicated <audio> tags via WebRTC remoteAudioContainerRef.
    el.muted = true;
    el.defaultMuted = true;
    el.playsInline = true;
    el.setAttribute("muted", "");
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "true");

    if (track && typeof track.attach === "function") {
      try {
        track.attach(el);
      } catch (err) {
        console.warn("[VideoTrackView] attach notice:", err);
      }

      el.muted = true;
      const playPromise = el.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          el.muted = true;
          el.play().catch(() => {});
        });
      }

      return () => {
        try {
          track.detach(el);
        } catch {
          // Safe detach
        }
      };
    } else if (stream) {
      el.srcObject = stream;
      el.muted = true;
      const playPromise = el.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          el.muted = true;
          el.play().catch(() => {});
        });
      }

      return () => {
        if (el) el.srcObject = null;
      };
    }
  }, [track, stream, isLocal]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      controls={false}
      disablePictureInPicture
      disableRemotePlayback
      muted
      className={cx("pointer-events-none select-none object-cover", className)}
    />
  );
}

// =============================================================================
// MIC VOLUME METER (INTEGRATED LIVE AUDIO WAVE)
// =============================================================================
function MicVolumeMeter({
  stream,
  isMuted,
  className,
}: {
  stream?: MediaStream | null;
  isMuted?: boolean;
  className?: string;
}) {
  const [volume, setVolume] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    if (!stream || isMuted) {
      setVolume(0);
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0 || !audioTracks[0].enabled) {
      setVolume(0);
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.4;
      analyserRef.current = analyser;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateMeter = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        setVolume(normalized);
        animFrameRef.current = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch (err) {
      console.warn("[MicVolumeMeter] AudioContext init notice:", err);
    }

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch {}
        sourceRef.current = null;
      }
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }
    };
  }, [stream, isMuted]);

  return (
    <div className={cx("flex items-center gap-1.5", className)}>
      {isMuted ? (
        <span className="text-caption-2-medium text-text-error-primary flex items-center gap-1">
          <RiMicOffLine className="size-3.5" />
          <span>Muted</span>
        </span>
      ) : (
        <div className="flex items-center gap-1">
          <RiMicLine className="size-3.5 text-status-lime-text shrink-0" />
          <div className="flex items-center gap-0.5 h-3">
            {[0, 20, 40, 60, 80].map((threshold, idx) => (
              <span
                key={idx}
                className={cx(
                  "w-1 rounded-full transition-all duration-75",
                  volume > threshold
                    ? "bg-status-lime-text h-3"
                    : "bg-neutral-600 h-1.5"
                )}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PARTICIPANT TILE (CLEAN AVATAR FALLBACK & SINGLE NAME BADGE)
// =============================================================================
function ParticipantTile({
  name,
  isLocal = false,
  hasVideo,
  videoTrack,
  localStream,
  isSpeaking,
  isMuted,
}: {
  name: string;
  isLocal?: boolean;
  hasVideo: boolean;
  videoTrack?: any;
  localStream?: MediaStream | null;
  isSpeaking?: boolean;
  isMuted?: boolean;
}) {
  const cleanName = name.replace(/\s*\(You\)$/i, "").trim() || (isLocal ? "You" : "Guest");
  const initials =
    cleanName
      .split(" ")
      .filter(Boolean)
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "U";

  const isVideoTrackLive =
    Boolean(videoTrack) &&
    !videoTrack.isMuted &&
    (videoTrack.mediaStreamTrack ? videoTrack.mediaStreamTrack.readyState === "live" : true);

  const isLocalStreamLive =
    isLocal &&
    (localStream?.getVideoTracks().some((t: MediaStreamTrack) => t.readyState === "live" && t.enabled) ?? false);

  const hasActiveVisual =
    hasVideo &&
    (isVideoTrackLive || isLocalStreamLive);

  return (
    <div
      className={cx(
        "relative rounded-2xl overflow-hidden flex items-center justify-center transition-all duration-200 h-full w-full min-h-[120px] shadow-sm select-none",
        hasActiveVisual
          ? "bg-neutral-950 border border-border-button-default"
          : "bg-neutral-900 border border-neutral-800",
        isSpeaking ? "ring-2 ring-accent-500 shadow-md" : ""
      )}
    >
      {hasActiveVisual ? (
        <VideoTrackView
          track={videoTrack}
          stream={isLocal && !videoTrack ? localStream : undefined}
          isLocal={isLocal}
          className={cx("w-full h-full object-cover", isLocal ? "scale-x-[-1]" : "")}
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 p-3 text-center">
          <Avatar
            size="lg"
            initials={initials}
            color={isLocal ? "blue" : "lime"}
            className={cx("ring-2 ring-white/10 shadow-md", isSpeaking ? "ring-accent-500 ring-4" : "")}
          />
          <span className="text-caption-2-medium text-neutral-400">
            {isLocal ? (hasVideo ? "Starting camera..." : "Camera Off") : (hasVideo ? "Connecting..." : "Camera Off")}
          </span>
        </div>
      )}

      {/* Single Bottom-Left Name Badge */}
      <div className="absolute bottom-2.5 start-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-xs text-white text-caption-2-medium max-w-[85%] z-10 shadow-xs pointer-events-none">
        {isMuted && <RiMicOffLine className="size-3 text-status-danger-text shrink-0" />}
        <span className="truncate">{cleanName} {isLocal ? "(You)" : ""}</span>
        {isSpeaking && (
          <span className="size-1.5 rounded-full bg-status-lime-text animate-pulse shrink-0 ms-0.5" />
        )}
      </div>
    </div>
  );
}

// =============================================================================
// MAIN MORROW ROOM COCKPIT
// =============================================================================
export function RoomView({
  initialRoom,
  isHost = false,
  attendeeProfile,
}: RoomViewProps) {
  const [room, setRoom] = useState<RoomDetails>(initialRoom);
  const [activeTab, setActiveTab] = useState<"notes" | "docs">("notes");
  const [mobileMode, setMobileMode] = useState<"call" | "canvas">("call");

  // Call & Media States
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [localVideoTrack, setLocalVideoTrack] = useState<any | null>(null);
  const [localMediaStream, setLocalMediaStream] = useState<MediaStream | null>(null);
  const localMediaStreamRef = useRef<MediaStream | null>(null);
  const [mediaPermissionState, setMediaPermissionState] = useState<"pending" | "granted" | "denied" | "not_supported">("pending");
  const [mediaErrorMessage, setMediaErrorMessage] = useState<string | null>(null);
  const [isRequestingMedia, setIsRequestingMedia] = useState(false);
  const [screenSharePresenter, setScreenSharePresenter] = useState<{ name: string; isLocal: boolean } | null>(null);
  const [screenShareTrack, setScreenShareTrack] = useState<any | null>(null);
  const [isCallActive, setIsCallActive] = useState(room.status === "in_progress");
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connecting" | "connected" | "disconnected">("idle");
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const [isEnablingAudio, setIsEnablingAudio] = useState(false);

  // In-Room Presentation & Files
  const [activeStageFile, setActiveStageFile] = useState<RoomFileItem | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [files, setFiles] = useState<RoomFileItem[]>(room.files || []);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  // LiveKit Refs
  const screenShareVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteAudioContainerRef = useRef<HTMLDivElement | null>(null);
  const lkRoomRef = useRef<LiveKitRoomType | null>(null);
  const remoteAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [groupParticipants, setGroupParticipants] = useState<GroupParticipant[]>([]);

  // Collaborative Notes & Synthesis
  const [notes, setNotes] = useState(room.sharedNotes || "");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [notesSaveStatus, setNotesSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [notesSaveError, setNotesSaveError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesisState, setSynthesisState] = useState<
    "idle" | "synthesizing" | "completed" | "failed" | "insufficient_evidence"
  >(
    room.synthesisStatus && room.synthesisStatus !== "idle"
      ? (room.synthesisStatus as any)
      : room.status === "concluded"
      ? "completed"
      : "idle"
  );
  const [summary, setSummary] = useState<VeraLedger | null>(
    (room.veraLedger as VeraLedger) || null
  );
  const [isApprovingLedger, setIsApprovingLedger] = useState(false);
  const [earlyAccessState, setEarlyAccessState] = useState<{
    opensAt: string | null;
    scheduledStartTime: string | null;
    isOpen: boolean;
  } | null>(null);
  const [isOpeningEarly, setIsOpeningEarly] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const isGroupMeeting = room.type === "group_meeting";
  const isConcluded = room.status === "concluded";
  const hasActivePresentation = Boolean(screenSharePresenter);
  const isDisplayingStageFile = Boolean(activeStageFile);

  const localParticipantDisplayName = useMemo(() => {
    if (isHost) {
      return room.meeting?.host?.name || room.booking?.host?.name || "Host";
    }
    return attendeeProfile?.name || room.booking?.guest?.name || "You";
  }, [isHost, room, attendeeProfile]);

  // Ticker for early access countdown
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Early access countdown calculation
  const countdownMinutes = useMemo(() => {
    if (!earlyAccessState?.opensAt) return 0;
    const diffMs = Math.max(0, new Date(earlyAccessState.opensAt).getTime() - now.getTime());
    return Math.floor(diffMs / 60000);
  }, [earlyAccessState, now]);

  const countdownSeconds = useMemo(() => {
    if (!earlyAccessState?.opensAt) return 0;
    const diffMs = Math.max(0, new Date(earlyAccessState.opensAt).getTime() - now.getTime());
    return Math.floor((diffMs % 60000) / 1000);
  }, [earlyAccessState, now]);

  // =========================================================================
  // CLIENT MEDIA PREVIEW (GREEN ROOM) WITH 5-SECOND WATCHDOG
  // =========================================================================
  const requestLocalMedia = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMediaPermissionState("not_supported");
      setMediaErrorMessage("Your browser does not support camera or microphone preview.");
      return;
    }

    if (localMediaStreamRef.current) {
      localMediaStreamRef.current.getTracks().forEach((track) => track.stop());
      localMediaStreamRef.current = null;
    }

    setIsRequestingMedia(true);
    setMediaPermissionState("pending");
    setMediaErrorMessage(null);

    // 5-second watchdog
    const timeout = setTimeout(() => {
      setMediaPermissionState((prev) => {
        if (prev === "pending") {
          setMediaErrorMessage("Camera preview took longer than expected. Tap below to enable permissions.");
          return "denied";
        }
        return prev;
      });
      setIsRequestingMedia(false);
    }, 5000);

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
        });
      }

      clearTimeout(timeout);
      localMediaStreamRef.current = stream;
      setLocalMediaStream(stream);
      setMediaPermissionState("granted");
      setMediaErrorMessage(null);

      stream.getVideoTracks().forEach((t) => (t.enabled = !isCamOff));
      stream.getAudioTracks().forEach((t) => (t.enabled = !isMicMuted));
    } catch (err: any) {
      clearTimeout(timeout);
      console.warn("[RoomView] Media preview notice:", err);
      setMediaPermissionState("denied");
      setMediaErrorMessage("Camera or microphone access was blocked. Please tap below to grant access.");
    } finally {
      setIsRequestingMedia(false);
    }
  }, [isCamOff, isMicMuted]);

  useEffect(() => {
    requestLocalMedia();
    return () => {
      if (localMediaStreamRef.current) {
        localMediaStreamRef.current.getTracks().forEach((t) => t.stop());
        localMediaStreamRef.current = null;
      }
    };
  }, [requestLocalMedia]);

  // =========================================================================
  // TOGGLE CONTROLS (MIC, CAM, SCREEN)
  // =========================================================================
  const toggleMic = async () => {
    const nextState = !isMicMuted;
    setIsMicMuted(nextState);
    if (localMediaStreamRef.current) {
      localMediaStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !nextState));
    }
    if (lkRoomRef.current) {
      try {
        await lkRoomRef.current.localParticipant.setMicrophoneEnabled(!nextState);
      } catch (err) {
        console.warn("[Media] Mic toggle error:", err);
        setIsMicMuted(!nextState); // Rollback on failure
      }
    }
  };

  const toggleCam = async () => {
    const nextState = !isCamOff;
    setIsCamOff(nextState);
    if (localMediaStreamRef.current) {
      localMediaStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = !nextState));
    }
    if (lkRoomRef.current) {
      try {
        const camPub = await lkRoomRef.current.localParticipant.setCameraEnabled(!nextState, {
          facingMode: "user",
        });
        const { Track } = await import("livekit-client");
        const pub = lkRoomRef.current.localParticipant.getTrackPublication(Track.Source.Camera);
        setLocalVideoTrack(!nextState && (pub?.videoTrack || camPub?.videoTrack) ? pub?.videoTrack || camPub?.videoTrack : null);
      } catch (err) {
        console.warn("[Media] Camera toggle error:", err);
        setIsCamOff(!nextState); // Rollback on failure
      }
    }
  };

  const toggleScreenShare = async () => {
    if (!lkRoomRef.current) return;
    try {
      const nextState = !isScreenSharing;
      await lkRoomRef.current.localParticipant.setScreenShareEnabled(nextState);
      setIsScreenSharing(nextState);
      if (nextState) {
        setScreenSharePresenter({ name: localParticipantDisplayName, isLocal: true });
      } else if (screenSharePresenter?.isLocal) {
        setScreenSharePresenter(null);
        setScreenShareTrack(null);
      }
    } catch (err) {
      console.warn("[Media] Screen share error:", err);
      setIsScreenSharing(false);
    }
  };

  // Screen share video attachment
  useEffect(() => {
    const el = screenShareVideoRef.current;
    if (!el || !screenShareTrack) return;
    try {
      screenShareTrack.attach(el);
      el.play().catch(() => {});
    } catch {}
    return () => {
      try { screenShareTrack.detach(el); } catch {}
    };
  }, [screenShareTrack]);

  // =========================================================================
  // LIVEKIT SESSION LIFECYCLE & DATAMODEL SYNC
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
          audioCaptureDefaults: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
        });

        cleanupRoom = lk;
        lkRoomRef.current = lk;

        const syncParticipants = () => {
          if (!lk) return;
          const list: GroupParticipant[] = [];
          lk.remoteParticipants.forEach((p) => {
            const camPub = p.getTrackPublication(Track.Source.Camera);
            const micPub = p.getTrackPublication(Track.Source.Microphone);
            list.push({
              identity: p.identity,
              name: p.name || (p.identity.startsWith("host-") ? (room.meeting?.host?.name || "Host") : "Attendee"),
              isSpeaking: p.isSpeaking,
              hasVideo: Boolean(camPub && !camPub.isMuted && camPub.videoTrack),
              hasAudio: Boolean(micPub && !micPub.isMuted),
              videoTrack: camPub?.videoTrack,
              audioTrack: micPub?.audioTrack,
            });
          });
          setGroupParticipants(list);
        };

        lk.on(RoomEvent.ParticipantConnected, () => syncParticipants());
        lk.on(RoomEvent.ParticipantDisconnected, () => syncParticipants());
        lk.on(RoomEvent.TrackMuted, () => syncParticipants());
        lk.on(RoomEvent.TrackUnmuted, () => syncParticipants());
        lk.on(RoomEvent.ActiveSpeakersChanged, () => syncParticipants());

        lk.on(RoomEvent.TrackSubscribed, (track: any, publication: any, participant: any) => {
          if (track.kind === Track.Kind.Video && publication.source === Track.Source.ScreenShare) {
            setScreenShareTrack(track);
            setScreenSharePresenter({ name: participant.name || "Presenter", isLocal: false });
          } else if (track.kind === Track.Kind.Audio) {
            let audioEl = remoteAudioElementsRef.current.get(participant.identity);
            if (!audioEl) {
              audioEl = document.createElement("audio");
              audioEl.autoplay = true;
              audioEl.setAttribute("playsinline", "true");
              remoteAudioElementsRef.current.set(participant.identity, audioEl);
              remoteAudioContainerRef.current?.appendChild(audioEl);
            }
            track.attach(audioEl);
            audioEl.play().catch(() => setAudioPlaybackBlocked(true));
          }
          syncParticipants();
        });

        lk.on(RoomEvent.TrackUnsubscribed, (track: any, publication: any) => {
          if (publication.source === Track.Source.ScreenShare) {
            setScreenShareTrack(null);
            setScreenSharePresenter(null);
          }
          syncParticipants();
        });

        // Real-Time Data Channel Protocol
        lk.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
          try {
            const data = JSON.parse(new TextDecoder().decode(payload));
            if (data.type === "FILE_ADDED" && data.file) {
              setFiles((prev) => [data.file, ...prev.filter((f) => f.id !== data.file.id)]);
            } else if (data.type === "FILE_DELETED" && data.fileId) {
              setFiles((prev) => prev.filter((f) => f.id !== data.fileId));
              if (activeStageFile?.id === data.fileId) setActiveStageFile(null);
            } else if (data.type === "PRESENT_STAGE_FILE" && data.file) {
              setActiveStageFile(data.file);
            } else if (data.type === "STOP_STAGE_FILE") {
              setActiveStageFile(null);
            } else if (data.type === "NOTES_UPDATED" && typeof data.notes === "string") {
              setNotes(data.notes);
            } else if (data.type === "MEETING_CONCLUDED") {
              setIsCallActive(false);
              setRoom((prev) => ({ ...prev, status: "concluded" }));
              if (data.veraLedger) setSummary(data.veraLedger);
              if (lkRoomRef.current) {
                lkRoomRef.current.disconnect();
                lkRoomRef.current = null;
              }
            }
          } catch (err) {
            console.warn("[DataChannel] Parse notice:", err);
          }
        });

        lk.on(RoomEvent.Connected, () => setConnectionStatus("connected"));
        lk.on(RoomEvent.Disconnected, () => setConnectionStatus("disconnected"));
        lk.on(RoomEvent.Reconnecting, () => setConnectionStatus("connecting"));
        lk.on(RoomEvent.Reconnected, () => {
          setConnectionStatus("connected");
          syncParticipants();
        });

        // Acquire LiveKit Token
        const res = await fetch(`/api/room/${room.accessToken}/livekit`, { method: "POST" });
        if (!res.ok) {
          if (res.status === 425) {
            const earlyData = await res.json().catch(() => ({}));
            setEarlyAccessState({
              opensAt: earlyData.opensAt || null,
              scheduledStartTime: earlyData.scheduledStartTime || null,
              isOpen: false,
            });
            setConnectionStatus("disconnected");
            return;
          }
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Could not acquire room connection token");
        }

        const { token, url } = await res.json();
        if (isCancelled) return;

        await lk.connect(url, token);
        if (isCancelled) {
          lk.disconnect();
          return;
        }

        setConnectionStatus("connected");
        syncParticipants();

        if (localMediaStreamRef.current) {
          localMediaStreamRef.current.getTracks().forEach((t) => t.stop());
          localMediaStreamRef.current = null;
        }

        try {
          if (!isCamOff) {
            const camPub = await lk.localParticipant.setCameraEnabled(true, { facingMode: "user" });
            const pub = lk.localParticipant.getTrackPublication(Track.Source.Camera);
            setLocalVideoTrack(pub?.videoTrack || camPub?.videoTrack || null);
          }
        } catch {
          setLocalVideoTrack(null);
        }

        try {
          if (!isMicMuted) {
            await lk.localParticipant.setMicrophoneEnabled(true);
          }
        } catch {}
      } catch (err) {
        console.warn("[Connection] Error initializing LiveKit:", err);
        setConnectionStatus("idle");
      }
    }

    initLiveKit();

    return () => {
      isCancelled = true;
      if (cleanupRoom) {
        cleanupRoom.disconnect();
      }
      lkRoomRef.current = null;
    };
  }, [isCallActive, room.accessToken]);

  // Audio Playback Unlocker
  const handleEnableAudio = async () => {
    setIsEnablingAudio(true);
    try {
      if (lkRoomRef.current) {
        await lkRoomRef.current.startAudio();
      }
      remoteAudioElementsRef.current.forEach((el) => el.play().catch(() => {}));
      setAudioPlaybackBlocked(false);
    } catch {
      setAudioPlaybackBlocked(true);
    } finally {
      setIsEnablingAudio(false);
    }
  };

  // =========================================================================
  // FILE UPLOAD & PRESENTATION (LIGHTWEIGHT METADATA ONLY)
  // =========================================================================
  const handleFileUpload = async (file: File) => {
    try {
      setIsUploadingFile(true);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("uploadedBy", localParticipantDisplayName);

      const res = await fetch(`/api/room/${room.accessToken}/files`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to upload file");
      }

      const data = await res.json();
      if (data.file) {
        setFiles((prev) => [data.file, ...prev.filter((f) => f.id !== data.file.id)]);
        if (lkRoomRef.current) {
          const payload = new TextEncoder().encode(
            JSON.stringify({ type: "FILE_ADDED", file: data.file })
          );
          lkRoomRef.current.localParticipant.publishData(payload, { reliable: true });
        }
      }
    } catch (err) {
      console.error("[Room Files] Upload error:", err);
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    try {
      const res = await fetch(`/api/room/${room.accessToken}/files`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
      if (res.ok) {
        setFiles((prev) => prev.filter((f) => f.id !== fileId));
        if (activeStageFile?.id === fileId) setActiveStageFile(null);
        if (lkRoomRef.current) {
          const payload = new TextEncoder().encode(
            JSON.stringify({ type: "FILE_DELETED", fileId })
          );
          lkRoomRef.current.localParticipant.publishData(payload, { reliable: true });
        }
      }
    } catch (err) {
      console.error("[Room Files] Delete error:", err);
    }
  };

  const handlePresentFile = (fileItem: RoomFileItem) => {
    setActiveStageFile(fileItem);
    if (lkRoomRef.current) {
      const payload = new TextEncoder().encode(
        JSON.stringify({ type: "PRESENT_STAGE_FILE", file: fileItem })
      );
      lkRoomRef.current.localParticipant.publishData(payload, { reliable: true });
    }
  };

  const handleStopPresentFile = () => {
    setActiveStageFile(null);
    if (lkRoomRef.current) {
      const payload = new TextEncoder().encode(JSON.stringify({ type: "STOP_STAGE_FILE" }));
      lkRoomRef.current.localParticipant.publishData(payload, { reliable: true });
    }
  };

  // =========================================================================
  // REAL-TIME NOTES SYNC & CALL TERMINATION
  // =========================================================================
  const notesTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleNotesChange = (newNotes: string) => {
    setNotes(newNotes);
    setNotesSaveStatus("saving");

    // Broadcast over DataChannel immediately for real-time peer typing
    if (lkRoomRef.current) {
      try {
        const payload = new TextEncoder().encode(
          JSON.stringify({ type: "NOTES_UPDATED", notes: newNotes })
        );
        lkRoomRef.current.localParticipant.publishData(payload, { reliable: true });
      } catch {}
    }

    // Debounce save to database (800ms)
    if (notesTimeoutRef.current) clearTimeout(notesTimeoutRef.current);
    notesTimeoutRef.current = setTimeout(async () => {
      try {
        setIsSavingNotes(true);
        const res = await fetch(`/api/room/${room.accessToken}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: newNotes }),
        });
        if (res.ok) {
          setNotesSaveStatus("saved");
          setNotesSaveError(null);
        } else {
          setNotesSaveStatus("error");
        }
      } catch {
        setNotesSaveStatus("error");
      } finally {
        setIsSavingNotes(false);
      }
    }, 800);
  };

  const handleConcludeCall = async () => {
    if (!isHost) return;

    setIsSynthesizing(true);
    setSynthesisState("synthesizing");

    if (lkRoomRef.current) {
      try {
        const payload = new TextEncoder().encode(JSON.stringify({ type: "MEETING_CONCLUDED" }));
        await lkRoomRef.current.localParticipant.publishData(payload, { reliable: true });
      } catch {}
      lkRoomRef.current.disconnect();
      lkRoomRef.current = null;
    }
    setIsCallActive(false);

    try {
      const res = await fetch(`/api/room/${room.accessToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "conclude" }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.status === 200 && data.success && data.veraLedger) {
        setSummary(data.veraLedger);
        setSynthesisState("completed");
        setRoom((prev) => ({ ...prev, status: "concluded" }));
      } else if (res.status === 202 || data.processing) {
        setSynthesisState("synthesizing");
      } else if (data.status === "insufficient_evidence" || data.code === "INSUFFICIENT_EVIDENCE") {
        setSynthesisState("insufficient_evidence");
      } else {
        setSynthesisState("failed");
      }
    } catch {
      setSynthesisState("failed");
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleLeaveCall = () => {
    if (lkRoomRef.current) {
      lkRoomRef.current.disconnect();
      lkRoomRef.current = null;
    }
    setIsCallActive(false);
    setConnectionStatus("idle");
  };

  const handleApproveLedger = async () => {
    if (!isHost) return;
    setIsApprovingLedger(true);
    try {
      const res = await fetch(`/api/room/${room.accessToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve_ledger" }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.veraLedger) {
        setSummary(data.veraLedger);
      }
    } finally {
      setIsApprovingLedger(false);
    }
  };

  const handleHostOpenEarly = async () => {
    if (!isHost || !room.meeting?.id) return;
    setIsOpeningEarly(true);
    try {
      const res = await fetch(`/api/meetings/${room.meeting.id}/open-early`, { method: "POST" });
      if (res.ok) {
        setEarlyAccessState(null);
      }
    } finally {
      setIsOpeningEarly(false);
    }
  };

  const copyRoomLink = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  // =========================================================================
  // RENDER
  // =========================================================================
  return (
    <div className="flex flex-col h-[100dvh] w-full bg-background-full overflow-hidden select-none">
      {/* Hidden audio element container */}
      <div ref={remoteAudioContainerRef} className="hidden" aria-hidden="true" />

      {/* Autoplay blocked banner */}
      {audioPlaybackBlocked && (
        <div className="h-10 px-4 bg-status-danger-background border-b border-border-error-default flex items-center justify-between z-50 text-caption-1-medium text-text-error-primary shrink-0">
          <div className="flex items-center gap-2">
            <RiVolumeUpLine className="size-4 shrink-0" />
            <span>Audio blocked by browser. Click Enable Audio to hear participants.</span>
          </div>
          <Button variant="primary" size="xs" onClick={handleEnableAudio} disabled={isEnablingAudio}>
            {isEnablingAudio ? "Enabling..." : "Enable Audio"}
          </Button>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* 1. STREAMLINED HEADER BAR */}
      {/* --------------------------------------------------------------------- */}
      <header className="h-13 px-3 sm:px-5 border-b border-border-button-default bg-background-primary-default/90 backdrop-blur-md flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-2.5 min-w-0">
          <MorrowLogo size={22} />
          <div className="h-4 w-px bg-border-button-default shrink-0" />
          <span className="text-body-2-medium font-semibold text-text-primary truncate max-w-[150px] sm:max-w-xs md:max-w-md">
            {room.meeting?.title || room.booking.eventTitle}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Status Badge */}
          {isConcluded ? (
            <Badge color="primary">Concluded</Badge>
          ) : isCallActive ? (
            <Badge color="primary">
              <span className="size-1.5 rounded-full bg-accent-500 animate-pulse me-1 inline-block" />
              In Call ({groupParticipants.length + 1})
            </Badge>
          ) : (
            <Badge color="neutral">Lobby</Badge>
          )}

          <Button
            variant="secondary"
            size="xs"
            leadingIcon={copiedLink ? RiCheckLine : RiFileCopyLine}
            onClick={copyRoomLink}
          >
            {copiedLink ? "Copied" : "Share"}
          </Button>

          {/* 3-Dots Host Action Menu */}
          {isHost && isGroupMeeting && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-1.5 rounded-lg border border-border-button-default bg-background-secondary-default text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
                title="Meeting Options"
              >
                <RiMoreFill className="size-4" />
              </button>

              {isMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsMenuOpen(false)} />
                  <div className="absolute end-0 mt-1 w-48 rounded-2xl border border-border-button-default bg-background-primary-default p-1.5 shadow-xl z-50 flex flex-col gap-1">
                    {!isCallActive && !isConcluded && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          handleHostOpenEarly();
                        }}
                        disabled={isOpeningEarly}
                        className="w-full text-start px-2.5 py-1.5 rounded-xl text-caption-1-medium text-text-primary hover:bg-background-secondary-default cursor-pointer transition-colors"
                      >
                        {isOpeningEarly ? "Opening..." : "Open Call Early"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        copyRoomLink();
                      }}
                      className="w-full text-start px-2.5 py-1.5 rounded-xl text-caption-1-medium text-text-primary hover:bg-background-secondary-default cursor-pointer transition-colors"
                    >
                      Copy Room Link
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* --------------------------------------------------------------------- */}
      {/* 2. MAIN COCKPIT VIEWPORT */}
      {/* --------------------------------------------------------------------- */}
      <main className="flex-1 flex flex-col lg:flex-row p-2.5 sm:p-4 gap-3 sm:gap-4 min-h-0 overflow-hidden">
        {/* LEFT POD: IMMERSIVE STAGE */}
        <section className="flex-1 flex flex-col relative rounded-3xl border border-border-button-default bg-background-tertiary-default overflow-hidden shadow-sm h-full min-w-0">
          <div className="relative flex-1 w-full h-full overflow-hidden flex flex-col items-center justify-center min-h-0">

            {/* SCREEN SHARE OR FILE PRESENTATION FILMSTRIP */}
            {(hasActivePresentation || isDisplayingStageFile) && isCallActive && !isConcluded && (
              <div className="w-full shrink-0 p-2 border-b border-border-button-default bg-background-secondary-default/50 flex items-center gap-2 overflow-x-auto no-scrollbar z-20">
                <div className="w-28 sm:w-36 aspect-video shrink-0">
                  <ParticipantTile
                    name={localParticipantDisplayName}
                    isLocal={true}
                    hasVideo={!isCamOff && Boolean(localVideoTrack || localMediaStream)}
                    videoTrack={localVideoTrack}
                    localStream={localMediaStream}
                    isMuted={isMicMuted}
                  />
                </div>
                {groupParticipants.map((peer) => (
                  <div key={peer.identity} className="w-28 sm:w-36 aspect-video shrink-0">
                    <ParticipantTile
                      name={peer.name}
                      isLocal={false}
                      hasVideo={peer.hasVideo}
                      videoTrack={peer.videoTrack}
                      isSpeaking={peer.isSpeaking}
                      isMuted={!peer.hasAudio}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* PRESENTED FILE ON STAGE */}
            {activeStageFile && (
              <div className="relative w-full flex-1 flex flex-col bg-background-primary-default overflow-hidden z-10 min-h-0">
                <div className="h-10 px-3 border-b border-border-button-default bg-background-secondary-default/90 flex items-center justify-between shrink-0 gap-2">
                  <div className="flex items-center gap-2 truncate">
                    <RiPresentationLine className="size-4 text-accent-600 shrink-0" />
                    <span className="text-body-2-medium font-semibold text-text-primary truncate">{activeStageFile.name}</span>
                  </div>
                  <Button variant="ghost" size="xs" leadingIcon={RiCloseLine} onClick={handleStopPresentFile}>
                    Stop Presenting
                  </Button>
                </div>
                <div className="flex-1 w-full h-full p-4 overflow-auto flex items-center justify-center bg-background-tertiary-default min-h-0">
                  {activeStageFile.type.startsWith("image/") ? (
                    <img src={activeStageFile.url} alt={activeStageFile.name} className="max-w-full max-h-full object-contain rounded-xl" />
                  ) : activeStageFile.type === "application/pdf" ? (
                    <iframe src={activeStageFile.url} className="w-full h-full border-none rounded-xl" title={activeStageFile.name} />
                  ) : (
                    <div className="flex flex-col items-center gap-3 p-6 text-center">
                      <RiAttachment2 className="size-10 text-text-secondary" />
                      <span className="text-body-medium font-semibold text-text-primary">{activeStageFile.name}</span>
                      <a href={activeStageFile.url} download={activeStageFile.name} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-500 text-white text-caption-1-semibold">
                        <RiDownloadLine className="size-4" /> Download File
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SCREEN SHARE VIDEO */}
            {!isDisplayingStageFile && (
              <video
                ref={screenShareVideoRef}
                autoPlay
                playsInline
                className={cx("w-full h-full object-contain bg-background-tertiary-default", hasActivePresentation ? "block" : "hidden")}
              />
            )}

            {/* GROUP VIDEO GALLERY (WHEN NOT PRESENTING) */}
            {isCallActive && !isDisplayingStageFile && !hasActivePresentation && !isConcluded && (
              <div className="w-full h-full p-2.5 sm:p-4 overflow-y-auto z-10 flex flex-col justify-center">
                <div
                  className={cx(
                    "w-full h-full grid gap-2.5 sm:gap-3 min-h-0",
                    groupParticipants.length === 0
                      ? "grid-cols-1 max-w-xl mx-auto"
                      : groupParticipants.length === 1
                      ? "grid-cols-1 sm:grid-cols-2 max-w-4xl mx-auto"
                      : groupParticipants.length <= 3
                      ? "grid-cols-2 max-w-5xl mx-auto"
                      : "grid-cols-2 sm:grid-cols-3 max-w-6xl mx-auto"
                  )}
                >
                  <ParticipantTile
                    name={localParticipantDisplayName}
                    isLocal={true}
                    hasVideo={!isCamOff && Boolean(localVideoTrack || localMediaStream)}
                    videoTrack={localVideoTrack}
                    localStream={localMediaStream}
                    isMuted={isMicMuted}
                  />

                  {groupParticipants.map((peer) => (
                    <ParticipantTile
                      key={peer.identity}
                      name={peer.name}
                      isLocal={false}
                      hasVideo={peer.hasVideo}
                      videoTrack={peer.videoTrack}
                      isSpeaking={peer.isSpeaking}
                      isMuted={!peer.hasAudio}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* POST-CALL EXECUTIVE SUMMARY ON MAIN STAGE */}
            {isConcluded && (
              <div className="w-full h-full p-4 sm:p-6 overflow-y-auto min-h-0 flex flex-col max-w-3xl mx-auto">
                <div className="flex flex-col gap-4 py-3">
                  <div className="p-4 rounded-2xl border border-border-button-default bg-background-primary-default shadow-xs flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="size-9 rounded-xl bg-accent-500/10 text-accent-600 flex items-center justify-center shrink-0">
                        <RiBookOpenLine className="size-4.5" />
                      </div>
                      <div>
                        <h3 className="text-body-medium font-semibold text-text-primary">Executive Meeting Record</h3>
                        <p className="text-caption-2-medium text-text-secondary">Synthesized by Vera AI from notes and discussion context.</p>
                      </div>
                    </div>
                    {isHost && summary?.reviewStatus === "pending_host_review" && (
                      <Button variant="primary" size="xs" leadingIcon={RiCheckLine} onClick={handleApproveLedger} disabled={isApprovingLedger}>
                        {isApprovingLedger ? "Approving..." : "Approve Record"}
                      </Button>
                    )}
                  </div>

                  {synthesisState === "insufficient_evidence" && (
                    <div className="p-6 rounded-2xl border border-amber-500/30 bg-amber-50/10 flex flex-col gap-3 text-center items-center">
                      <RiAlertLine className="size-8 text-amber-600" />
                      <h4 className="text-body-medium font-semibold text-text-primary">Notes Required for Vera Synthesis</h4>
                      <p className="text-caption-1-medium text-text-secondary max-w-md">
                        Vera needs actual meeting notes before creating the ledger. Add discussion context in the Notes tab and re-run.
                      </p>
                      {isHost && (
                        <div className="flex items-center gap-2">
                          <Button variant="secondary" size="xs" onClick={() => setActiveTab("notes")}>Edit Notes</Button>
                          <Button variant="primary" size="xs" onClick={handleConcludeCall} disabled={isSynthesizing}>Retry Synthesis</Button>
                        </div>
                      )}
                    </div>
                  )}

                  {summary && (
                    <div className="flex flex-col gap-4 p-5 rounded-2xl bg-background-primary-default border border-border-button-default shadow-xs">
                      {summary.executiveSummary && (
                        <div>
                          <h4 className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider mb-2">Executive Summary</h4>
                          <ul className="space-y-1.5 list-disc list-inside text-body-2-regular text-text-secondary leading-relaxed">
                            {summary.executiveSummary.map((item, idx) => (
                              <li key={idx}>{typeof item === "string" ? item : item.claim}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {summary.actionItems && summary.actionItems.length > 0 && (
                        <div className="border-t border-border-button-default pt-4">
                          <h4 className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider mb-2">Action Items</h4>
                          <div className="space-y-2">
                            {summary.actionItems.map((ai, idx) => (
                              <div key={idx} className="flex items-start gap-2 p-2.5 rounded-xl bg-background-secondary-default text-caption-1-medium text-text-primary">
                                <span className="font-semibold text-accent-600 shrink-0">{ai.assignee}:</span>
                                <span className="flex-1">{ai.task}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* EARLY ACCESS WAITING ROOM (HTTP 425) */}
            {earlyAccessState && !earlyAccessState.isOpen && (
              <div className="flex flex-col items-center justify-center p-6 text-center max-w-sm gap-3 z-20">
                <div className="size-14 rounded-2xl bg-accent-50 dark:bg-accent-950/40 border border-accent-200 dark:border-accent-900 flex items-center justify-center text-accent-600">
                  <RiTimeLine className="size-7" />
                </div>
                <h3 className="text-title-3-semibold text-text-primary">Call Opens Soon</h3>
                <p className="text-caption-1-medium text-text-secondary">
                  The room opens automatically 15 minutes before scheduled start time.
                </p>
                <div className="px-4 py-2 rounded-xl bg-background-primary-default border border-border-button-default text-body-2-medium font-mono font-semibold text-accent-600">
                  {countdownMinutes}m {String(countdownSeconds).padStart(2, "0")}s
                </div>
              </div>
            )}

            {/* GREEN ROOM (PRE-CALL LOBBY) */}
            {!isCallActive && !isConcluded && (!earlyAccessState || earlyAccessState.isOpen) && !isDisplayingStageFile && (
              <div className="w-full h-full p-4 overflow-y-auto flex flex-col items-center justify-center z-10">
                <div className="w-full max-w-md flex flex-col items-center gap-4 text-center my-auto">
                  {/* Camera Preview */}
                  <div className="relative w-full aspect-[4/3] rounded-3xl overflow-hidden border border-border-button-default bg-neutral-950 shadow-md flex items-center justify-center">
                    {!isCamOff && localMediaStream ? (
                      <VideoTrackView stream={localMediaStream} isLocal={true} className="w-full h-full object-cover scale-x-[-1]" />
                    ) : isCamOff ? (
                      <div className="flex flex-col items-center gap-2 p-4">
                        <Avatar size="lg" initials={isHost ? "H" : "G"} color="blue" />
                        <span className="text-caption-1-medium text-neutral-400">Camera is off</span>
                      </div>
                    ) : mediaPermissionState === "denied" ? (
                      <div className="flex flex-col items-center gap-2 p-4 max-w-xs">
                        <RiAlertLine className="size-6 text-text-error-primary" />
                        <span className="text-caption-1-semibold text-white">Camera Access Required</span>
                        <p className="text-caption-2-medium text-neutral-400">{mediaErrorMessage}</p>
                        <Button variant="secondary" size="xs" onClick={requestLocalMedia}>
                          Enable Camera
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 p-4">
                        <RiLoader4Line className="size-6 animate-spin text-accent-500" />
                        <span className="text-caption-1-medium text-neutral-400">Starting camera preview...</span>
                      </div>
                    )}

                    {/* Integrated audio wave meter */}
                    <div className="absolute bottom-2.5 start-3 bg-black/60 backdrop-blur-xs px-2.5 py-1 rounded-full z-10">
                      <MicVolumeMeter stream={localMediaStream} isMuted={isMicMuted} />
                    </div>
                  </div>

                  {/* Centered Green Room Controls */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={toggleMic}
                      className={cx(
                        "size-10 rounded-full border flex items-center justify-center transition-colors cursor-pointer",
                        isMicMuted
                          ? "border-border-error-default bg-status-danger-background text-text-error-primary"
                          : "border-border-button-default bg-background-primary-default text-text-primary hover:bg-background-secondary-hover"
                      )}
                      title={isMicMuted ? "Unmute" : "Mute"}
                    >
                      {isMicMuted ? <RiMicOffLine className="size-5" /> : <RiMicLine className="size-5" />}
                    </button>

                    <button
                      type="button"
                      onClick={toggleCam}
                      className={cx(
                        "size-10 rounded-full border flex items-center justify-center transition-colors cursor-pointer",
                        isCamOff
                          ? "border-border-error-default bg-status-danger-background text-text-error-primary"
                          : "border-border-button-default bg-background-primary-default text-text-primary hover:bg-background-secondary-hover"
                      )}
                      title={isCamOff ? "Turn camera on" : "Turn camera off"}
                    >
                      {isCamOff ? <RiVideoOffLine className="size-5" /> : <RiVideoOnLine className="size-5" />}
                    </button>
                  </div>

                  {/* Primary CTA */}
                  <div className="w-full flex flex-col gap-2">
                    <Button
                      variant="primary"
                      size="medium"
                      leadingIcon={RiVideoOnLine}
                      onClick={() => setIsCallActive(true)}
                      className="w-full justify-center text-body-medium font-semibold shadow-sm py-2.5"
                    >
                      {isHost ? "Start Meeting as Host" : "Join Call Now"}
                    </Button>

                    {room.preparationMaterial && (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab("docs");
                          setMobileMode("canvas");
                          setIsFocusMode(false);
                        }}
                        className="text-caption-1-semibold text-accent-600 hover:text-accent-500 cursor-pointer transition-colors mt-0.5"
                      >
                        View Meeting Prep Notes & Docs →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ----------------------------------------------------------------- */}
          {/* 3. DOCK CONTROLS (STAGE-CENTERED ANCHORING) */}
          {/* ----------------------------------------------------------------- */}
          {isCallActive && !isDisplayingStageFile && !isConcluded && (
            <div className="absolute bottom-3 sm:bottom-4 start-1/2 -translate-x-1/2 z-30 pointer-events-auto max-w-[calc(100%-1.5rem)]">
              <div className="p-1 sm:p-1.5 rounded-full border border-border-button-default bg-background-primary-default/95 backdrop-blur-xl shadow-2xl flex items-center gap-1.5 sm:gap-2 whitespace-nowrap">
                <button
                  type="button"
                  onClick={toggleMic}
                  aria-label={isMicMuted ? "Unmute microphone" : "Mute microphone"}
                  className={cx(
                    "size-10 rounded-full border flex items-center justify-center transition-colors cursor-pointer shrink-0",
                    isMicMuted
                      ? "border-border-error-default bg-status-danger-background text-text-error-primary"
                      : "border-border-button-default bg-background-secondary-default text-text-primary hover:bg-background-secondary-hover"
                  )}
                >
                  {isMicMuted ? <RiMicOffLine className="size-5" /> : <RiMicLine className="size-5" />}
                </button>

                <button
                  type="button"
                  onClick={toggleCam}
                  aria-label={isCamOff ? "Turn on camera" : "Turn off camera"}
                  className={cx(
                    "size-10 rounded-full border flex items-center justify-center transition-colors cursor-pointer shrink-0",
                    isCamOff
                      ? "border-border-error-default bg-status-danger-background text-text-error-primary"
                      : "border-border-button-default bg-background-secondary-default text-text-primary hover:bg-background-secondary-hover"
                  )}
                >
                  {isCamOff ? <RiVideoOffLine className="size-5" /> : <RiVideoOnLine className="size-5" />}
                </button>

                <button
                  type="button"
                  onClick={toggleScreenShare}
                  aria-label={isScreenSharing ? "Stop sharing screen" : "Share screen"}
                  className={cx(
                    "hidden sm:flex size-10 rounded-full border items-center justify-center transition-colors cursor-pointer shrink-0",
                    isScreenSharing
                      ? "border-accent-500 bg-accent-500 text-white shadow-sm"
                      : "border-border-button-default bg-background-secondary-default text-text-primary hover:bg-background-secondary-hover"
                  )}
                >
                  <RiShareForwardBoxLine className="size-5" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (mobileMode === "canvas") {
                      setMobileMode("call");
                      setIsFocusMode(true);
                    } else {
                      setMobileMode("canvas");
                      setIsFocusMode(false);
                    }
                  }}
                  aria-label="Toggle workspace"
                  title="Notes & Docs"
                  className={cx(
                    "size-10 rounded-full border flex items-center justify-center transition-colors cursor-pointer shrink-0",
                    mobileMode === "canvas"
                      ? "border-accent-500 bg-accent-50 text-accent-600 dark:bg-accent-950/40"
                      : "border-border-button-default bg-background-secondary-default text-text-primary hover:bg-background-secondary-hover"
                  )}
                >
                  <RiFileListLine className="size-5" />
                </button>

                <div className="h-6 w-px bg-border-button-default mx-0.5" />

                {isHost ? (
                  <Button
                    variant="primary"
                    size="small"
                    onClick={handleConcludeCall}
                    disabled={isSynthesizing}
                    className="px-3 sm:px-4 shrink-0 font-semibold"
                  >
                    {isSynthesizing ? "Ending..." : <><span className="hidden sm:inline">End Meeting</span><span className="sm:hidden">End</span></>}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={handleLeaveCall}
                    className="px-3 sm:px-4 shrink-0 font-semibold"
                  >
                    Leave
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ----------------------------------------------------------------- */}
        {/* 4. WORKSPACE CANVAS (DESKTOP SIDEBAR + MOBILE BOTTOM SHEET) */}
        {/* ----------------------------------------------------------------- */}
        <section
          className={cx(
            "w-full lg:w-[380px] xl:w-[420px] shrink-0 h-full flex flex-col rounded-3xl border border-border-button-default bg-background-primary-default overflow-hidden shadow-sm min-h-0",
            isFocusMode ? "hidden" : "hidden lg:flex"
          )}
        >
          {/* 2 Tabs: Notes and Docs */}
          <div className="p-3 border-b border-border-button-default bg-background-secondary-default/30 shrink-0">
            <div className="grid grid-cols-2 p-1 rounded-xl bg-background-secondary-default border border-border-button-default gap-1">
              <button
                type="button"
                onClick={() => setActiveTab("notes")}
                className={cx(
                  "py-1.5 px-3 rounded-lg text-caption-1-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5",
                  activeTab === "notes"
                    ? "bg-background-primary-default text-text-primary shadow-2xs font-semibold"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <RiEditLine className="size-4" />
                <span>Notes</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("docs")}
                className={cx(
                  "py-1.5 px-3 rounded-lg text-caption-1-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5",
                  activeTab === "docs"
                    ? "bg-background-primary-default text-text-primary shadow-2xs font-semibold"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <RiAttachment2 className="size-4" />
                <span>Docs & Files {files.length > 0 ? `(${files.length})` : ""}</span>
              </button>
            </div>
          </div>

          {/* TAB 1: COLLABORATIVE NOTES */}
          {activeTab === "notes" && (
            <div className="flex-1 p-3.5 sm:p-4 flex flex-col gap-2 min-h-0 h-full">
              <div className="flex items-center justify-between shrink-0">
                <span className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider">Shared Notes</span>
                <span className="text-caption-2-medium text-text-tertiary">
                  {notesSaveStatus === "saving" ? "Saving..." : notesSaveStatus === "error" ? "Save error" : "Saved"}
                </span>
              </div>
              <textarea
                value={notes}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Take shared meeting notes, jot down decisions, and track action items together in real time..."
                className="w-full flex-1 p-3 rounded-2xl border border-border-button-default bg-background-secondary-default/50 text-text-primary text-body-2-regular font-mono leading-relaxed resize-none outline-none focus:border-border-focus-ring"
              />
            </div>
          )}

          {/* TAB 2: DOCS & ATTACHED FILES */}
          {activeTab === "docs" && (
            <div className="flex-1 p-3.5 sm:p-4 overflow-y-auto min-h-0 flex flex-col gap-4">
              {room.preparationMaterial && (
                <div className="p-3.5 rounded-2xl bg-background-secondary-default/40 border border-border-button-default flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 text-text-primary font-semibold text-caption-1-semibold">
                    <RiBookOpenLine className="size-4 text-accent-600" />
                    <span>Preparation Notes</span>
                  </div>
                  <div className="text-body-2-regular text-text-secondary leading-relaxed max-h-48 overflow-y-auto font-mono text-caption-1-medium">
                    <MarkdownViewer content={room.preparationMaterial} />
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <span className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider">Attached Documents</span>
                <FileUpload onUploadComplete={handleFileUpload} maxBytes={15 * 1024 * 1024} />
              </div>

              {files.length > 0 && (
                <div className="flex flex-col gap-2">
                  {files.map((file) => (
                    <div key={file.id} className="p-2.5 rounded-xl border border-border-button-default bg-background-secondary-default flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 truncate">
                        <RiAttachment2 className="size-4 text-text-tertiary shrink-0" />
                        <div className="flex flex-col truncate">
                          <span className="text-caption-1-semibold text-text-primary truncate">{file.name}</span>
                          <span className="text-caption-2-medium text-text-tertiary">{formatFileSize(file.size)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="xs" onClick={() => handlePresentFile(file)} title="Present on stage">
                          Present
                        </Button>
                        {file.url && (
                          <a href={file.url} download={file.name} className="p-1 rounded text-text-secondary hover:text-text-primary">
                            <RiDownloadLine className="size-3.5" />
                          </a>
                        )}
                        <button type="button" onClick={() => handleDeleteFile(file.id)} className="p-1 rounded text-text-secondary hover:text-text-error-primary cursor-pointer">
                          <RiDeleteBinLine className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {/* MOBILE BOTTOM SHEET WORKSPACE (GOOGLE MEET STYLE) */}
      {mobileMode === "canvas" && (
        <div className="fixed inset-0 z-50 flex items-end lg:hidden">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity" onClick={() => setMobileMode("call")} />
          <div className="relative w-full h-[65vh] bg-background-primary-default rounded-t-3xl border-t border-border-button-default shadow-2xl flex flex-col overflow-hidden z-10 animate-in slide-in-from-bottom duration-200">
            {/* Sheet Handle */}
            <div className="pt-2 pb-1.5 px-4 border-b border-border-button-default flex flex-col gap-1.5 shrink-0 bg-background-secondary-default/40">
              <div className="w-10 h-1 rounded-full bg-border-button-default mx-auto" />
              <div className="flex items-center justify-between">
                <span className="text-body-2-medium font-semibold text-text-primary">Workspace</span>
                <button type="button" onClick={() => setMobileMode("call")} className="p-1 rounded-full text-text-secondary hover:text-text-primary cursor-pointer">
                  <RiCloseLine className="size-5" />
                </button>
              </div>
            </div>

            {/* Mobile Tabs */}
            <div className="p-2 border-b border-border-button-default bg-background-secondary-default/30 shrink-0">
              <div className="grid grid-cols-2 p-1 rounded-xl bg-background-secondary-default border border-border-button-default gap-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("notes")}
                  className={cx(
                    "py-1.5 rounded-lg text-caption-1-semibold transition-all cursor-pointer flex items-center justify-center gap-1",
                    activeTab === "notes" ? "bg-background-primary-default text-text-primary font-semibold" : "text-text-secondary"
                  )}
                >
                  <RiEditLine className="size-4" /> Notes
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("docs")}
                  className={cx(
                    "py-1.5 rounded-lg text-caption-1-semibold transition-all cursor-pointer flex items-center justify-center gap-1",
                    activeTab === "docs" ? "bg-background-primary-default text-text-primary font-semibold" : "text-text-secondary"
                  )}
                >
                  <RiAttachment2 className="size-4" /> Docs & Files
                </button>
              </div>
            </div>

            {/* Mobile Tab Content */}
            <div className="flex-1 p-3 overflow-y-auto min-h-0">
              {activeTab === "notes" ? (
                <textarea
                  value={notes}
                  onChange={(e) => handleNotesChange(e.target.value)}
                  placeholder="Type shared meeting notes here..."
                  className="w-full h-full p-3 rounded-2xl border border-border-button-default bg-background-secondary-default/50 text-text-primary text-body-2-regular font-mono resize-none outline-none"
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {room.preparationMaterial && (
                    <div className="p-3 rounded-xl bg-background-secondary-default/50 border border-border-button-default text-caption-1-medium text-text-secondary">
                      <MarkdownViewer content={room.preparationMaterial} />
                    </div>
                  )}
                  <FileUpload onUploadComplete={handleFileUpload} maxBytes={15 * 1024 * 1024} />
                  {files.map((file) => (
                    <div key={file.id} className="p-2 rounded-xl border border-border-button-default bg-background-secondary-default flex items-center justify-between text-caption-1-medium">
                      <span className="truncate">{file.name}</span>
                      <Button variant="ghost" size="xs" onClick={() => handlePresentFile(file)}>Present</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
