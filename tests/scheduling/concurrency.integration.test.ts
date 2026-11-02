import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import crypto from "crypto";
import { isSameDatabase } from "@/lib/database/url-safety";

/**
 * Genuine PostgreSQL Concurrency & GiST Exclusion Constraint Integration Tests
 * 
 * REQUIREMENTS:
 * Requires an isolated PostgreSQL database configured with:
 * 1. btree_gist extension (CREATE EXTENSION IF NOT EXISTS btree_gist;)
 * 2. Applied migrations up to 0002_dapper_sentinel (pnpm run db:migrate with DATABASE_URL set to TEST_DATABASE_URL)
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
    "TEST_DATABASE_URL is not configured. Real PostgreSQL concurrency tests require an isolated test database.\n" +
    "To provision and run:\n" +
    "  1. Provision an isolated PostgreSQL / Neon test database branch.\n" +
    "  2. Apply migrations: DATABASE_URL=<test-url> pnpm run db:migrate\n" +
    "  3. Run: TEST_DATABASE_URL=<test-url> pnpm test tests/scheduling/concurrency.integration.test.ts\n" +
    "===================================================================================\n"
  );
}

describeIntegration("Real PostgreSQL Concurrency & GiST Exclusion Constraints", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let testDb: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rawSql: any;
  const testHostId = crypto.randomUUID();
  const testHost2Id = crypto.randomUUID();
  const testEventTypeId = crypto.randomUUID();
  const testEventType2Id = crypto.randomUUID();

  beforeAll(async () => {
    // Safety check: prevent accidental execution on production DB
    if (process.env.NODE_ENV === "production") {
      throw new Error("Refusing to run destructive concurrency integration tests in production environment!");
    }
    if (isSameDatabase(testDbUrl, process.env.DATABASE_URL)) {
      throw new Error("Refusing to run tests: TEST_DATABASE_URL points to the same database instance as DATABASE_URL (production database)!");
    }

    rawSql = neon(testDbUrl!);
    testDb = drizzle(rawSql, { schema });

    // Verify that the required exclusion constraint is installed and correctly configured
    const constraintCheck = await rawSql.query(
      `SELECT conname, pg_get_constraintdef(oid) as def 
       FROM pg_constraint 
       WHERE conname = 'bookings_host_no_overlap'`
    );

    if (constraintCheck.length === 0) {
      throw new Error(
        "Missing required constraint 'bookings_host_no_overlap'. Please run migrations on the test database first."
      );
    }

    const constraintDef = constraintCheck[0].def || "";
    if (!constraintDef.includes("rejected") || !constraintDef.includes("cancelled")) {
      throw new Error(
        `Constraint 'bookings_host_no_overlap' does not exclude both cancelled and rejected bookings: ${constraintDef}`
      );
    }

    // Seed test host users with valid UUIDs
    await testDb.insert(schema.users).values([
      {
        id: testHostId,
        name: "Concurrency Host Alpha",
        email: `host-${testHostId}@example.com`,
        slug: `host-${testHostId.slice(0, 8)}`,
        timezone: "UTC",
      },
      {
        id: testHost2Id,
        name: "Concurrency Host Beta",
        email: `host-${testHost2Id}@example.com`,
        slug: `host-${testHost2Id.slice(0, 8)}`,
        timezone: "UTC",
      },
    ]);

    // Seed test event types
    await testDb.insert(schema.eventTypes).values([
      {
        id: testEventTypeId,
        userId: testHostId,
        title: "Concurrency 30 Min Alpha",
        slug: "concurrency-30-alpha",
        durationMins: 30,
        bufferBeforeMins: 0,
        bufferAfterMins: 15,
        isActive: true,
      },
      {
        id: testEventType2Id,
        userId: testHost2Id,
        title: "Concurrency 30 Min Beta",
        slug: "concurrency-30-beta",
        durationMins: 30,
        bufferBeforeMins: 0,
        bufferAfterMins: 15,
        isActive: true,
      },
    ]);
  });

  afterAll(async () => {
    if (!testDb) return;
    try {
      // Clean up test data strictly scoped to our generated test UUIDs
      const hostIds = [testHostId, testHost2Id];
      await testDb.delete(schema.bookings).where(inArray(schema.bookings.hostId, hostIds));
      await testDb.delete(schema.eventTypes).where(inArray(schema.eventTypes.userId, hostIds));
      await testDb.delete(schema.users).where(inArray(schema.users.id, hostIds));
    } catch (cleanupErr) {
      console.error("Cleanup error in integration tests:", cleanupErr);
    }
  });

  it("exercises PostgreSQL GiST exclusion constraint (23P01) on identical concurrent inserts", async () => {
    const startTime = new Date("2026-11-10T10:00:00.000Z");
    const endTime = new Date("2026-11-10T10:30:00.000Z");
    const bufferStartTime = startTime;
    const bufferEndTime = new Date("2026-11-10T10:45:00.000Z");

    const req1 = testDb.insert(schema.bookings).values({
      id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
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
    expect(
      errorString.includes("23P01") ||
      errorString.includes("exclusion_violation") ||
      errorString.includes("bookings_host_no_overlap")
    ).toBe(true);
  });

  it("rejects two concurrent requests whose buffer intervals overlap", async () => {
    const startA = new Date("2026-11-10T14:00:00.000Z");
    const endA = new Date("2026-11-10T14:30:00.000Z");
    const bufEndA = new Date("2026-11-10T14:45:00.000Z");

    const startB = new Date("2026-11-10T14:30:00.000Z");
    const endB = new Date("2026-11-10T15:00:00.000Z");
    const bufEndB = new Date("2026-11-10T15:15:00.000Z");

    const insertA = testDb.insert(schema.bookings).values({
      id: crypto.randomUUID(),
      eventTypeId: testEventTypeId,
      hostId: testHostId,
      guestName: "Guest Buffer A",
      guestEmail: "bufA@example.com",
      startTime: startA,
      endTime: endA,
      bufferStartTime: startA,
      bufferEndTime: bufEndA,
      status: "confirmed",
      cancelToken: crypto.randomBytes(16).toString("hex"),
    });

    const insertB = testDb.insert(schema.bookings).values({
      id: crypto.randomUUID(),
      eventTypeId: testEventTypeId,
      hostId: testHostId,
      guestName: "Guest Buffer B",
      guestEmail: "bufB@example.com",
      startTime: startB,
      endTime: endB,
      bufferStartTime: startB,
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
    const start1 = new Date("2026-11-10T16:00:00.000Z");
    const end1 = new Date("2026-11-10T16:30:00.000Z");
    const bufEnd1 = new Date("2026-11-10T16:45:00.000Z");

    const start2 = new Date("2026-11-10T17:00:00.000Z");
    const end2 = new Date("2026-11-10T17:30:00.000Z");
    const bufEnd2 = new Date("2026-11-10T17:45:00.000Z");

    const insert1 = testDb.insert(schema.bookings).values({
      id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
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

  it("verifies that cancelled bookings release their reservation", async () => {
    const startTime = new Date("2026-11-11T09:00:00.000Z");
    const endTime = new Date("2026-11-11T09:30:00.000Z");
    const bufferEndTime = new Date("2026-11-11T09:45:00.000Z");
    const bookingId = crypto.randomUUID();

    // Insert active booking
    await testDb.insert(schema.bookings).values({
      id: bookingId,
      eventTypeId: testEventTypeId,
      hostId: testHostId,
      guestName: "Guest To Cancel",
      guestEmail: "cancelme@example.com",
      startTime,
      endTime,
      bufferStartTime: startTime,
      bufferEndTime,
      status: "confirmed",
      cancelToken: crypto.randomBytes(16).toString("hex"),
    });

    // Update status to 'cancelled'
    await testDb
      .update(schema.bookings)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(schema.bookings.id, bookingId));

    // A new booking at the exact same time should now SUCCEED
    const replacementBooking = await testDb
      .insert(schema.bookings)
      .values({
        id: crypto.randomUUID(),
        eventTypeId: testEventTypeId,
        hostId: testHostId,
        guestName: "New Guest Replacement",
        guestEmail: "replacement@example.com",
        startTime,
        endTime,
        bufferStartTime: startTime,
        bufferEndTime,
        status: "confirmed",
        cancelToken: crypto.randomBytes(16).toString("hex"),
      })
      .returning();

    expect(replacementBooking.length).toBe(1);
    expect(replacementBooking[0].guestEmail).toBe("replacement@example.com");
  });

  it("verifies that rejected bookings release their reservation", async () => {
    const startTime = new Date("2026-11-11T11:00:00.000Z");
    const endTime = new Date("2026-11-11T11:30:00.000Z");
    const bufferEndTime = new Date("2026-11-11T11:45:00.000Z");
    const bookingId = crypto.randomUUID();

    // Insert pending booking
    await testDb.insert(schema.bookings).values({
      id: bookingId,
      eventTypeId: testEventTypeId,
      hostId: testHostId,
      guestName: "Guest To Reject",
      guestEmail: "rejectme@example.com",
      startTime,
      endTime,
      bufferStartTime: startTime,
      bufferEndTime,
      status: "pending",
      cancelToken: crypto.randomBytes(16).toString("hex"),
    });

    // Update status to 'rejected'
    await testDb
      .update(schema.bookings)
      .set({ status: "rejected" })
      .where(eq(schema.bookings.id, bookingId));

    // A new booking at the exact same time should now SUCCEED
    const replacementBooking = await testDb
      .insert(schema.bookings)
      .values({
        id: crypto.randomUUID(),
        eventTypeId: testEventTypeId,
        hostId: testHostId,
        guestName: "New Guest After Rejection",
        guestEmail: "afterrejection@example.com",
        startTime,
        endTime,
        bufferStartTime: startTime,
        bufferEndTime,
        status: "confirmed",
        cancelToken: crypto.randomBytes(16).toString("hex"),
      })
      .returning();

    expect(replacementBooking.length).toBe(1);
    expect(replacementBooking[0].guestEmail).toBe("afterrejection@example.com");
  });

  it("verifies that pending bookings continue reserving their slot in the exclusion constraint", async () => {
    const startTime = new Date("2026-11-11T13:00:00.000Z");
    const endTime = new Date("2026-11-11T13:30:00.000Z");
    const bufferEndTime = new Date("2026-11-11T13:45:00.000Z");

    // Insert pending booking
    await testDb.insert(schema.bookings).values({
      id: crypto.randomUUID(),
      eventTypeId: testEventTypeId,
      hostId: testHostId,
      guestName: "Pending Guest",
      guestEmail: "pending@example.com",
      startTime,
      endTime,
      bufferStartTime: startTime,
      bufferEndTime,
      status: "pending",
      cancelToken: crypto.randomBytes(16).toString("hex"),
    });

    // Attempt to book the exact same slot while pending booking exists -> must fail with 23P01
    await expect(
      testDb.insert(schema.bookings).values({
        id: crypto.randomUUID(),
        eventTypeId: testEventTypeId,
        hostId: testHostId,
        guestName: "Competing Guest",
        guestEmail: "competing@example.com",
        startTime,
        endTime,
        bufferStartTime: startTime,
        bufferEndTime,
        status: "confirmed",
        cancelToken: crypto.randomBytes(16).toString("hex"),
      })
    ).rejects.toThrow();
  });

  it("enforces host-scoped idempotency uniqueness correctly across hosts", async () => {
    const sharedIdempotencyKey = `idem-${crypto.randomUUID()}`;

    // Booking for Host Alpha succeeds
    const alphaBooking = await testDb
      .insert(schema.bookings)
      .values({
        id: crypto.randomUUID(),
        eventTypeId: testEventTypeId,
        hostId: testHostId,
        guestName: "Guest Alpha Idem",
        guestEmail: "alpha_idem@example.com",
        startTime: new Date("2026-11-11T15:00:00.000Z"),
        endTime: new Date("2026-11-11T15:30:00.000Z"),
        bufferStartTime: new Date("2026-11-11T15:00:00.000Z"),
        bufferEndTime: new Date("2026-11-11T15:45:00.000Z"),
        idempotencyKey: sharedIdempotencyKey,
        status: "confirmed",
        cancelToken: crypto.randomBytes(16).toString("hex"),
      })
      .returning();

    expect(alphaBooking.length).toBe(1);

    // Same idempotency key for Host Beta must SUCCEED (because index is scoped to (host_id, idempotency_key))
    const betaBooking = await testDb
      .insert(schema.bookings)
      .values({
        id: crypto.randomUUID(),
        eventTypeId: testEventType2Id,
        hostId: testHost2Id,
        guestName: "Guest Beta Idem",
        guestEmail: "beta_idem@example.com",
        startTime: new Date("2026-11-11T15:00:00.000Z"),
        endTime: new Date("2026-11-11T15:30:00.000Z"),
        bufferStartTime: new Date("2026-11-11T15:00:00.000Z"),
        bufferEndTime: new Date("2026-11-11T15:45:00.000Z"),
        idempotencyKey: sharedIdempotencyKey,
        status: "confirmed",
        cancelToken: crypto.randomBytes(16).toString("hex"),
      })
      .returning();

    expect(betaBooking.length).toBe(1);

    // Duplicate idempotency key for the SAME host (Host Alpha) must FAIL with unique violation (23505)
    await expect(
      testDb.insert(schema.bookings).values({
        id: crypto.randomUUID(),
        eventTypeId: testEventTypeId,
        hostId: testHostId,
        guestName: "Guest Alpha Duplicate",
        guestEmail: "alpha_dup@example.com",
        startTime: new Date("2026-11-11T17:00:00.000Z"),
        endTime: new Date("2026-11-11T17:30:00.000Z"),
        bufferStartTime: new Date("2026-11-11T17:00:00.000Z"),
        bufferEndTime: new Date("2026-11-11T17:45:00.000Z"),
        idempotencyKey: sharedIdempotencyKey,
        status: "confirmed",
        cancelToken: crypto.randomBytes(16).toString("hex"),
      })
    ).rejects.toThrow();
  });
});
