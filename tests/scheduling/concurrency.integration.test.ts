import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

/**
 * Genuine PostgreSQL Concurrency & GiST Exclusion Constraint Integration Tests
 * 
 * REQUIREMENTS:
 * Requires an isolated PostgreSQL database configured with:
 * 1. btree_gist extension (CREATE EXTENSION IF NOT EXISTS btree_gist;)
 * 2. Applied migrations (pnpm run db:migrate with DATABASE_URL set to TEST_DATABASE_URL)
 * 3. TEST_DATABASE_URL environment variable set.
 * 
 * NEVER point TEST_DATABASE_URL at a production database!
 */

const testDbUrl = process.env.TEST_DATABASE_URL;
const describeIntegration = testDbUrl ? describe : describe.skip;

if (!testDbUrl) {
  console.log(
    "\n===================================================================================\n" +
    "[NOTICE] PostgreSQL Concurrency Integration Tests Skipped:\n" +
    "TEST_DATABASE_URL is not set. Real PostgreSQL concurrency tests require an isolated test database.\n" +
    "To provision and run:\n" +
    "  1. Create an isolated PostgreSQL database (e.g., local PostgreSQL or isolated Neon branch).\n" +
    "  2. Apply migrations: DATABASE_URL=<test-url> pnpm run db:migrate\n" +
    "  3. Run: TEST_DATABASE_URL=<test-url> pnpm test tests/scheduling/concurrency.integration.test.ts\n" +
    "===================================================================================\n"
  );
}

describeIntegration("Real PostgreSQL Concurrency & GiST Exclusion Constraints", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let testDb: any;
  const testHostId = `test-host-${Date.now()}`;
  const testEventTypeId = `test-event-${Date.now()}`;

  beforeAll(async () => {
    // Safety check: prevent accidental execution on production DB
    if (process.env.NODE_ENV === "production") {
      throw new Error("Refusing to run destructive concurrency integration tests in production environment!");
    }

    const sql = neon(testDbUrl!);
    testDb = drizzle(sql, { schema });

    // Seed test host user
    await testDb.insert(schema.users).values({
      id: testHostId,
      name: "Concurrency Test Host",
      email: `${testHostId}@example.com`,
      slug: testHostId,
      timezone: "UTC",
    });

    // Seed test event type
    await testDb.insert(schema.eventTypes).values({
      id: testEventTypeId,
      userId: testHostId,
      title: "Concurrency 30 Min",
      slug: "concurrency-30",
      durationMins: 30,
      bufferBeforeMins: 0,
      bufferAfterMins: 15,
      isActive: true,
    });
  });

  afterAll(async () => {
    if (!testDb) return;
    try {
      // Clean up test data safely scoped to testHostId
      await testDb.delete(schema.bookings).where(eq(schema.bookings.hostId, testHostId));
      await testDb.delete(schema.eventTypes).where(eq(schema.eventTypes.id, testEventTypeId));
      await testDb.delete(schema.users).where(eq(schema.users.id, testHostId));
    } catch (cleanupErr) {
      console.error("Cleanup error in integration tests:", cleanupErr);
    }
  });

  it("exercises PostgreSQL GiST exclusion constraint (23P01) on identical concurrent inserts", async () => {
    const startTime = new Date("2026-11-10T10:00:00.000Z");
    const endTime = new Date("2026-11-10T10:30:00.000Z");
    const bufferStartTime = startTime;
    const bufferEndTime = new Date("2026-11-10T10:45:00.000Z"); // 15 min buffer after

    const req1 = testDb.insert(schema.bookings).values({
      eventTypeId: testEventTypeId,
      hostId: testHostId,
      guestName: "Guest Alpha",
      guestEmail: "alpha@example.com",
      startTime,
      endTime,
      bufferStartTime,
      bufferEndTime,
      status: "confirmed",
      cancelToken: crypto.randomBytes(16).toString("hex"),
    });

    const req2 = testDb.insert(schema.bookings).values({
      eventTypeId: testEventTypeId,
      hostId: testHostId,
      guestName: "Guest Beta",
      guestEmail: "beta@example.com",
      startTime,
      endTime,
      bufferStartTime,
      bufferEndTime,
      status: "confirmed",
      cancelToken: crypto.randomBytes(16).toString("hex"),
    });

    const results = await Promise.allSettled([req1, req2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const error = (rejected[0] as PromiseRejectedResult).reason;
    const errorString = String(error);
    // Real PostgreSQL error code for exclusion violation is 23P01
    expect(
      errorString.includes("23P01") ||
      errorString.includes("exclusion_violation") ||
      errorString.includes("bookings_host_no_overlap")
    ).toBe(true);
  });

  it("rejects two concurrent requests whose buffer intervals overlap", async () => {
    // Booking A: 14:00 - 14:30, buffer ends at 14:45
    // Booking B: 14:30 - 15:00, buffer starts at 14:30
    // Buffer A (until 14:45) overlaps with Booking B's interval (14:30-15:00)
    const startA = new Date("2026-11-10T14:00:00.000Z");
    const endA = new Date("2026-11-10T14:30:00.000Z");
    const bufStartA = startA;
    const bufEndA = new Date("2026-11-10T14:45:00.000Z");

    const startB = new Date("2026-11-10T14:30:00.000Z");
    const endB = new Date("2026-11-10T15:00:00.000Z");
    const bufStartB = startB;
    const bufEndB = new Date("2026-11-10T15:15:00.000Z");

    const insertA = testDb.insert(schema.bookings).values({
      eventTypeId: testEventTypeId,
      hostId: testHostId,
      guestName: "Guest Buffer A",
      guestEmail: "bufA@example.com",
      startTime: startA,
      endTime: endA,
      bufferStartTime: bufStartA,
      bufferEndTime: bufEndA,
      status: "confirmed",
      cancelToken: crypto.randomBytes(16).toString("hex"),
    });

    const insertB = testDb.insert(schema.bookings).values({
      eventTypeId: testEventTypeId,
      hostId: testHostId,
      guestName: "Guest Buffer B",
      guestEmail: "bufB@example.com",
      startTime: startB,
      endTime: endB,
      bufferStartTime: bufStartB,
      bufferEndTime: bufEndB,
      status: "confirmed",
      cancelToken: crypto.randomBytes(16).toString("hex"),
    });

    const results = await Promise.allSettled([insertA, insertB]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const error = (rejected[0] as PromiseRejectedResult).reason;
    expect(
      String(error).includes("23P01") ||
      String(error).includes("exclusion_violation") ||
      String(error).includes("bookings_host_no_overlap")
    ).toBe(true);
  });

  it("allows two non-overlapping requests to both succeed concurrently", async () => {
    // Slot 1: 16:00 - 16:30 (buffer ends 16:45)
    // Slot 2: 17:00 - 17:30 (buffer starts 17:00)
    const start1 = new Date("2026-11-10T16:00:00.000Z");
    const end1 = new Date("2026-11-10T16:30:00.000Z");
    const bufEnd1 = new Date("2026-11-10T16:45:00.000Z");

    const start2 = new Date("2026-11-10T17:00:00.000Z");
    const end2 = new Date("2026-11-10T17:30:00.000Z");
    const bufEnd2 = new Date("2026-11-10T17:45:00.000Z");

    const insert1 = testDb.insert(schema.bookings).values({
      eventTypeId: testEventTypeId,
      hostId: testHostId,
      guestName: "Guest NonOverlap 1",
      guestEmail: "non1@example.com",
      startTime: start1,
      endTime: end1,
      bufferStartTime: start1,
      bufferEndTime: bufEnd1,
      status: "confirmed",
      cancelToken: crypto.randomBytes(16).toString("hex"),
    });

    const insert2 = testDb.insert(schema.bookings).values({
      eventTypeId: testEventTypeId,
      hostId: testHostId,
      guestName: "Guest NonOverlap 2",
      guestEmail: "non2@example.com",
      startTime: start2,
      endTime: end2,
      bufferStartTime: start2,
      bufferEndTime: bufEnd2,
      status: "confirmed",
      cancelToken: crypto.randomBytes(16).toString("hex"),
    });

    const results = await Promise.allSettled([insert1, insert2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");

    expect(fulfilled.length).toBe(2);
  });

  it("enforces host-scoped unique constraint on repeated idempotency keys", async () => {
    const sharedIdempotencyKey = `idem-${Date.now()}`;

    // First insert succeeds
    await testDb.insert(schema.bookings).values({
      eventTypeId: testEventTypeId,
      hostId: testHostId,
      guestName: "Guest Idem 1",
      guestEmail: "idem1@example.com",
      startTime: new Date("2026-11-10T18:00:00.000Z"),
      endTime: new Date("2026-11-10T18:30:00.000Z"),
      bufferStartTime: new Date("2026-11-10T18:00:00.000Z"),
      bufferEndTime: new Date("2026-11-10T18:30:00.000Z"),
      idempotencyKey: sharedIdempotencyKey,
      status: "confirmed",
      cancelToken: crypto.randomBytes(16).toString("hex"),
    });

    // Re-inserting with the same idempotency key for the same host violates unique index
    await expect(
      testDb.insert(schema.bookings).values({
        eventTypeId: testEventTypeId,
        hostId: testHostId,
        guestName: "Guest Idem 2",
        guestEmail: "idem2@example.com",
        startTime: new Date("2026-11-10T19:00:00.000Z"),
        endTime: new Date("2026-11-10T19:30:00.000Z"),
        bufferStartTime: new Date("2026-11-10T19:00:00.000Z"),
        bufferEndTime: new Date("2026-11-10T19:30:00.000Z"),
        idempotencyKey: sharedIdempotencyKey,
        status: "confirmed",
        cancelToken: crypto.randomBytes(16).toString("hex"),
      })
    ).rejects.toThrow();
  });
});
