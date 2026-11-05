import { NextRequest, NextResponse } from "next/server";
import {
  getRoomByAccessToken,
  updateRoomNotes,
  updateRoomAgenda,
  addRoomFile,
  concludeRoomAndSynthesize,
} from "@/lib/room/room-service";

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
    const body = await req.json().catch(() => ({}));

    if (body.action === "conclude") {
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
