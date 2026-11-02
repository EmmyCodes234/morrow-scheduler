import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, eventTypes, bookings, contacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createGoogleMeetEvent } from "@/lib/google-calendar";
import { sendBookingConfirmationEmail } from "@/lib/email";
import crypto from "crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await req.json();

    const {
      date, // "2026-11-04"
      time, // "10:00 AM"
      duration = 30, // in minutes
      guestName,
      guestEmail,
      guestNotes = "",
      guestTimezone = "UTC",
      eventTypeId,
    } = body;

    if (!date || !time || !guestName || !guestEmail) {
      return NextResponse.json(
        { error: "Missing required booking details (date, time, guestName, guestEmail)" },
        { status: 400 }
      );
    }

    // 1. Find host
    const host = await db.query.users.findFirst({
      where: eq(users.slug, slug),
    });

    if (!host) {
      return NextResponse.json({ error: "Host not found" }, { status: 404 });
    }

    // 2. Find or fallback event type
    let targetEventType = eventTypeId
      ? await db.query.eventTypes.findFirst({ where: eq(eventTypes.id, eventTypeId) })
      : await db.query.eventTypes.findFirst({ where: eq(eventTypes.userId, host.id) });

    if (!targetEventType) {
      // Auto-create default event type if none exists
      const [created] = await db
        .insert(eventTypes)
        .values({
          userId: host.id,
          title: `${duration} Min Meeting`,
          slug: `${duration}min`,
          durationMins: duration,
          locationType: "google_meet",
        })
        .returning();
      targetEventType = created;
    }

    // 3. Compute start and end ISO timestamps
    const [year, month, day] = date.split("-").map(Number);
    const timeMatch = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

    if (!timeMatch) {
      return NextResponse.json({ error: "Invalid time format (expected HH:MM AM/PM)" }, { status: 400 });
    }

    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const ampm = timeMatch[3].toUpperCase();

    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    const startTime = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
    const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

    const cancelToken = crypto.randomBytes(24).toString("hex");

    // 4. Create initial booking row in Neon Postgres
    const [newBooking] = await db
      .insert(bookings)
      .values({
        eventTypeId: targetEventType.id,
        hostId: host.id,
        guestName,
        guestEmail,
        startTime,
        endTime,
        guestTimezone,
        guestNotes,
        status: "confirmed",
        cancelToken,
      })
      .returning();

    // 5. Create Calendar event and resolve video conference link (Google Meet or Zoom)
    let meetLink: string | undefined = undefined;
    let gcalEventId: string | undefined = undefined;

    const isZoom = host.defaultLocationType === "zoom" && Boolean(host.zoomMeetingUrl);

    if (isZoom) {
      meetLink = host.zoomMeetingUrl!;
    }

    if (host.googleAccessToken || host.googleRefreshToken) {
      try {
        if (isZoom) {
          // Calendar event with host's Zoom room link
          const { google } = require("googleapis");
          const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
          );
          oauth2Client.setCredentials({
            access_token: host.googleAccessToken || undefined,
            refresh_token: host.googleRefreshToken || undefined,
          });

          const calendar = google.calendar({ version: "v3", auth: oauth2Client });
          const eventResponse = await calendar.events.insert({
            calendarId: "primary",
            sendUpdates: "all",
            requestBody: {
              summary: `${targetEventType.title} with ${guestName}`,
              description: `Scheduled via Morrow\n\nZoom Link: ${meetLink}\nGuest: ${guestName} (${guestEmail})\nNotes: ${guestNotes || "None"}`,
              location: meetLink,
              start: { dateTime: startTime.toISOString(), timeZone: host.timezone || "UTC" },
              end: { dateTime: endTime.toISOString(), timeZone: host.timezone || "UTC" },
              attendees: [{ email: guestEmail, displayName: guestName }],
            },
          });
          gcalEventId = eventResponse.data.id || undefined;
        } else {
          // Default: Generate dynamic Google Meet conference
          const gcalResult = await createGoogleMeetEvent({
            tokens: {
              accessToken: host.googleAccessToken,
              refreshToken: host.googleRefreshToken,
            },
            summary: `${targetEventType.title} with ${guestName}`,
            description: `Scheduled via Morrow\n\nGuest: ${guestName} (${guestEmail})\nNotes: ${guestNotes || "None"}`,
            startTime,
            endTime,
            guestEmail,
            guestName,
            timeZone: host.timezone,
          });

          meetLink = gcalResult.meetLink;
          gcalEventId = gcalResult.eventId;
        }
      } catch (gcalErr) {
        console.error("Error creating Google Calendar event:", gcalErr);
      }

      if (meetLink || gcalEventId) {
        await db
          .update(bookings)
          .set({ meetLink, gcalEventId })
          .where(eq(bookings.id, newBooking.id));
      }
    } else if (isZoom) {
      await db
        .update(bookings)
        .set({ meetLink })
        .where(eq(bookings.id, newBooking.id));
    }

    // 6. Upsert guest into Contacts
    try {
      const existingContact = await db.query.contacts.findFirst({
        where: and(eq(contacts.userId, host.id), eq(contacts.email, guestEmail)),
      });

      if (existingContact) {
        await db
          .update(contacts)
          .set({
            totalBookings: existingContact.totalBookings + 1,
            lastBookingAt: new Date(),
            name: guestName || existingContact.name,
            updatedAt: new Date(),
          })
          .where(eq(contacts.id, existingContact.id));
      } else {
        await db.insert(contacts).values({
          userId: host.id,
          email: guestEmail,
          name: guestName,
          totalBookings: 1,
          lastBookingAt: new Date(),
        });
      }
    } catch (contactErr) {
      console.error("Error upserting contact:", contactErr);
    }

    // 7. Dispatch confirmation emails (non-blocking)
    sendBookingConfirmationEmail({
      toEmail: guestEmail,
      guestName,
      hostName: host.name,
      hostEmail: host.email,
      eventTitle: targetEventType.title,
      dateStr: date,
      timeStr: time,
      durationMins: duration,
      meetLink: meetLink || (isZoom ? host.zoomMeetingUrl : "https://meet.google.com/new"),
      guestNotes,
      cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://usemorrow.xyz"}/cancel/${cancelToken}`,
    }).catch((err) => console.error("Error sending guest confirmation email:", err));

    return NextResponse.json({
      success: true,
      booking: {
        id: newBooking.id,
        guestName,
        guestEmail,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        meetLink: meetLink || "https://meet.google.com/new",
        cancelToken,
        eventType: targetEventType.title,
      },
    });
  } catch (err) {
    console.error("Booking error:", err);
    return NextResponse.json({ error: "Failed to confirm booking" }, { status: 500 });
  }
}
