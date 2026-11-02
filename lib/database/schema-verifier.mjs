/**
 * Pure Baseline Schema Verification Engine for Morrow Scheduler.
 *
 * Verifies that an existing database contains the complete, required baseline schema
 * (all 7 core tables and their critical application columns) before adopting the 0000 baseline.
 */

export const REQUIRED_BASELINE_SCHEMA = {
  users: [
    "id",
    "name",
    "email",
    "slug",
    "timezone",
    "buffer_mins",
    "min_notice_hours",
    "max_booking_days",
  ],
  event_types: [
    "id",
    "user_id",
    "title",
    "slug",
    "duration_mins",
    "location_type",
    "is_active",
    "buffer_before_mins",
    "buffer_after_mins",
    "requires_approval",
  ],
  bookings: [
    "id",
    "event_type_id",
    "host_id",
    "guest_name",
    "guest_email",
    "start_time",
    "end_time",
    "buffer_start_time",
    "buffer_end_time",
    "status",
    "cancel_token",
    "guest_timezone",
  ],
  availability: [
    "id",
    "user_id",
    "day_of_week",
    "start_time",
    "end_time",
    "is_enabled",
  ],
  availability_overrides: [
    "id",
    "user_id",
    "date",
    "is_blocked",
  ],
  contacts: [
    "id",
    "user_id",
    "email",
    "name",
    "total_bookings",
  ],
  verification_tokens: [
    "id",
    "email",
    "token",
    "expires_at",
  ],
};

/**
 * Validates tables and columns against the required baseline schema.
 * @param {string[]} existingTables
 * @param {Record<string, string[]>} existingColumnsByTable
 * @returns {{ canAdoptBaseline: boolean, isFreshDatabase: boolean, missingTables: string[], missingColumns: string[], errors: string[] }}
 */
export function verifyBaselineSchema(existingTables, existingColumnsByTable) {
  const requiredTables = Object.keys(REQUIRED_BASELINE_SCHEMA);
  const foundTableSet = new Set((existingTables || []).map((t) => t.toLowerCase()));

  // 1. Check if fresh database (none of the required baseline tables exist)
  const matchingRequiredTables = requiredTables.filter((t) => foundTableSet.has(t));
  if (matchingRequiredTables.length === 0) {
    return {
      canAdoptBaseline: false,
      isFreshDatabase: true,
      missingTables: [],
      missingColumns: [],
      errors: [],
    };
  }

  // 2. Check for missing required tables
  const missingTables = requiredTables.filter((t) => !foundTableSet.has(t));
  const missingColumns = [];
  const errors = [];

  if (missingTables.length > 0) {
    errors.push(`Missing required baseline tables: ${missingTables.join(", ")}`);
  }

  // 3. Check for missing required columns across all present required tables
  for (const [table, reqCols] of Object.entries(REQUIRED_BASELINE_SCHEMA)) {
    if (foundTableSet.has(table)) {
      const foundCols = new Set(
        (existingColumnsByTable[table] || []).map((c) => c.toLowerCase())
      );
      for (const col of reqCols) {
        if (!foundCols.has(col.toLowerCase())) {
          const colRef = `${table}.${col}`;
          missingColumns.push(colRef);
          errors.push(`Missing essential column: ${colRef}`);
        }
      }
    }
  }

  const canAdoptBaseline = missingTables.length === 0 && missingColumns.length === 0;

  return {
    canAdoptBaseline,
    isFreshDatabase: false,
    missingTables,
    missingColumns,
    errors,
  };
}
