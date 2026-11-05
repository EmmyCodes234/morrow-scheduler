import { isMeetingCallOpen } from "@/lib/meetings/meeting-service";
import { NextRequest, NextResponse } from "next/server";
import {
  getRoomByAccessToken,
  updateRoomNotes,
  updateRoomAgenda,
  addRoomFile,
  concludeRoomAndSynthesize,
  approveRoomLedger,
} from "@/lib/room/room-service";
import { auth } from "@/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const room = await getRoomByAccessToken(token);

    if (!room) {
      return NextResponse.json(
        { success: false, error: "Room not found." },
        { status: 404 }
      );
    }

    const callAccessStatus =
      room.type === "group_meeting" && room.meeting
        ? isMeetingCallOpen(room.meeting)
        : null;

    return NextResponse.json({
      success: true,
      room,
      callAccessStatus,
    });
  } catch (err) {
    console.error("[Room API] GET error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const room = await getRoomByAccessToken(token);

    if (!room) {
      return NextResponse.json(
        { success: false, error: "Room not found." },
        { status: 404 }
      );
    }

    const hostId = room.meeting?.host?.id || room.booking.host.id;

    // Lifecycle check: Cancelled bookings or meetings become non-operational for mutations
    if (room.meeting && room.meeting.status === "cancelled") {
      return NextResponse.json(
        {
          success: false,
          error: "Cannot modify room for a cancelled meeting. Historical view is read-only.",
        },
        { status: 403 }
      );
    }

    const bookingStatus = room.booking.status;
    if (bookingStatus === "cancelled" || bookingStatus === "rejected") {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot modify room for a ${bookingStatus} booking. Historical view is read-only.`,
        },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));

    // Host-Only Operation: Concluding the room and synthesizing AI ledger
    if (body.action === "conclude") {
      // If already concluded, return existing ledger idempotently
      if (room.status === "concluded") {
        return NextResponse.json({
          success: true,
          status: "concluded",
          veraLedger: room.veraLedger,
        });
      }

      // Verify server-side authenticated host ownership
      const session = await auth();
      if (!session?.user?.id || session.user.id !== hostId) {
        return NextResponse.json(
          {
            success: false,
            error: "Forbidden: Only the authenticated meeting host can conclude this room.",
          },
          { status: 403 }
        );
      }

      const result = await concludeRoomAndSynthesize(token);

      if (result.processing) {
        return NextResponse.json(
          {
            success: true,
            status: "synthesizing",
            processing: true,
            message: result.message || "Vera summary synthesis is currently in progress.",
          },
          { status: 202 }
        );
      }

      if (!result.success) {
        const httpStatus =
          result.status === "stale_worker"
            ? 409
            : result.status === "insufficient_evidence"
            ? 422
            : 500;

        return NextResponse.json(
          {
            success: false,
            status: result.status,
            error: result.error || "Failed to conclude room.",
            code: result.code,
          },
          { status: httpStatus }
        );
      }

      return NextResponse.json({
        success: true,
        status: "concluded",
        veraLedger: result.veraLedger,
      });
    }

    // Host-Only Operation: Explicitly Approving the Vera Meeting Record
    if (body.action === "approve_ledger") {
      const session = await auth();
      if (!session?.user?.id) {
        return NextResponse.json(
          {
            success: false,
            error: "Unauthorized: You must be signed in to approve a meeting record.",
          },
          { status: 401 }
        );
      }

      if (session.user.id !== hostId) {
        return NextResponse.json(
          {
            success: false,
            error: "Forbidden: Only the authenticated meeting host can approve this ledger.",
          },
          { status: 403 }
        );
      }

      const approveResult = await approveRoomLedger(token, session.user.id);
      if (!approveResult.success) {
        const httpStatus =
          approveResult.status === "forbidden"
            ? 403
            : approveResult.status === "not_found"
            ? 404
            : 400;

        return NextResponse.json(
          {
            success: false,
            error: approveResult.error || "Failed to approve ledger.",
          },
          { status: httpStatus }
        );
      }

      return NextResponse.json({
        success: true,
        status: "approved",
        veraLedger: approveResult.veraLedger,
      });
    }

    // Immutability: Concluded rooms cannot be modified by ordinary collaborative requests
    if (room.status === "concluded") {
      return NextResponse.json(
        {
          success: false,
          error: "Conflict: This room has been concluded and cannot be edited.",
        },
        { status: 409 }
      );
    }

    // Legitimate collaborative operations (Notes, Agenda, Document contribution)
    if (typeof body.notes === "string") {
      await updateRoomNotes(token, body.notes);
    }

    if (Array.isArray(body.agenda)) {
      await updateRoomAgenda(token, body.agenda);
    }

    if (body.file && typeof body.file === "object") {
      await addRoomFile(token, body.file);
    }

    const updated = await getRoomByAccessToken(token);
    return NextResponse.json({
      success: true,
      room: updated,
    });
  } catch (err) {
    console.error("[Room API] PATCH error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error." },
      { status: 500 }
    );
  }
}
