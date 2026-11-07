import { NextRequest, NextResponse } from "next/server";
import { processBooking } from "@/lib/scheduling/booking-service";
import { parseJsonRequest } from "@/lib/http/parse-json";
import { realtimeBus } from "@/lib/realtime/event-bus";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  // 1. Separate JSON parsing to distinguish malformed client inputs (400) from server errors (500)
  const parsed = await parseJsonRequest(req);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error, errorCode: parsed.errorCode },
      { status: parsed.status }
    );
  }

  const body = parsed.data;

  try {
    const { slug } = await params;

    const result = await processBooking(slug, {
      eventTypeId: body.eventTypeId as string,
      date: body.date as string,
      time: body.time as string,
      guestName: body.guestName as string,
      guestEmail: body.guestEmail as string,
      guestTimezone: body.guestTimezone as string | undefined,
      guestNotes: body.guestNotes as string | undefined,
      additionalGuests: body.additionalGuests as string | string[] | undefined,
      customAnswers: body.customAnswers as Record<string, unknown> | undefined,
      idempotencyKey: body.idempotencyKey as string | undefined,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, errorCode: result.errorCode },
        { status: result.status }
      );
    }

    if (result.booking) {
      const b = result.booking as any;
      const hostId = b.hostId || b.host?.id;
      if (hostId) {
        realtimeBus.broadcast(`host:${hostId}`, "booking.created", {
          id: b.id,
          guestName: b.guestName,
          guestEmail: b.guestEmail,
          eventTitle: b.eventType?.title || "Meeting",
          date: body.date,
          time: body.time,
          status: b.status,
          meetLink: b.meetLink,
          isGroup: Boolean(b.isGroup),
          maxAttendees: b.maxAttendees,
          attendeeCount: b.attendeeCount || 1,
          createdAt: b.createdAt || new Date().toISOString(),
        });
      }

      realtimeBus.broadcast(`public:host:${slug}`, "slot.booked", {
        eventTypeId: body.eventTypeId,
        date: body.date,
        time: body.time,
      });
    }

    return NextResponse.json(
      {
        success: true,
        booking: result.booking,
      },
      { status: result.status }
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Internal Server Error";
    console.error("Booking route error:", errorMessage);
    return NextResponse.json(
      { error: "Failed to confirm booking due to an unexpected error." },
      { status: 500 }
    );
  }
}
