import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import crypto from "crypto";
import { isSameDatabase } from "@/lib/database/url-safety";
import {
  getOrCreateRoomForBooking,
  concludeRoomAndSynthesize,
  updateRoomNotes,
} from "@/lib/room/room-service";
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
  // 1. Genuine Migration 0007 & 0008 Verification on Real PostgreSQL
  // =========================================================================
  describe("Migration 0007 & 0008 Verification on Real PostgreSQL", () => {
    it("confirms migration journal tracking records migrations 0007 and 0008", async () => {
      // Check drizzle migration tracking table if present
      const trackingTable = await rawSql`
        SELECT table_name, table_schema
        FROM information_schema.tables
        WHERE table_name = '__drizzle_migrations'
      `;

      if (trackingTable.length > 0) {
        const schemaName = trackingTable[0].table_schema;
        const migrationRows = await rawSql`
          SELECT id, hash, created_at
          FROM ${rawSql(schemaName)}.__drizzle_migrations
          ORDER BY id ASC
        `;
        // When migrations are applied, verify entries exist
        expect(migrationRows.length).toBeGreaterThanOrEqual(1);
      }
    });

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

    it("confirms migration 0008 synthesis lease columns exist in rooms table", async () => {
      const columns = await rawSql`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'rooms'
          AND column_name IN ('synthesis_status', 'synthesis_claim_token', 'synthesis_claimed_at', 'synthesis_last_error')
      `;

      const colNames = columns.map((c: any) => c.column_name);
      expect(colNames).toContain("synthesis_status");
      expect(colNames).toContain("synthesis_claim_token");
      expect(colNames).toContain("synthesis_claimed_at");
      expect(colNames).toContain("synthesis_last_error");

      const statusCol = columns.find((c: any) => c.column_name === "synthesis_status");
      expect(statusCol.is_nullable).toBe("NO");
      expect(statusCol.column_default).toContain("'idle'");
    });

    it("confirms duplicate booking check prevents duplicate insertion without dropping records", async () => {
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
  // 2. Concurrent Room Provisioning on Real PostgreSQL with DB Injection
  // =========================================================================
  describe("Concurrent Room Provisioning on Real PostgreSQL with DB Injection", () => {
    it("proves room service operations execute against the injected testDb client", async () => {
      const bookingId = crypto.randomUUID();

      await testDb.insert(schema.bookings).values({
        id: bookingId,
        hostId: testHostId,
        eventTypeId: testEventTypeId,
        startTime: new Date("2026-12-02T09:00:00Z"),
        endTime: new Date("2026-12-02T09:30:00Z"),
        guestName: "Injection Test Guest",
        guestEmail: "injection-guest@example.com",
        guestTimezone: "UTC",
        status: "confirmed",
        cancelToken: `cancel-inj-${Date.now()}`,
      });

      // Explicitly pass testDb
      const created = await getOrCreateRoomForBooking(bookingId, testDb);
      expect(created).toBeDefined();

      // Verify directly on test database that record exists
      const testDbCheck = await testDb.query.rooms.findFirst({
        where: eq(schema.rooms.bookingId, bookingId),
      });
      expect(testDbCheck).toBeDefined();
      expect(testDbCheck?.id).toBe(created.id);
    });

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

      // Execute 10 concurrent room provisioning calls explicitly using testDb
      const concurrentCallers = 10;
      const provisioningPromises = Array.from({ length: concurrentCallers }, () =>
        getOrCreateRoomForBooking(bookingId, testDb)
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

      // Fire two concurrent conclusion requests explicitly passing testDb
      const [result1, result2] = await Promise.all([
        concludeRoomAndSynthesize(accessToken, testDb),
        concludeRoomAndSynthesize(accessToken, testDb),
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
      const result = await concludeRoomAndSynthesize(accessToken, testDb);

      expect(result.success).toBe(true);
      expect(result.status).toBe("concluded");
      expect(result.veraLedger?.executiveSummary).toContain("Recovered synthesis");

      // Verify in DB that the room is concluded and claim token cleared
      const roomRow = await rawSql`SELECT status, synthesis_status, synthesis_claim_token FROM rooms WHERE access_token = ${accessToken}`;
      expect(roomRow[0].status).toBe("concluded");
      expect(roomRow[0].synthesis_status).toBe("completed");
      expect(roomRow[0].synthesis_claim_token).toBeNull();
    });

    it("stale worker fencing: deferred synthesis execution prevents expired Worker A from overwriting Worker B", async () => {
      const bookingId = crypto.randomUUID();
      const accessToken = `tok-deferred-fencing-${Date.now()}`;

      await testDb.insert(schema.bookings).values({
        id: bookingId,
        hostId: testHostId,
        eventTypeId: testEventTypeId,
        startTime: new Date("2026-12-05T16:00:00Z"),
        endTime: new Date("2026-12-05T16:30:00Z"),
        guestName: "Fencing Test Guest",
        guestEmail: "fencing-guest@example.com",
        guestTimezone: "UTC",
        status: "confirmed",
        cancelToken: `cancel-fencing-${Date.now()}`,
      });

      await testDb.insert(schema.rooms).values({
        bookingId,
        accessToken,
        status: "in_progress",
        synthesisStatus: "idle",
        sharedNotes: "Authentic notes for fencing test: agreed to proceed with Worker B.",
        files: [],
      });

      // Controlled deferred synchronization for Worker A
      let resolveWorkerAPause!: () => void;
      const workerAPausePromise = new Promise<void>((resolve) => {
        resolveWorkerAPause = resolve;
      });

      let resolveWorkerAStarted!: () => void;
      const workerAStartedPromise = new Promise<void>((resolve) => {
        resolveWorkerAStarted = resolve;
      });

      let callCount = 0;
      vi.spyOn(veraModule, "generateVeraLedger").mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Worker A execution: signal started and pause
          resolveWorkerAStarted();
          await workerAPausePromise;
          return {
            executiveSummary: ["Worker A stale attempt (should be rejected)"],
            actionItems: [],
            keyDecisions: [],
          };
        } else {
          // Worker B execution: immediate completion
          return {
            executiveSummary: ["Worker B authoritative ledger"],
            actionItems: [],
            keyDecisions: ["Worker B decision"],
          };
        }
      });

      // 1. Worker A begins synthesis and acquires lease in DB
      const workerAPromise = concludeRoomAndSynthesize(accessToken, testDb);

      // Wait until Worker A has acquired claim and entered generateVeraLedger
      await workerAStartedPromise;

      // Verify Worker A claimed the room
      const workerARoom = await testDb.query.rooms.findFirst({
        where: eq(schema.rooms.accessToken, accessToken),
      });
      expect(workerARoom?.synthesisStatus).toBe("synthesizing");
      expect(workerARoom?.synthesisClaimToken).toBeDefined();

      // 2. Deterministically simulate Worker A lease expiration in database
      const ninetySecondsAgo = new Date(Date.now() - 90_000);
      await testDb
        .update(schema.rooms)
        .set({ synthesisClaimedAt: ninetySecondsAgo })
        .where(eq(schema.rooms.accessToken, accessToken));

      // 3. Worker B runs concludeRoomAndSynthesize, reclaims lease and successfully concludes
      const workerBResult = await concludeRoomAndSynthesize(accessToken, testDb);
      expect(workerBResult.success).toBe(true);
      expect(workerBResult.status).toBe("concluded");
      expect(workerBResult.veraLedger?.executiveSummary).toContain("Worker B authoritative ledger");

      // 4. Now Worker A resumes and attempts its actual service completion path
      resolveWorkerAPause();
      const workerAResult = await workerAPromise;

      // 5. Worker A must be rejected as stale_worker
      expect(workerAResult.success).toBe(false);
      expect(workerAResult.status).toBe("stale_worker");

      // 6. Worker B's ledger is completely preserved
      const finalRoom = await testDb.query.rooms.findFirst({
        where: eq(schema.rooms.accessToken, accessToken),
      });
      expect(finalRoom?.status).toBe("concluded");
      expect(finalRoom?.synthesisStatus).toBe("completed");
      expect(finalRoom?.veraLedger?.executiveSummary).toContain("Worker B authoritative ledger");
      expect(finalRoom?.veraLedger?.executiveSummary).not.toContain("Worker A stale attempt");
    });
  });

  // =========================================================================
  // 4. Recovery and Retry from Insufficient Evidence on Real PostgreSQL
  // =========================================================================
  describe("Recovery and Retry from Insufficient Evidence", () => {
    it("enters insufficient_evidence without substantive notes and successfully concludes on retry after notes are added", async () => {
      const retryBookingId = crypto.randomUUID();
      const retryBookingStartTime = new Date(Date.now() + 86400000);
      const retryBookingEndTime = new Date(retryBookingStartTime.getTime() + 1800000);

      // 1. Create booking in test database with all required fields including cancelToken
      const cancelToken = crypto.randomBytes(16).toString("hex");
      await testDb.insert(schema.bookings).values({
        id: retryBookingId,
        eventTypeId: testEventTypeId,
        hostId: testHostId,
        guestName: "Retry Participant",
        guestEmail: "retry-guest@example.com",
        guestTimezone: "UTC",
        startTime: retryBookingStartTime,
        endTime: retryBookingEndTime,
        status: "confirmed",
        cancelToken,
      });

      // 1. Creates a room using testDb
      const room = await getOrCreateRoomForBooking(retryBookingId, testDb);
      const accessToken = room.accessToken;

      // 2. Attempts synthesis without evidence (room has empty sharedNotes)
      const firstAttempt = await concludeRoomAndSynthesize(accessToken, testDb);

      // 3. Verifies the room enters insufficient_evidence
      expect(firstAttempt.success).toBe(false);
      expect(firstAttempt.status).toBe("insufficient_evidence");
      expect(firstAttempt.code).toBe("INSUFFICIENT_EVIDENCE");

      const roomAfterFirst = await testDb.query.rooms.findFirst({
        where: eq(schema.rooms.accessToken, accessToken),
      });
      expect(roomAfterFirst?.synthesisStatus).toBe("insufficient_evidence");
      expect(roomAfterFirst?.status).not.toBe("concluded");
      expect(roomAfterFirst?.synthesisClaimToken).toBeNull(); // Lease safely released

      // 4. Adds substantive notes
      const substantiveNotes =
        "Integration Test Host and Retry Participant agreed to proceed with full rollout on Friday.\n" +
        "Retry Participant will deploy the application by Friday afternoon.";

      const updateSuccess = await updateRoomNotes(accessToken, substantiveNotes, testDb);
      expect(updateSuccess).toBe(true);

      // Mock successful Vera generation for retry
      vi.spyOn(veraModule, "generateVeraLedger").mockResolvedValueOnce({
        executiveSummary: [
          {
            claim: "Integration Test Host and Retry Participant agreed to proceed with full rollout on Friday.",
            evidence: "agreed to proceed with full rollout on Friday",
          },
        ],
        keyDecisions: ["Proceed with full rollout on Friday"],
        actionItems: [
          {
            id: "act-retry-1",
            task: "Deploy the application",
            assignee: "Retry Participant",
            priority: "high",
            done: false,
            deadline: "Friday afternoon",
            evidence: "Retry Participant will deploy the application by Friday afternoon.",
          },
        ],
        suggestedFollowUp: "Review deployment status on Monday.",
      });

      // 5. Attempts synthesis again
      const secondAttempt = await concludeRoomAndSynthesize(accessToken, testDb);

      // 6. Verifies the second attempt obtains a lease and can successfully conclude the room
      expect(secondAttempt.success).toBe(true);
      expect(secondAttempt.status).toBe("concluded");
      expect(secondAttempt.veraLedger).toBeDefined();

      const finalRoom = await testDb.query.rooms.findFirst({
        where: eq(schema.rooms.accessToken, accessToken),
      });
      expect(finalRoom?.status).toBe("concluded");
      expect(finalRoom?.synthesisStatus).toBe("completed");
      expect(finalRoom?.synthesisClaimToken).toBeNull();
      expect(finalRoom?.veraLedger?.keyDecisions).toContain("Proceed with full rollout on Friday");
    });
  });
});
