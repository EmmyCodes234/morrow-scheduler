import { NextRequest, NextResponse } from "next/server";
import { getRoomByAccessToken, addRoomFile, removeRoomFile, type RoomFileItem } from "@/lib/room/room-service";
import { auth } from "@/auth";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const room = await getRoomByAccessToken(token);

    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    if (room.status === "concluded") {
      return NextResponse.json(
        { error: "Meeting has concluded. Room is read-only." },
        { status: 409 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const uploadedBy = (formData.get("uploadedBy") as string) || "Guest";

    if (!file) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    // 15 MB limit
    const MAX_SIZE = 15 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File exceeds 15 MB limit." },
        { status: 413 }
      );
    }

    const fileId = `file-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storedFileName = `${fileId}-${sanitizedName}`;

    // Target upload directory in public/uploads/rooms/[roomId]
    const uploadsDir = path.join(process.cwd(), "public", "uploads", "rooms", room.id);
    await fs.mkdir(uploadsDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = path.join(uploadsDir, storedFileName);
    await fs.writeFile(filePath, buffer);

    const publicUrl = `/uploads/rooms/${room.id}/${storedFileName}`;

    const newFileItem: RoomFileItem = {
      id: fileId,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      url: publicUrl,
      uploadedBy,
      uploadedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const updatedFiles = await addRoomFile(token, newFileItem);

    return NextResponse.json({
      success: true,
      file: newFileItem,
      files: updatedFiles,
    }, { status: 201 });
  } catch (err) {
    console.error("[Room Files API] Upload error:", err);
    return NextResponse.json(
      { error: "Failed to upload file." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const room = await getRoomByAccessToken(token);

    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    if (room.status === "concluded") {
      return NextResponse.json(
        { error: "Meeting has concluded. Room is read-only." },
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { fileId } = body;

    if (!fileId) {
      return NextResponse.json({ error: "File ID is required." }, { status: 400 });
    }

    const updatedFiles = await removeRoomFile(token, fileId);

    return NextResponse.json({
      success: true,
      files: updatedFiles,
    });
  } catch (err) {
    console.error("[Room Files API] Delete error:", err);
    return NextResponse.json(
      { error: "Failed to delete file." },
      { status: 500 }
    );
  }
}
