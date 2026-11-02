import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { contacts, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const host = await db.query.users.findFirst({
      where: eq(users.email, session.user.email),
    });

    if (!host) {
      return NextResponse.json({ contacts: [] });
    }

    const items = await db.query.contacts.findMany({
      where: eq(contacts.userId, host.id),
      orderBy: [desc(contacts.lastBookingAt)],
    });

    return NextResponse.json({
      contacts: items.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        totalBookings: c.totalBookings,
        lastBookingAt: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(c.lastBookingAt),
        notes: c.notes || "",
      })),
    });
  } catch (err) {
    console.error("Error fetching contacts:", err);
    return NextResponse.json({ error: "Failed to load contacts" }, { status: 500 });
  }
}
