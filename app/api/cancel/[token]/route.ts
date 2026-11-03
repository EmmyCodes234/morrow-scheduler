import { NextRequest, NextResponse } from "next/server";
import {
  cancelBooking,
  getBookingForCancellation,
} from "@/lib/scheduling/cancellation-service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    if (!token || typeof token !== "string" || token.trim().length === 0) {
      return NextResponse.json(
        { error: "Invalid cancellation token.", errorCode: "INVALID_TOKEN" },
        { status: 400 }
      );
    }

    const booking = await getBookingForCancellation(token);

    if (!booking) {
      return NextResponse.json(
        { error: "Booking not found or invalid cancellation token.", errorCode: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ booking });
  } catch (err) {
    console.error("[Cancel API] GET error:", err);
    return NextResponse.json(
      { error: "Internal server error.", errorCode: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    if (!token || typeof token !== "string" || token.trim().length === 0) {
      return NextResponse.json(
        { error: "Invalid cancellation token.", errorCode: "INVALID_TOKEN" },
        { status: 400 }
      );
    }

    let reason: string | undefined;
    const rawText = await req.text();

    if (rawText.trim().length > 0) {
      let json: unknown;
      try {
        json = JSON.parse(rawText);
      } catch {
        return NextResponse.json(
          { error: "Malformed JSON payload in request body.", errorCode: "INVALID_JSON" },
          { status: 400 }
        );
      }

      if (json === null || typeof json !== "object" || Array.isArray(json)) {
        return NextResponse.json(
          { error: "Request body must be a non-null JSON object.", errorCode: "INVALID_PAYLOAD" },
          { status: 400 }
        );
      }

      const body = json as { reason?: unknown };
      if (body.reason !== undefined && body.reason !== null) {
        if (typeof body.reason !== "string") {
          return NextResponse.json(
            { error: "Cancellation reason must be a string.", errorCode: "INVALID_REASON" },
            { status: 400 }
          );
        }
        reason = body.reason;
      }
    }

    const result = await cancelBooking({
      identifier: token,
      identifierType: "token",
      cancelledBy: "guest",
      reason,
    });

    if (!result.success) {
      const status =
        result.errorCode === "NOT_FOUND"
          ? 404
          : result.errorCode === "CONFLICT"
          ? 409
          : 400;

      return NextResponse.json(
        { error: result.error, errorCode: result.errorCode },
        { status }
      );
    }

    return NextResponse.json({
      success: true,
      booking: result.booking,
      alreadyCancelled: result.alreadyCancelled ?? false,
      calendarSyncResult: result.calendarSyncResult,
    });
  } catch (err) {
    console.error("[Cancel API] POST error:", err);
    return NextResponse.json(
      { error: "Internal server error.", errorCode: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
