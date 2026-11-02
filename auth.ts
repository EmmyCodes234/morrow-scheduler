import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { db, users, eventTypes, availability, verificationTokens } from "@/db";
import { eq, and, gt } from "drizzle-orm";

async function getOrCreateUser(email: string, name?: string | null, avatarUrl?: string | null) {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existing) {
    return existing;
  }

  const baseSlug = (name || email.split("@")[0])
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const slugTaken = await db.query.users.findFirst({
    where: eq(users.slug, baseSlug),
  });
  const finalSlug = slugTaken ? `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}` : baseSlug;
  const displayName = name || email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const [newUser] = await db
    .insert(users)
    .values({
      name: displayName,
      email,
      slug: finalSlug,
      avatarUrl: avatarUrl || null,
      welcomeMessage: "Pick a time that works for you.",
      brandColor: "#2563EB",
      defaultLocationType: "google_meet",
    })
    .returning();

  // Seed default event types for the user
  await db.insert(eventTypes).values([
    {
      userId: newUser.id,
      title: "15 Min Quick Catchup",
      slug: "quick",
      durationMins: 15,
      description: "A fast sync to align on priorities or answer quick questions.",
      locationType: "google_meet",
      color: "blue",
      isActive: true,
    },
    {
      userId: newUser.id,
      title: "30 Min Strategy Call",
      slug: "strategy",
      durationMins: 30,
      description: "Discuss product roadmap, technical feasibility, and next milestones.",
      locationType: "google_meet",
      color: "emerald",
      isActive: true,
    },
    {
      userId: newUser.id,
      title: "45 Min Deep Dive",
      slug: "deep-dive",
      durationMins: 45,
      description: "In-depth architecture review, technical design, or partner discovery.",
      locationType: "google_meet",
      color: "violet",
      isActive: true,
    },
  ]);

  // Seed default Mon-Fri 9am-5pm availability
  const days = [0, 1, 2, 3, 4, 5, 6]; // Sun=0 ... Sat=6
  await db.insert(availability).values(
    days.map((day) => ({
      userId: newUser.id,
      dayOfWeek: day,
      startTime: "09:00",
      endTime: "17:00",
      isEnabled: day >= 1 && day <= 5, // Mon-Fri
    }))
  );

  return newUser;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          access_type: "offline",
          prompt: "consent",
          response_type: "code",
          scope: "openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
        },
      },
    }),
    Credentials({
      id: "email-otp",
      name: "Email OTP",
      credentials: {
        email: { label: "Email", type: "email" },
        otp: { label: "OTP", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.otp) {
          return null;
        }

        const email = (credentials.email as string).trim().toLowerCase();
        const otp = (credentials.otp as string).trim();

        const [tokenRow] = await db
          .select()
          .from(verificationTokens)
          .where(
            and(
              eq(verificationTokens.email, email),
              eq(verificationTokens.token, otp),
              gt(verificationTokens.expiresAt, new Date())
            )
          )
          .limit(1);

        if (!tokenRow) {
          return null;
        }

        // Consume OTP token
        await db.delete(verificationTokens).where(eq(verificationTokens.id, tokenRow.id));

        // Get or create user
        const dbUser = await getOrCreateUser(email);

        return {
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          image: dbUser.avatarUrl,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;

      // Email OTP credentials provider already validated and created/found user in authorize()
      if (account?.provider === "email-otp" || account?.provider === "credentials") {
        return true;
      }

      // Upsert into users table for Google OAuth
      if (process.env.DATABASE_URL) {
        try {
          const expiryDate = account?.expires_at ? new Date(account.expires_at * 1000) : null;
          const dbUser = await getOrCreateUser(user.email, user.name, user.image);

          // Update tokens for Google
          await db
            .update(users)
            .set({
              name: user.name || dbUser.name,
              avatarUrl: user.image || dbUser.avatarUrl,
              googleAccessToken: account?.access_token || dbUser.googleAccessToken,
              googleRefreshToken: account?.refresh_token || dbUser.googleRefreshToken,
              googleTokenExpiry: expiryDate || dbUser.googleTokenExpiry,
              updatedAt: new Date(),
            })
            .where(eq(users.id, dbUser.id));
        } catch (err) {
          console.error("Database upsert error during sign in:", err);
        }
      }

      return true;
    },
    async jwt({ token, account }) {
      if (account && account.provider === "google") {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
      }
      if (token.email) {
        try {
          const dbUser = await db.query.users.findFirst({
            where: eq(users.email, token.email),
          });
          if (dbUser) {
            token.dbUserId = dbUser.id;
            token.slug = dbUser.slug;
            token.name = dbUser.name;
            token.picture = dbUser.avatarUrl;
          }
        } catch (err) {
          console.error("Error looking up DB user in jwt:", err);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (token.dbUserId) {
          session.user.id = token.dbUserId as string;
        }
        if (token.slug) {
          (session.user as any).slug = token.slug as string;
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
