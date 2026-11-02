import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

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
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      user: {
        id: host.id,
        name: host.name,
        email: host.email,
        slug: host.slug,
        avatarUrl: host.avatarUrl,
        timezone: host.timezone,
        brandColor: host.brandColor,
        welcomeMessage: host.welcomeMessage,
      },
    });
  } catch (err) {
    console.error("Error fetching user profile:", err);
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
  }
}
