import { NextRequest, NextResponse } from "next/server";
import { registerMeetingAttendee, sendAttendeeConfirmationEmail } from "@/lib/meetings/meeting-service";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { invitationToken, name, email } = body;

    if (!invitationToken || typeof invitationToken !== "string") {
      return NextResponse.json(
        { error: "Invitation token is required." },
        { status: 400 }
      );
    }

    const result = await registerMeetingAttendee({
      invitationToken,
      name,
      email,
    });

    if (!result.success || !result.attendee || !result.meeting) {
      return NextResponse.json(
        { error: result.error || "Registration failed." },
        { status: 400 }
      );
    }

    const response = NextResponse.json({
      success: true,
      attendee: {
        id: result.attendee.id,
        name: result.attendee.name,
        email: result.attendee.email,
        status: result.attendee.status,
      },
      roomAccessToken: result.roomAccessToken,
      meeting: {
        id: result.meeting.id,
        title: result.meeting.title,
        startTime: result.meeting.startTime,
        endTime: result.meeting.endTime,
        timezone: result.meeting.timezone,
        preparationMaterial: result.meeting.preparationMaterial,
      },
    });

    // Set secure HTTP-only attendee session cookie
    response.cookies.set("morrow_attendee_session", result.attendee.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    // Attempt to dispatch registration confirmation email asynchronously
    const origin = req.nextUrl.origin;
    const roomAccessToken = result.roomAccessToken || "";
    const meetingTitle = result.meeting.title;
    const meetingStartTime = result.meeting.startTime;
    const meetingTimezone = result.meeting.timezone;
    const attendeeName = result.attendee.name;
    const attendeeEmail = result.attendee.email;

    sendAttendeeConfirmationEmail({
      toEmail: attendeeEmail,
      attendeeName,
      hostName: ((result.meeting as any)?.host?.name || "The Host"),
      meetingTitle,
      startTime: meetingStartTime,
      timezone: meetingTimezone,
      roomAccessToken,
      invitationToken,
      origin,
    }).catch((err) =>
      console.warn("[Meeting Registration] Background email dispatch caught error:", err)
    );

    return response;
  } catch (err) {
    console.error("[Meeting Registration API] Error:", err);
    return NextResponse.json(
      { error: "Internal server error during registration." },
      { status: 500 }
    );
  }
}
