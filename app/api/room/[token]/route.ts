import { NextRequest, NextResponse } from "next/server";
import {
  getRoomByAccessToken,
  updateRoomNotes,
  updateRoomAgenda,
  addRoomFile,
  concludeRoomAndSynthesize,
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

    return NextResponse.json({
      success: true,
      room,
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

    // Lifecycle check: Cancelled or rejected bookings become non-operational for mutations
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
      if (!session?.user?.id || session.user.id !== room.booking.host.id) {
        return NextResponse.json(
          {
            success: false,
            error: "Forbidden: Only the authenticated meeting host can conclude this room.",
          },
          { status: 403 }
        );
      }

      const concluded = await concludeRoomAndSynthesize(token);
      if (!concluded) {
        return NextResponse.json(
          { success: false, error: "Failed to conclude room." },
          { status: 400 }
        );
      }
      return NextResponse.json({
        success: true,
        status: "concluded",
        veraLedger: concluded.veraLedger,
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
