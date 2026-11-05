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
  RiVolumeMuteLine,
  RiCalendarCloseLine,
  RiRefreshLine,
  RiAlertLine,
  RiSparklingLine,
  RiLoader4Line,
  RiGroupLine,
} from "@remixicon/react";
import type { RoomDetails, RoomFileItem } from "@/lib/room/room-service";
import type { VeraAgendaItem, VeraLedger } from "@/lib/intelligence/vera";

type LiveKitRoomType = import("livekit-client").Room;

export interface RoomViewProps {
  initialRoom: RoomDetails;
  isHost?: boolean;
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

function ParticipantTile({
  name,
  isLocal = false,
  hasVideo,
  videoTrack,
  isSpeaking,
  isMuted,
  localVideoRef,
}: {
  name: string;
  isLocal?: boolean;
  hasVideo: boolean;
  videoTrack?: any;
  isSpeaking?: boolean;
  isMuted?: boolean;
  localVideoRef?: React.RefObject<HTMLVideoElement | null>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!isLocal && videoRef.current && videoTrack) {
      videoTrack.attach(videoRef.current);
      return () => {
        if (videoRef.current) {
          videoTrack.detach(videoRef.current);
        }
      };
    }
  }, [isLocal, videoTrack]);

  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "U";

  return (
    <div
      className={cx(
        "relative rounded-2xl overflow-hidden bg-background-primary-default border border-border-button-default flex items-center justify-center transition-all duration-200 aspect-video sm:aspect-auto h-full min-h-[140px] sm:min-h-[180px] shadow-sm",
        isSpeaking ? "ring-2 ring-accent-500 shadow-md" : ""
      )}
    >
      {isLocal ? (
        hasVideo ? (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover scale-x-[-1]"
          />
        ) : null
      ) : hasVideo && videoTrack ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      ) : null}

      {!hasVideo && (
        <div className="flex flex-col items-center justify-center gap-2 p-3 text-center">
          <Avatar size="md" initials={initials} color={isLocal ? "blue" : "lime"} />
          <span className="text-caption-1-semibold text-text-primary max-w-[120px] truncate">
            {name}
          </span>
        </div>
      )}

      <div className="absolute bottom-2 start-2 end-2 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-xs text-white text-caption-2-medium max-w-[85%] truncate">
          {isMuted && <RiMicOffLine className="size-3 text-status-danger-text shrink-0" />}
          <span className="truncate">{name} {isLocal ? "(You)" : ""}</span>
        </div>
        {isSpeaking && (
          <div className="size-2 rounded-full bg-accent-500 animate-ping shrink-0" />
        )}
      </div>
    </div>
  );
}

export function RoomView({ initialRoom, isHost = false }: RoomViewProps) {
  const [room, setRoom] = useState<RoomDetails>(initialRoom);
  const [activeTab, setActiveTab] = useState<"preparation" | "agenda" | "notes" | "files" | "summary">(
    initialRoom.preparationMaterial ? "preparation" : "agenda"
  );
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
  const remoteAudioContainerRef = useRef<HTMLDivElement | null>(null);
  const lkRoomRef = useRef<LiveKitRoomType | null>(null);
  const remoteAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [groupParticipants, setGroupParticipants] = useState<GroupParticipant[]>([]);
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);

  // Collaborative Canvas State
  const [notes, setNotes] = useState(room.sharedNotes || "");
  const [agenda, setAgenda] = useState<VeraAgendaItem[]>(room.agenda || []);
  const [files, setFiles] = useState<RoomFileItem[]>(room.files || []);
  const [newAgendaText, setNewAgendaText] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesisState, setSynthesisState] = useState<
    "idle" | "synthesizing" | "completed" | "failed" | "insufficient_evidence" | "timed_out_waiting"
  >(
    room.veraLedger
      ? "completed"
      : room.synthesisStatus === "synthesizing"
      ? "synthesizing"
      : room.synthesisStatus === "insufficient_evidence"
      ? "insufficient_evidence"
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
            deadline: a.deadline,
            evidence: a.evidence,
          })),
          keyDecisions: room.veraLedger.keyDecisions || [],
          suggestedFollowUp: room.veraLedger.suggestedFollowUp,
          reviewStatus: room.veraLedger.reviewStatus || "pending_host_review",
          approvedAt: room.veraLedger.approvedAt,
          approvedBy: room.veraLedger.approvedBy,
        }
      : null
  );

  const [isApprovingLedger, setIsApprovingLedger] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [earlyAccessState, setEarlyAccessState] = useState<{
    opensAt: string | null;
    scheduledStartTime: string | null;
    isOpen: boolean;
  } | null>(null);
  const [isOpeningEarly, setIsOpeningEarly] = useState(false);
  const [roomMeeting, setRoomMeeting] = useState(room.meeting);

  const handleHostOpenEarly = async () => {
    if (!isHost || isOpeningEarly) return;
    setIsOpeningEarly(true);
    try {
      const res = await fetch(`/api/room/${room.accessToken}/open-early`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setRoomMeeting((prev) => (prev ? { ...prev, openedEarlyAt: data.openedEarlyAt } : prev));
        setEarlyAccessState(null);
      }
    } catch (err) {
      console.error("[Room] Error opening room early:", err);
    } finally {
      setIsOpeningEarly(false);
    }
  };

  const handleApproveLedger = async () => {
    if (!isHost || isApprovingLedger) return;
    setIsApprovingLedger(true);
    setApprovalError(null);
    try {
      const res = await fetch(`/api/room/${room.accessToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve_ledger" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.veraLedger) {
        setSummary(data.veraLedger);
        setApprovalError(null);
      } else {
        setApprovalError(data.error || "Failed to approve meeting record.");
      }
    } catch (err) {
      console.error("[Room] Error approving ledger:", err);
      setApprovalError("Network error while approving record.");
    } finally {
      setIsApprovingLedger(false);
    }
  };

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

          if (checkData.room.synthesisStatus === "insufficient_evidence") {
            setSynthesisState("insufficient_evidence");
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

  // When early access is pending, poll room status so entry automatically activates
  useEffect(() => {
    if (!earlyAccessState || earlyAccessState.isOpen) return;

    let active = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/room/${room.accessToken}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        if (data.callAccessStatus?.isOpen || data.room?.meeting?.openedEarlyAt) {
          setEarlyAccessState(null);
          setIsCallActive(true);
        }
      } catch {}
    }, 4000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [earlyAccessState, room.accessToken]);

  // Scroll fades for internal scroll regions (BoardUI compliance)
  const summaryFade = useScrollFade();
  const agendaFade = useScrollFade();
  const filesFade = useScrollFade();
  const prepFade = useScrollFade();

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

        const syncParticipants = () => {
          if (!lk) return;
          const list: GroupParticipant[] = [];
          lk.remoteParticipants.forEach((p) => {
            let hasVideo = false;
            let hasAudio = false;
            let videoTrack: any = undefined;
            let audioTrack: any = undefined;

            p.trackPublications.forEach((pub) => {
              if (pub.source === Track.Source.Camera && pub.videoTrack && pub.isSubscribed) {
                hasVideo = !pub.isMuted;
                videoTrack = pub.videoTrack;
              }
              if (pub.source === Track.Source.Microphone && pub.audioTrack && pub.isSubscribed) {
                hasAudio = !pub.isMuted;
                audioTrack = pub.audioTrack;
              }
            });

            list.push({
              identity: p.identity,
              name: p.name || (p.identity.startsWith("host-") ? (room.meeting?.host?.name || "Host") : "Attendee"),
              isSpeaking: p.isSpeaking,
              hasVideo,
              hasAudio,
              videoTrack,
              audioTrack,
            });
          });
          setGroupParticipants(list);
          if (room.type === "group_meeting") {
            setRemoteHasVideo(list.some((p) => p.hasVideo));
          }
        };

        // Remote Track Subscriptions
        lk.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          if (publication.source === Track.Source.ScreenShare && track.kind === Track.Kind.Video) {
            if (screenShareVideoRef.current) {
              track.attach(screenShareVideoRef.current);
            }
            setScreenSharePresenter({ name: participant.name || "Guest", isLocal: false });
          } else if (track.kind === Track.Kind.Audio) {
            if (room.type !== "group_meeting") {
              // 1-on-1 booking audio path: attach to dedicated 1-on-1 remoteAudioRef element
              if (remoteAudioRef.current) {
                track.attach(remoteAudioRef.current);
                remoteAudioRef.current.play().catch((err) => {
                  console.warn("[RoomView] 1-on-1 audio autoplay blocked:", err);
                  setAudioPlaybackBlocked(true);
                });
              }
            } else {
              // Concurrent group meeting audio playback:
              // Every remote audio track gets a dedicated audio element appended to the stable DOM container
              const trackKey = track.sid || `audio-${participant.identity}`;
              let existingEl = remoteAudioElementsRef.current.get(trackKey);
              if (!existingEl) {
                const audioEl = track.attach() as HTMLAudioElement;
                audioEl.id = `remote-audio-${participant.identity}-${trackKey}`;
                audioEl.autoplay = true;
                audioEl.setAttribute("playsinline", "true");
                (audioEl as unknown as { playsInline?: boolean }).playsInline = true;
                if (remoteAudioContainerRef.current) {
                  remoteAudioContainerRef.current.appendChild(audioEl);
                }
                remoteAudioElementsRef.current.set(trackKey, audioEl);
                audioEl.play().catch((err) => {
                  console.warn("[RoomView] Group audio autoplay blocked by browser:", participant.identity, err);
                  setAudioPlaybackBlocked(true);
                });
              }
            }
            syncParticipants();
          } else if (track.kind === Track.Kind.Video) {
            if (room.type !== "group_meeting" && remoteVideoRef.current) {
              track.attach(remoteVideoRef.current);
            }
            setRemoteHasVideo(true);
            syncParticipants();
          }
        });

        // Remote Track Unsubscriptions
        lk.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
          if (publication.source === Track.Source.ScreenShare) {
            track.detach();
            setScreenSharePresenter(null);
          } else if (track.kind === Track.Kind.Audio) {
            if (room.type !== "group_meeting") {
              if (remoteAudioRef.current) {
                track.detach(remoteAudioRef.current);
              } else {
                track.detach();
              }
            } else {
              const trackKey = track.sid || (participant ? `audio-${participant.identity}` : undefined);
              if (trackKey) {
                const el = remoteAudioElementsRef.current.get(trackKey);
                if (el) {
                  track.detach(el);
                  el.srcObject = null;
                  el.remove();
                  remoteAudioElementsRef.current.delete(trackKey);
                } else {
                  track.detach();
                }
              } else {
                track.detach();
              }
            }
            syncParticipants();
          } else if (track.kind === Track.Kind.Video) {
            track.detach();
            if (lk.remoteParticipants.size <= 1) {
              setRemoteHasVideo(false);
            }
            syncParticipants();
          }
        });

        lk.on(RoomEvent.ParticipantConnected, () => syncParticipants());
        lk.on(RoomEvent.ParticipantDisconnected, (participant) => {
          participant.trackPublications.forEach((pub) => {
            if (pub.track) {
              const trackKey = pub.track.sid || `audio-${participant.identity}`;
              const el = remoteAudioElementsRef.current.get(trackKey);
              if (el) {
                pub.track.detach(el);
                el.srcObject = null;
                el.remove();
                remoteAudioElementsRef.current.delete(trackKey);
              }
            }
          });
          const fallbackKey = `audio-${participant.identity}`;
          const fallbackEl = remoteAudioElementsRef.current.get(fallbackKey);
          if (fallbackEl) {
            fallbackEl.srcObject = null;
            fallbackEl.remove();
            remoteAudioElementsRef.current.delete(fallbackKey);
          }
          syncParticipants();
        });

        lk.on(RoomEvent.AudioPlaybackStatusChanged, () => {
          if (lk) {
            setAudioPlaybackBlocked(!lk.canPlaybackAudio);
          }
        });

        lk.on(RoomEvent.TrackMuted, () => syncParticipants());
        lk.on(RoomEvent.TrackUnmuted, () => syncParticipants());

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
          const speakerIds = new Set(speakers.map((s) => s.identity));
          setGroupParticipants((prev) =>
            prev.map((p) => ({ ...p, isSpeaking: speakerIds.has(p.identity) }))
          );
          setIsRemoteSpeaking(speakers.some((s) => !s.isLocal));
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

        // Connect
        await lk.connect(url, token);
        if (isCancelled) {
          lk.disconnect();
          return;
        }

        setConnectionStatus("connected");
        syncParticipants();

        // Check if browser blocked autoplay policy
        if (!lk.canPlaybackAudio) {
          setAudioPlaybackBlocked(true);
        }

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
        if (room.type !== "group_meeting" && remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = null;
        }
        remoteAudioElementsRef.current.forEach((el) => {
          el.srcObject = null;
          el.remove();
        });
        remoteAudioElementsRef.current.clear();
        if (remoteAudioContainerRef.current) {
          remoteAudioContainerRef.current.innerHTML = "";
        }
        setGroupParticipants([]);
        lkRoomRef.current = null;
      }
    };
  }, [isCallActive, room.accessToken]);

  // Enable Audio when browser blocks autoplay
  const handleEnableAudio = async () => {
    if (lkRoomRef.current) {
      try {
        await lkRoomRef.current.startAudio();
      } catch (err) {
        console.warn("[RoomView] lkRoom.startAudio failed:", err);
      }
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.play().catch(() => {});
    }
    remoteAudioElementsRef.current.forEach((el) => {
      el.play().catch(() => {});
    });
    setAudioPlaybackBlocked(false);
  };

  // Toggle Microphone
  const toggleMic = async () => {
    if (audioPlaybackBlocked) {
      handleEnableAudio();
    }
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

  // Notes auto-save & flush synchronization
  const lastSavedNotesRef = useRef(room.sharedNotes || "");
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [notesSaveError, setNotesSaveError] = useState<string | null>(null);

  const persistNotesToServer = async (textToSave: string): Promise<boolean> => {
    if (textToSave === lastSavedNotesRef.current) {
      setNotesSaveError(null);
      return true;
    }

    setIsSavingNotes(true);
    setNotesSaveError(null);
    try {
      const res = await fetch(`/api/room/${room.accessToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: textToSave }),
      });

      if (!res.ok) {
        throw new Error(`Notes save failed with status ${res.status}`);
      }

      lastSavedNotesRef.current = textToSave;
      setNotesSaveError(null);
      return true;
    } catch (err) {
      console.error("[Room] Error persisting notes:", err);
      setNotesSaveError("Failed to save latest notes. Please check connection.");
      return false;
    } finally {
      setIsSavingNotes(false);
    }
  };

  const flushNotesSave = async (): Promise<boolean> => {
    // 1. Clear any pending debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // 2. Await in-flight save if one exists
    if (saveInFlightRef.current) {
      const inFlightOk = await saveInFlightRef.current;
      if (!inFlightOk) {
        return false;
      }
    }

    // 3. If latest notes state differs from last saved, save immediately
    const currentNotes = notesRef.current;
    if (currentNotes !== lastSavedNotesRef.current) {
      const promise = persistNotesToServer(currentNotes);
      saveInFlightRef.current = promise;
      const ok = await promise;
      saveInFlightRef.current = null;
      return ok;
    }

    return true;
  };

  // Debounced auto-save effect
  useEffect(() => {
    if (notes === lastSavedNotesRef.current) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    setIsSavingNotes(true);
    debounceTimerRef.current = setTimeout(async () => {
      if (saveInFlightRef.current) {
        await saveInFlightRef.current.catch(() => {});
      }
      const currentNotes = notesRef.current;
      if (currentNotes !== lastSavedNotesRef.current) {
        const promise = persistNotesToServer(currentNotes);
        saveInFlightRef.current = promise;
        await promise;
        saveInFlightRef.current = null;
      }
    }, 1200);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [notes, room.accessToken]);

  // Conclude Call and trigger Vera Summary Synthesis
  const handleConcludeCall = async () => {
    if (!isHost) return;

    // Flush and await pending note changes before synthesis starts
    const notesSaved = await flushNotesSave();
    if (!notesSaved) {
      setNotesSaveError("Could not save latest notes. Please check connection and retry.");
      return;
    }

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
      } else if (data.status === "insufficient_evidence" || data.code === "INSUFFICIENT_EVIDENCE") {
        setSynthesisState("insufficient_evidence");
        setIsSynthesizing(false);
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
  const isGroupMeeting = room.type === "group_meeting";
  const localParticipantDisplayName = isHost
    ? (room.meeting?.host?.name || room.booking?.host?.name || "Host")
    : (room.booking?.guest?.name || "You");
  const isBookingCancelled = room.booking.status === "cancelled";
  const isBookingRejected = room.booking.status === "rejected";
  const isCancelledOrRejected = isBookingCancelled || isBookingRejected;
  const isBookingEligible = room.booking.status === "confirmed";

  const copyRoomLink = () => {
    if (room.type === "group_meeting" && (room.meeting?.invitationToken || roomMeeting?.invitationToken)) {
      const token = room.meeting?.invitationToken || roomMeeting?.invitationToken;
      const url = `${window.location.origin}/j/${token}`;
      navigator.clipboard.writeText(url);
    } else {
      navigator.clipboard.writeText(window.location.href);
    }
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
    <div className="h-[100dvh] max-h-[100dvh] w-full max-w-full overflow-hidden flex flex-col bg-background-full text-text-primary selection:bg-accent-500/20 pb-[env(safe-area-inset-bottom)]">
      {/* 1-on-1 single remote audio element (preserved for 1-on-1 bookings) */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Stable DOM container for concurrent multi-participant remote audio elements */}
      <div
        ref={remoteAudioContainerRef}
        id="remote-audio-container"
        aria-hidden="true"
        className="fixed top-0 start-0 w-0 h-0 overflow-hidden opacity-0 pointer-events-none -z-50"
      />

      {/* Browser Autoplay Blocked Banner */}
      {audioPlaybackBlocked && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed top-16 inset-x-3 sm:inset-x-auto sm:end-6 z-50 p-3 sm:p-4 rounded-2xl bg-background-primary-default border border-border-error-default shadow-xl flex items-center justify-between gap-3 max-w-md animate-in fade-in slide-in-from-top-2"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <RiVolumeMuteLine className="size-5 text-text-error-primary shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-body-2-semibold text-text-primary">
                Audio playback paused by browser
              </span>
              <span className="text-caption-2-medium text-text-secondary truncate">
                Click to unmute and hear meeting participants
              </span>
            </div>
          </div>
          <Button
            size="xs"
            variant="primary"
            onClick={handleEnableAudio}
            leadingIcon={RiVolumeUpLine}
            className="shrink-0 cursor-pointer"
          >
            Enable Audio
          </Button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. ROOM HEADER BAR */}
      {/* ========================================================================= */}
      <header className="h-14 px-3 sm:px-6 border-b border-border-button-default bg-background-primary-default/80 backdrop-blur-md flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <MorrowLogo size={22} />
          <div className="h-4 w-px bg-border-button-default shrink-0" />
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-body-2-medium sm:text-body-medium font-semibold text-text-primary truncate">
              {room.meeting?.title || room.booking.eventTitle}
            </span>
            <span className="text-caption-2-medium text-text-tertiary hidden sm:inline truncate">
              {room.meeting
                ? `(Organised by ${room.meeting.host.name})`
                : `(${room.booking.host.name} and ${room.booking.guest.name})`}
            </span>
          </div>
        </div>

        {/* Participant Strip & Vera Identity */}
        {isGroupMeeting ? (
          <div className="hidden md:flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border-button-default bg-background-secondary-default text-caption-1-semibold">
              <RiGroupLine className="size-3.5 text-accent-600" />
              <span className="text-text-secondary">
                {isCallActive ? `${groupParticipants.length + 1} in call` : `${room.meeting?.attendees?.length || 0} registered`}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border-button-default bg-background-primary-default shadow-2xs">
              <Avatar size="xs" initials="V" color="neutral" />
              <span className="text-text-primary text-caption-1-semibold">Vera</span>
              <Chip color="soft" variant="caption">Scribe</Chip>
            </div>
          </div>
        ) : (
          <div className="hidden md:flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border-button-default bg-background-secondary-default text-caption-1-semibold">
              <Avatar size="xs" initials={hostInitials} color="blue" />
              <span className="text-text-secondary">{room.booking.host.name} {isHost ? "(Host, You)" : "(Host)"}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border-button-default bg-background-secondary-default text-caption-1-semibold">
              <Avatar size="xs" initials={guestInitials} color="lime" />
              <span className="text-text-secondary">{room.booking.guest.name || "Guest"} {!isHost ? "(You)" : ""}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border-button-default bg-background-primary-default shadow-2xs">
              <Avatar size="xs" initials="V" color="neutral" />
              <span className="text-text-primary text-caption-1-semibold">Vera</span>
              <Chip color="soft" variant="caption">Scribe</Chip>
            </div>
          </div>
        )}

        {/* Header Action Controls */}
        <div className="flex items-center gap-2">
          {isHost && isGroupMeeting && roomMeeting && !roomMeeting.openedEarlyAt && !isConcluded && (
            <Button
              variant="secondary"
              size="xs"
              onClick={handleHostOpenEarly}
              disabled={isOpeningEarly}
              className="text-accent-600 font-semibold"
            >
              {isOpeningEarly ? "Opening..." : "Open Call Early"}
            </Button>
          )}

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
            "flex flex-col relative rounded-3xl border border-border-button-default bg-background-tertiary-default overflow-hidden shadow-sm transition-all duration-300",
            mobileMode === "canvas" ? "h-48 sm:h-64 lg:h-full shrink-0 flex" : "h-full flex-1 min-w-0 flex",
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
            {/* CASE 3A: MULTI-PARTICIPANT GROUP MEETING GALLERY */}
            {/* ----------------------------------------------------------------- */}
            {isGroupMeeting && isCallActive && !isDisplayingStageFile && !hasActivePresentation && !isConcluded && (
              <div className="w-full h-full p-2.5 sm:p-4 overflow-y-auto z-10 flex flex-col justify-center">
                <div
                  className={cx(
                    "w-full h-full grid gap-3 min-h-0",
                    groupParticipants.length === 0
                      ? "grid-cols-1 max-w-2xl mx-auto"
                      : groupParticipants.length === 1
                      ? "grid-cols-1 sm:grid-cols-2 max-w-4xl mx-auto"
                      : groupParticipants.length <= 3
                      ? "grid-cols-2 md:grid-cols-2 max-w-5xl mx-auto"
                      : "grid-cols-2 sm:grid-cols-3 md:grid-cols-3 max-w-6xl mx-auto"
                  )}
                >
                  <ParticipantTile
                    name={localParticipantDisplayName}
                    isLocal={true}
                    hasVideo={!isCamOff}
                    isMuted={isMicMuted}
                    localVideoRef={localVideoRef}
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

            {/* ----------------------------------------------------------------- */}
            {/* CASE 3B: 1-ON-1 BOOKING HERO VIDEO FEED */}
            {/* ----------------------------------------------------------------- */}
            {!isGroupMeeting && !isDisplayingStageFile && (
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
            {!isGroupMeeting && isCallActive && !isDisplayingStageFile && !hasActivePresentation && !remoteHasVideo && !isCamOff && (
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
            {!isConcluded && !isCancelledOrRejected && !isDisplayingStageFile && (!isCallActive || (!isGroupMeeting && !hasActivePresentation && !remoteHasVideo && isCamOff)) && (
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
            {!isGroupMeeting && isCallActive && !isConcluded && (remoteHasVideo || hasActivePresentation || isDisplayingStageFile) && (
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

                  {/* In-Room Preparation / Context Button */}
                  {room.preparationMaterial && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab("preparation");
                        setMobileMode("canvas");
                      }}
                      aria-label="View meeting preparation"
                      title="Preparation Minutes"
                      className="size-10 sm:size-11 rounded-full border border-border-button-default bg-background-secondary-default text-text-primary flex items-center justify-center cursor-pointer hover:bg-background-secondary-hover"
                    >
                      <RiBookOpenLine className="size-5 text-accent-600" />
                    </button>
                  )}

                  {/* Mobile View Toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      if (activeTab === "preparation" && !room.preparationMaterial) setActiveTab("agenda");
                      setMobileMode("canvas");
                    }}
                    aria-label="Open collaborative canvas"
                    title="Agenda & Notes"
                    className="lg:hidden size-10 sm:size-11 rounded-full border border-border-button-default bg-background-secondary-default text-text-primary flex items-center justify-center cursor-pointer hover:bg-background-secondary-hover"
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
            mobileMode === "call" ? "hidden lg:flex" : "flex flex-1 min-h-0",
            isFocusMode ? "hidden" : "flex"
          )}
        >
          {/* Canvas Navigation Tabs */}
          <div className="p-3 border-b border-border-button-default bg-background-secondary-default/30 shrink-0">
            {/* Mobile Back-to-Stage Header (only visible on mobile screens) */}
            <div className="lg:hidden flex items-center justify-between pb-2 mb-2 border-b border-border-button-default">
              <span className="text-caption-1-semibold text-text-secondary">Workspace Canvas</span>
              <button
                type="button"
                onClick={() => setMobileMode("call")}
                className="text-caption-1-semibold text-accent-600 hover:text-accent-500 flex items-center gap-1 cursor-pointer"
              >
                Back to Full Stage →
              </button>
            </div>

            <div
              className={cx(
                "w-full grid p-1 rounded-xl bg-background-secondary-default border border-border-button-default gap-0.5",
                room.preparationMaterial ? "grid-cols-5" : "grid-cols-4"
              )}
            >
              {/* Preparation Tab (when available) */}
              {room.preparationMaterial && (
                <button
                  type="button"
                  onClick={() => setActiveTab("preparation")}
                  className={cx(
                    "py-1.5 px-1 rounded-lg text-caption-1-semibold transition-all cursor-pointer flex items-center justify-center gap-1 min-w-0",
                    activeTab === "preparation"
                      ? "bg-background-primary-default text-text-primary shadow-2xs font-semibold"
                      : "text-text-secondary hover:text-text-primary"
                  )}
                  title="Meeting Context & Minutes"
                >
                  <RiBookOpenLine className="size-3.5 shrink-0" />
                  <span className="truncate">Prep</span>
                </button>
              )}

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
          {/* TAB: PREPARATION & CONTEXT VIEW */}
          {/* ===================================================================== */}
          {activeTab === "preparation" && (
            <div className="relative min-h-0 flex-1 h-full overflow-hidden">
              <div
                onScroll={prepFade.onScroll}
                className="h-full overflow-y-auto p-4 sm:p-5 flex flex-col gap-4"
              >
                <div className="p-3.5 rounded-2xl bg-background-secondary-default/50 border border-border-button-default">
                  <div className="flex items-center gap-2 mb-1 text-text-primary font-semibold text-caption-1-semibold">
                    <RiBookOpenLine className="size-4 text-accent-600 shrink-0" />
                    <span>Previous Meeting Minutes & Preparation</span>
                  </div>
                  <p className="text-caption-2-medium text-text-secondary leading-normal">
                    Cleaned official preparation records supplied by the organiser. Read-only context for participants.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-background-secondary-default border border-border-button-default">
                  <div className="prose prose-sm dark:prose-invert max-w-none text-body-2-medium text-text-secondary leading-relaxed whitespace-pre-wrap font-sans">
                    {room.preparationMaterial || "No previous meeting preparation material was provided."}
                  </div>
                </div>
              </div>
              <ScrollFade progress={prepFade.progress} surfaceClassName="from-background-primary-default" />
            </div>
          )}

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
                  {isSavingNotes ? "Saving..." : notesSaveError ? "Save error" : "All changes saved"}
                </span>
              </div>

              {notesSaveError && (
                <div className="p-2.5 rounded-xl border border-border-error-default bg-background-error-default/10 text-caption-1-medium text-text-error-primary flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <RiAlertLine className="size-4 shrink-0 text-text-error-primary" />
                    <span className="truncate">{notesSaveError}</span>
                  </div>
                  <Button variant="secondary" size="xs" onClick={() => flushNotesSave()}>
                    Retry Save
                  </Button>
                </div>
              )}

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

                  {synthesisState === "insufficient_evidence" && (
                    <div className="p-8 rounded-3xl border border-border-button-default flex flex-col items-center text-center gap-4 bg-background-secondary-default/20 my-auto m-4">
                      <div className="size-12 rounded-2xl bg-accent-500/10 border border-accent-500/20 flex items-center justify-center text-accent-500">
                        <RiFileListLine className="size-6" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <h4 className="text-title-3-semibold text-text-primary">
                          Notes or Transcript Required
                        </h4>
                        <p className="text-body-2-regular text-text-secondary max-w-sm">
                          Vera needs actual meeting notes or a transcript before it can create a reliable meeting record. Add the missing context and try again.
                        </p>
                      </div>
                      {notesSaveError && (
                        <div className="p-2.5 rounded-xl border border-border-error-default bg-background-error-default/10 text-caption-1-medium text-text-error-primary max-w-sm flex items-center gap-2 text-start">
                          <RiAlertLine className="size-4 shrink-0" />
                          <span className="flex-1">{notesSaveError}</span>
                        </div>
                      )}
                      {isHost ? (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            size="small"
                            leadingIcon={RiEditLine}
                            onClick={() => setActiveTab("notes")}
                          >
                            Add Notes
                          </Button>
                          <Button
                            variant="primary"
                            size="small"
                            leadingIcon={RiRefreshLine}
                            onClick={handleConcludeCall}
                            disabled={isSynthesizing}
                          >
                            {isSynthesizing ? "Retrying..." : "Retry Vera Synthesis"}
                          </Button>
                        </div>
                      ) : (
                        <p className="text-caption-1-medium text-text-tertiary">
                          The host can add meeting notes and synthesize the record.
                        </p>
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
                    {/* Ledger Review Status Banner */}
                    {summary.reviewStatus === "pending_host_review" ? (
                      <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 flex flex-col gap-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 text-caption-2-medium font-semibold uppercase tracking-wider">
                            Draft — Awaiting Host Review
                          </span>
                          {isHost && (
                            <Button
                              variant="primary"
                              size="xs"
                              leadingIcon={RiCheckLine}
                              onClick={handleApproveLedger}
                              disabled={isApprovingLedger}
                            >
                              {isApprovingLedger ? "Approving..." : "Approve Record"}
                            </Button>
                          )}
                        </div>
                        <p className="text-caption-1-regular text-text-secondary leading-relaxed">
                          {isHost
                            ? "Vera has prepared this evidence-grounded draft. Please inspect the claims, decisions, and action items below, then approve this to create the verified permanent meeting record."
                            : "This meeting summary is currently an unapproved draft pending review and confirmation by the meeting host."}
                        </p>
                        {approvalError && (
                          <p className="text-caption-2-medium text-text-error-primary">
                            {approvalError}
                          </p>
                        )}
                      </div>
                    ) : summary.reviewStatus === "approved" ? (
                      <div className="px-3.5 py-2.5 rounded-xl border border-status-lime-text/20 bg-status-lime-text/5 flex items-center justify-between text-caption-1-medium text-text-secondary">
                        <div className="flex items-center gap-2">
                          <span className="size-2 rounded-full bg-status-lime-text" />
                          <span className="font-semibold text-text-primary">Approved Permanent Record</span>
                        </div>
                        {summary.approvedAt && (
                          <span className="text-caption-2-medium text-text-tertiary">
                            Approved {new Date(summary.approvedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                          </span>
                        )}
                      </div>
                    ) : null}

                    {/* Executive Summary */}
                    <div className="p-4 rounded-2xl border border-border-button-default bg-background-secondary-default/40 flex flex-col gap-2">
                      <span className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider">
                        Executive Summary
                      </span>
                      <div className="flex flex-col gap-2.5">
                        {summary.executiveSummary.map((item, idx) => {
                          const isObject = typeof item === "object" && item !== null;
                          const claimText = isObject ? (item as any).claim : item;
                          const evidenceText = isObject ? (item as any).evidence : null;

                          return (
                            <div
                              key={idx}
                              className="flex flex-col gap-1 pb-2 border-b border-border-button-default/30 last:border-b-0 last:pb-0"
                            >
                              <p className="text-body-medium text-text-primary leading-relaxed">
                                {claimText}
                              </p>
                              {evidenceText && (
                                <details className="group cursor-pointer select-none">
                                  <summary className="text-caption-2-medium text-text-tertiary hover:text-text-secondary flex items-center gap-1 list-none focus:outline-none">
                                    <span className="group-open:hidden">▸ Inspect source excerpt</span>
                                    <span className="hidden group-open:inline">▾ Hide source excerpt</span>
                                  </summary>
                                  <p className="mt-1 ps-2.5 py-1 text-caption-1-regular text-text-secondary border-s-2 border-accent-500/40 bg-background-tertiary-default/40 rounded-e-md italic font-normal">
                                    &ldquo;{evidenceText}&rdquo;
                                  </p>
                                </details>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Key Decisions */}
                    {summary.keyDecisions && summary.keyDecisions.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <span className="text-caption-1-semibold text-text-tertiary uppercase tracking-wider">
                          Key Decisions Made
                        </span>
                        <div className="grid grid-cols-1 gap-2">
                          {summary.keyDecisions.map((item, idx) => {
                            const isObject = typeof item === "object" && item !== null;
                            const decisionText = isObject ? (item as any).decision : item;
                            const evidenceText = isObject ? (item as any).evidence : null;
                            const status = isObject ? (item as any).status : "confirmed";

                            if (status !== "confirmed") return null;

                            return (
                              <div
                                key={idx}
                                className="p-3 rounded-xl border border-border-button-default bg-background-primary-default flex flex-col gap-1.5 shadow-2xs"
                              >
                                <div className="flex items-start gap-2.5">
                                  <RiCheckLine className="size-4 text-accent-500 shrink-0 mt-0.5" />
                                  <span className="text-body-medium text-text-primary font-medium leading-relaxed">
                                    {decisionText}
                                  </span>
                                </div>
                                {evidenceText && (
                                  <details className="group cursor-pointer select-none ps-6">
                                    <summary className="text-caption-2-medium text-text-tertiary hover:text-text-secondary flex items-center gap-1 list-none focus:outline-none">
                                      <span className="group-open:hidden">▸ Inspect source excerpt</span>
                                      <span className="hidden group-open:inline">▾ Hide source excerpt</span>
                                    </summary>
                                    <p className="mt-1 ps-2.5 py-1 text-caption-1-regular text-text-secondary border-s-2 border-accent-500/40 bg-background-tertiary-default/40 rounded-e-md italic font-normal">
                                      &ldquo;{evidenceText}&rdquo;
                                    </p>
                                  </details>
                                )}
                              </div>
                            );
                          })}
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
                              {action.evidence && (
                                <details className="group cursor-pointer select-none">
                                  <summary className="text-caption-2-medium text-text-tertiary hover:text-text-secondary flex items-center gap-1 list-none focus:outline-none">
                                    <span className="group-open:hidden">▸ Source quote</span>
                                    <span className="hidden group-open:inline">▾ Hide quote</span>
                                  </summary>
                                  <p className="mt-1 ps-2 py-0.5 text-caption-2-medium text-text-secondary border-s-2 border-accent-500/40 bg-background-tertiary-default/30 rounded-e-md italic font-normal">
                                    &ldquo;{action.evidence}&rdquo;
                                  </p>
                                </details>
                              )}
                              <div className="flex items-center justify-between pt-2 border-t border-border-button-default/50 text-caption-1-semibold">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <Avatar size="xs" initials={action.assignee.slice(0, 2).toUpperCase()} color="neutral" />
                                  <span className="text-caption-2-medium text-text-secondary truncate">{action.assignee}</span>
                                  {action.deadline && (
                                    <span className="text-caption-2-medium text-text-tertiary shrink-0 ml-1">
                                      • Due {action.deadline}
                                    </span>
                                  )}
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
