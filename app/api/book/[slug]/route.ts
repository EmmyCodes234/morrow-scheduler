import { NextRequest, NextResponse } from "next/server";
import { processBooking } from "@/lib/scheduling/booking-service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await req.json();

    const result = await processBooking(slug, {
      eventTypeId: body.eventTypeId,
      date: body.date,
      time: body.time,
      guestName: body.guestName,
      guestEmail: body.guestEmail,
      guestTimezone: body.guestTimezone,
      guestNotes: body.guestNotes,
      additionalGuests: body.additionalGuests,
      customAnswers: body.customAnswers,
      idempotencyKey: body.idempotencyKey,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, errorCode: result.errorCode },
        { status: result.status }
      );
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
