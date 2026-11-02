import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/db";
import { users, eventTypes, availability } from "@/db/schema";
import { eq } from "drizzle-orm";

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
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;

      // Upsert into users table
      if (process.env.DATABASE_URL) {
        try {
          const existing = await db.query.users.findFirst({
            where: eq(users.email, user.email),
          });

          const expiryDate = account?.expires_at ? new Date(account.expires_at * 1000) : null;
          const baseSlug = (user.name || user.email.split("@")[0])
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");

          if (!existing) {
            // Check if slug is taken, if so append random suffix
            const slugTaken = await db.query.users.findFirst({
              where: eq(users.slug, baseSlug),
            });
            const finalSlug = slugTaken ? `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}` : baseSlug;

            const [newUser] = await db
              .insert(users)
              .values({
                name: user.name || "Morrow Host",
                email: user.email,
                slug: finalSlug,
                avatarUrl: user.image,
                googleAccessToken: account?.access_token,
                googleRefreshToken: account?.refresh_token,
                googleTokenExpiry: expiryDate,
                welcomeMessage: "Pick a time that works for you.",
                brandColor: "#2563EB",
              })
              .returning();

            // Seed default event types for the real user
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
          } else {
            // Update existing user's tokens & avatar
            await db
              .update(users)
              .set({
                name: user.name || existing.name,
                avatarUrl: user.image || existing.avatarUrl,
                googleAccessToken: account?.access_token || existing.googleAccessToken,
                googleRefreshToken: account?.refresh_token || existing.googleRefreshToken,
                googleTokenExpiry: expiryDate || existing.googleTokenExpiry,
                updatedAt: new Date(),
              })
              .where(eq(users.id, existing.id));
          }
        } catch (err) {
          console.error("Database upsert error during sign in:", err);
        }
      }

      return true;
    },
    async jwt({ token, account, user }) {
      if (account) {
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
