import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import crypto from "crypto";
import { isSameDatabase } from "@/lib/database/url-safety";
import { getOrCreateRoomForBooking, concludeRoomAndSynthesize } from "@/lib/room/room-service";
import * as veraModule from "@/lib/intelligence/vera";

/**
 * Genuine PostgreSQL Room Provisioning Concurrency & Atomic Vera Conclusion Integration Tests
 * 
 * REQUIREMENTS:
 * Requires an isolated disposable PostgreSQL / Neon database:
 * 1. Applied migrations up to 0008 (DATABASE_URL=<test-url> pnpm run db:migrate)
 * 2. TEST_DATABASE_URL environment variable set.
 * 
 * NEVER point TEST_DATABASE_URL at a production database!
 */

const testDbUrl = process.env.TEST_DATABASE_URL;
const describeIntegration = testDbUrl ? describe : describe.skip;

if (!testDbUrl) {
  console.log(
    "\n===================================================================================\n" +
    "[NOTICE] Real PostgreSQL Room & Vera Integration Tests Skipped:\n" +
    "TEST_DATABASE_URL is not configured. Genuine PostgreSQL migration, provisioning concurrency,\n" +
    "and atomic Vera synthesis claim tests require an isolated test database.\n" +
    "To provision and run:\n" +
    "  1. Provision an isolated PostgreSQL / Neon test database branch.\n" +
    "  2. Apply migrations: DATABASE_URL=<test-url> pnpm run db:migrate\n" +
    "  3. Run: TEST_DATABASE_URL=<test-url> pnpm test tests/scheduling/room-concurrency.integration.test.ts\n" +
    "===================================================================================\n"
  );
}

describeIntegration("Real PostgreSQL Room Concurrency & Atomic Vera Conclusion", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let testDb: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rawSql: any;

  const testHostId = crypto.randomUUID();
  const testEventTypeId = crypto.randomUUID();

  beforeAll(async () => {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Refusing to run destructive concurrency integration tests in production environment!");
    }
    if (isSameDatabase(testDbUrl, process.env.DATABASE_URL)) {
      throw new Error("Refusing to run tests: TEST_DATABASE_URL points to the same database instance as DATABASE_URL (production database)!");
    }

    rawSql = neon(testDbUrl!);
    testDb = drizzle(rawSql, { schema });

    // Seed test host user and event type
    await testDb.insert(schema.users).values({
      id: testHostId,
      name: "Integration Test Host",
      email: `test-host-${Date.now()}@usemorrow.com`,
      slug: `test-host-${Date.now()}`,
      timezone: "UTC",
    });

    await testDb.insert(schema.eventTypes).values({
      id: testEventTypeId,
      userId: testHostId,
      title: "Architecture Strategy Sync",
      slug: `strategy-${Date.now()}`,
      durationMins: 30,
      locationType: "google_meet",
      color: "blue",
      isActive: true,
    });
  });

  afterAll(async () => {
    if (rawSql) {
      try {
        await rawSql`DELETE FROM rooms WHERE booking_id IN (SELECT id FROM bookings WHERE host_id = ${testHostId})`;
        await rawSql`DELETE FROM bookings WHERE host_id = ${testHostId}`;
        await rawSql`DELETE FROM event_types WHERE id = ${testEventTypeId}`;
        await rawSql`DELETE FROM users WHERE id = ${testHostId}`;
      } catch (cleanupErr) {
        console.warn("Cleanup warning:", cleanupErr);
      }
    }
  });

  // =========================================================================
  // 1. Genuine Migration 0007 Verification on Real PostgreSQL
  // =========================================================================
  describe("Migration 0007 Verification on Real PostgreSQL", () => {
    it("confirms rooms.files column exists with NOT NULL and JSONB default '[]'", async () => {
      const columnInfo = await rawSql`
        SELECT column_name, data_type, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'rooms'
          AND column_name = 'files'
      `;

      expect(columnInfo.length).toBe(1);
      expect(columnInfo[0].data_type).toBe("jsonb");
      expect(columnInfo[0].is_nullable).toBe("NO");
      expect(columnInfo[0].column_default).toContain("'[]'::jsonb");
    });

    it("confirms rooms_booking_idx is a unique index", async () => {
      const indexInfo = await rawSql`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'rooms'
          AND indexname = 'rooms_booking_idx'
      `;

      expect(indexInfo.length).toBe(1);
      expect(indexInfo[0].indexdef).toContain("CREATE UNIQUE INDEX");
      expect(indexInfo[0].indexdef).toContain("booking_id");
    });

    it("confirms duplicate booking check prevents duplicate insertion", async () => {
      const bookingId = crypto.randomUUID();
      const token1 = `tok-${Date.now()}-1`;
      const token2 = `tok-${Date.now()}-2`;

      // Seed a booking
      await testDb.insert(schema.bookings).values({
        id: bookingId,
        hostId: testHostId,
        eventTypeId: testEventTypeId,
        startTime: new Date("2026-12-01T10:00:00Z"),
        endTime: new Date("2026-12-01T10:30:00Z"),
        guestName: "Duplicate Test Guest",
        guestEmail: "dup-guest@example.com",
        guestTimezone: "UTC",
        status: "confirmed",
        cancelToken: `cancel-${Date.now()}`,
      });

      // Insert first room
      await testDb.insert(schema.rooms).values({
        bookingId,
        accessToken: token1,
        status: "pre_meeting",
        files: [],
      });

      // Attempting to insert a second room with the same bookingId must fail with unique constraint violation
      await expect(
        testDb.insert(schema.rooms).values({
          bookingId,
          accessToken: token2,
          status: "pre_meeting",
          files: [],
        })
      ).rejects.toThrow();

      // Verify that exactly 1 room exists and was not deleted or replaced
      const roomRows = await rawSql`SELECT id, access_token FROM rooms WHERE booking_id = ${bookingId}`;
      expect(roomRows.length).toBe(1);
      expect(roomRows[0].access_token).toBe(token1);
    });
  });

  // =========================================================================
  // 2. Concurrent Room Provisioning on Real PostgreSQL
  // =========================================================================
  describe("Concurrent Room Provisioning on Real PostgreSQL", () => {
    it("guarantees exactly one room is created when 10 concurrent requests provision the same booking", async () => {
      const bookingId = crypto.randomUUID();

      await testDb.insert(schema.bookings).values({
        id: bookingId,
        hostId: testHostId,
        eventTypeId: testEventTypeId,
        startTime: new Date("2026-12-02T14:00:00Z"),
        endTime: new Date("2026-12-02T14:30:00Z"),
        guestName: "Concurrent Test Guest",
        guestEmail: "concurrent-guest@example.com",
        guestTimezone: "UTC",
        status: "confirmed",
        cancelToken: `cancel-concurrent-${Date.now()}`,
      });

      // Mock Vera's LLM generation to avoid external API calls during DB stress test
      vi.spyOn(veraModule, "generateVeraPreMeetingBrief").mockResolvedValue({
        intent: "Concurrent Provisioning Test",
        talkingPoints: ["Point A", "Point B"],
        suggestedAgenda: [
          { id: "ag-1", text: "Introductions", done: false, addedBy: "vera" },
          { id: "ag-2", text: "Discussion", done: false, addedBy: "vera" },
        ],
        background: "Mock background",
      });

      // Execute 10 concurrent room provisioning calls
      const concurrentCallers = 10;
      const provisioningPromises = Array.from({ length: concurrentCallers }, () =>
        getOrCreateRoomForBooking(bookingId)
      );

      const results = await Promise.all(provisioningPromises);

      // Verify no caller received undefined or an error
      expect(results.length).toBe(10);
      for (const res of results) {
        expect(res).toBeDefined();
        expect(res.id).toBeDefined();
        expect(res.accessToken).toBeDefined();
      }

      // Verify that every single caller received the exact same room ID and access token
      const primaryRoomId = results[0].id;
      const primaryToken = results[0].accessToken;

      for (const res of results) {
        expect(res.id).toBe(primaryRoomId);
        expect(res.accessToken).toBe(primaryToken);
      }

      // Direct database count verification
      const dbRows = await rawSql`SELECT id, access_token, agenda FROM rooms WHERE booking_id = ${bookingId}`;
      expect(dbRows.length).toBe(1);
      expect(dbRows[0].id).toBe(primaryRoomId);
      expect(dbRows[0].access_token).toBe(primaryToken);
      expect(dbRows[0].agenda).toHaveLength(2);
    });
  });

  // =========================================================================
  // 3. Atomic Vera Synthesis Claim & Recovery on Real PostgreSQL
  // =========================================================================
  describe("Atomic Vera Conclusion & Synthesis Lease on Real PostgreSQL", () => {
    it("allows only one of two concurrent host conclusion requests to acquire the synthesis lease", async () => {
      const bookingId = crypto.randomUUID();
      const accessToken = `tok-claim-test-${Date.now()}`;

      await testDb.insert(schema.bookings).values({
        id: bookingId,
        hostId: testHostId,
        eventTypeId: testEventTypeId,
        startTime: new Date("2026-12-03T11:00:00Z"),
        endTime: new Date("2026-12-03T11:30:00Z"),
        guestName: "Lease Test Guest",
        guestEmail: "lease-guest@example.com",
        guestTimezone: "UTC",
        status: "confirmed",
        cancelToken: `cancel-lease-${Date.now()}`,
      });

      await testDb.insert(schema.rooms).values({
        bookingId,
        accessToken,
        status: "in_progress",
        synthesisStatus: "idle",
        files: [],
      });

      // Mock Vera synthesis with artificial delay to test concurrency race
      let synthesisCallCount = 0;
      vi.spyOn(veraModule, "generateVeraLedger").mockImplementation(async () => {
        synthesisCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 200));
        return {
          executiveSummary: ["Real DB Synthesis completed successfully"],
          actionItems: [],
          keyDecisions: ["Decision 1"],
          suggestedFollowUp: "Send notes",
        };
      });

      // Fire two concurrent conclusion requests
      const [result1, result2] = await Promise.all([
        concludeRoomAndSynthesize(accessToken),
        concludeRoomAndSynthesize(accessToken),
      ]);

      // Exactly ONE caller acquired the lease and invoked Vera synthesis
      expect(synthesisCallCount).toBe(1);

      // One request concludes with the final ledger
      const successfulConclusion = result1.status === "concluded" ? result1 : result2;
      const concurrentFollower = result1.status === "concluded" ? result2 : result1;

      expect(successfulConclusion.status).toBe("concluded");
      expect(successfulConclusion.veraLedger).toBeDefined();

      // The follower receives an honest processing response (or already concluded) without independently invoking DeepSeek
      expect(["synthesizing", "concluded"]).toContain(concurrentFollower.status);

      // Verify database reflects final concluded state
      const dbRoom = await rawSql`SELECT status, synthesis_status, vera_ledger FROM rooms WHERE access_token = ${accessToken}`;
      expect(dbRoom[0].status).toBe("concluded");
      expect(dbRoom[0].synthesis_status).toBe("completed");
      expect(dbRoom[0].vera_ledger).toBeDefined();
    });

    it("recovers from an expired/abandoned synthesis lease after timeout", async () => {
      const bookingId = crypto.randomUUID();
      const accessToken = `tok-recover-test-${Date.now()}`;

      await testDb.insert(schema.bookings).values({
        id: bookingId,
        hostId: testHostId,
        eventTypeId: testEventTypeId,
        startTime: new Date("2026-12-04T15:00:00Z"),
        endTime: new Date("2026-12-04T15:30:00Z"),
        guestName: "Recovery Test Guest",
        guestEmail: "recovery-guest@example.com",
        guestTimezone: "UTC",
        status: "confirmed",
        cancelToken: `cancel-recovery-${Date.now()}`,
      });

      // Simulate a crashed worker: synthesis_status = 'synthesizing', claimed 90 seconds ago
      const expiredTime = new Date(Date.now() - 90_000);
      await testDb.insert(schema.rooms).values({
        bookingId,
        accessToken,
        status: "in_progress",
        synthesisStatus: "synthesizing",
        synthesisClaimToken: "stale-claim-token-from-crashed-worker",
        synthesisClaimedAt: expiredTime,
        files: [],
      });

      vi.spyOn(veraModule, "generateVeraLedger").mockResolvedValue({
        executiveSummary: ["Recovered synthesis"],
        actionItems: [],
        keyDecisions: [],
      });

      // A new request should detect the expired lease, reclaim it, and conclude successfully
      const result = await concludeRoomAndSynthesize(accessToken);

      expect(result.success).toBe(true);
      expect(result.status).toBe("concluded");
      expect(result.veraLedger?.executiveSummary).toContain("Recovered synthesis");

      // Verify in DB that the room is concluded and claim token cleared
      const roomRow = await rawSql`SELECT status, synthesis_status, synthesis_claim_token FROM rooms WHERE access_token = ${accessToken}`;
      expect(roomRow[0].status).toBe("concluded");
      expect(roomRow[0].synthesis_status).toBe("completed");
      expect(roomRow[0].synthesis_claim_token).toBeNull();
    });
  });
});
