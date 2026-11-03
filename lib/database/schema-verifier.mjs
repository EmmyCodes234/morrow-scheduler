/**
 * Comprehensive Baseline Schema Verification Engine for Morrow Scheduler.
 *
 * Verifies that an existing database contains the complete, required baseline schema
 * (tables, columns, unique protections, foreign keys, and indexes) before adopting
 * the 0000 baseline migration.
 *
 * Migration Stage Aware:
 * - When validating for 0000 baseline adoption, does NOT require objects introduced
 *   in subsequent migrations (such as the Phase 1.2 exclusion constraint predicate or
 *   Phase 1.3 outbox columns).
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
    "created_at",
    "updated_at",
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
    "min_notice_hours",
    "requires_approval",
    "created_at",
    "updated_at",
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
    "created_at",
    "updated_at",
  ],
  availability: [
    "id",
    "user_id",
    "day_of_week",
    "start_time",
    "end_time",
    "is_enabled",
    "created_at",
    "updated_at",
  ],
  availability_overrides: [
    "id",
    "user_id",
    "date",
    "is_blocked",
    "created_at",
  ],
  contacts: [
    "id",
    "user_id",
    "email",
    "name",
    "total_bookings",
    "created_at",
    "updated_at",
  ],
  verification_tokens: [
    "id",
    "email",
    "token",
    "expires_at",
    "created_at",
  ],
};

export const EXPECTED_BASELINE_FOREIGN_KEYS = [
  { table: "event_types", column: "user_id", foreignTable: "users", foreignColumn: "id" },
  { table: "availability", column: "user_id", foreignTable: "users", foreignColumn: "id" },
  { table: "availability_overrides", column: "user_id", foreignTable: "users", foreignColumn: "id" },
  { table: "bookings", column: "event_type_id", foreignTable: "event_types", foreignColumn: "id" },
  { table: "bookings", column: "host_id", foreignTable: "users", foreignColumn: "id" },
  { table: "contacts", column: "user_id", foreignTable: "users", foreignColumn: "id" },
];

export const EXPECTED_BASELINE_UNIQUE_PROTECTIONS = [
  { table: "users", columns: ["email"], description: "users email uniqueness" },
  { table: "users", columns: ["slug"], description: "users slug uniqueness" },
  { table: "event_types", columns: ["user_id", "slug"], description: "event_types host/slug uniqueness" },
  { table: "bookings", columns: ["cancel_token"], description: "bookings cancel_token uniqueness" },
  { table: "contacts", columns: ["user_id", "email"], description: "contacts host/email uniqueness" },
];

export const EXPECTED_BASELINE_INDEXES = [
  { table: "availability", column: "user_id" },
  { table: "bookings", column: "host_id" },
  { table: "bookings", column: "status" },
  { table: "bookings", column: "start_time" },
  { table: "contacts", column: "user_id" },
  { table: "event_types", column: "user_id" },
];

/**
 * Validates baseline database schema components.
 * 
 * Supports both options object and positional parameter signatures:
 * - verifyBaselineSchema({ existingTables, existingColumnsByTable, existingConstraints, existingIndexes, stage })
 * - verifyBaselineSchema(existingTables, existingColumnsByTable, options)
 */
export function verifyBaselineSchema(arg1, arg2, arg3) {
  let existingTables = [];
  let existingColumnsByTable = {};
  let existingConstraints = [];
  let existingIndexes = [];
  let stage = "0000_baseline";

  if (Array.isArray(arg1)) {
    existingTables = arg1;
    existingColumnsByTable = arg2 || {};
    const opts = arg3 || {};
    existingConstraints = opts.existingConstraints || [];
    existingIndexes = opts.existingIndexes || [];
    stage = opts.stage || "0000_baseline";
  } else if (arg1 && typeof arg1 === "object") {
    existingTables = arg1.existingTables || [];
    existingColumnsByTable = arg1.existingColumnsByTable || {};
    existingConstraints = arg1.existingConstraints || [];
    existingIndexes = arg1.existingIndexes || [];
    stage = arg1.stage || "0000_baseline";
  }

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
      missingUniqueConstraints: [],
      missingForeignKeys: [],
      missingIndexes: [],
      errors: [],
    };
  }

  const missingTables = [];
  const missingColumns = [];
  const missingUniqueConstraints = [];
  const missingForeignKeys = [];
  const missingIndexes = [];
  const errors = [];

  // 2. Check for missing required tables
  for (const table of requiredTables) {
    if (!foundTableSet.has(table)) {
      missingTables.push(table);
      errors.push(`Missing required baseline table: ${table}`);
    }
  }

  // 3. Check for missing essential columns across all present required tables
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

  // 4. Check Unique Protections (if constraints/indexes catalog provided)
  const hasConstraintData = Array.isArray(existingConstraints) && existingConstraints.length > 0;
  const hasIndexData = Array.isArray(existingIndexes) && existingIndexes.length > 0;

  if (hasConstraintData || hasIndexData) {
    for (const reqUnique of EXPECTED_BASELINE_UNIQUE_PROTECTIONS) {
      if (!foundTableSet.has(reqUnique.table)) continue;

      let satisfied = false;

      // Check unique constraints (type 'u' or definition matching columns)
      if (hasConstraintData) {
        satisfied = existingConstraints.some((c) => {
          if (c.table_name?.toLowerCase() !== reqUnique.table.toLowerCase()) return false;
          const def = (c.def || "").toLowerCase();
          const isUnique = c.type === "u" || def.includes("unique");
          if (!isUnique) return false;

          return reqUnique.columns.every((col) => def.includes(col.toLowerCase()));
        });
      }

      // Check unique indexes (pg_indexes indexdef)
      if (!satisfied && hasIndexData) {
        satisfied = existingIndexes.some((idx) => {
          const tableName = (idx.tablename || idx.table_name || "").toLowerCase();
          if (tableName !== reqUnique.table.toLowerCase()) return false;
          const def = (idx.indexdef || "").toLowerCase();
          const isUnique = def.startsWith("create unique index") || Boolean(idx.is_unique);
          if (!isUnique) return false;

          return reqUnique.columns.every((col) => def.includes(col.toLowerCase()));
        });
      }

      if (!satisfied) {
        const uRef = `${reqUnique.table}(${reqUnique.columns.join(", ")})`;
        missingUniqueConstraints.push(uRef);
        errors.push(`Missing unique protection: ${uRef} - ${reqUnique.description}`);
      }
    }

    // Check booking idempotency uniqueness (accounting for evolution across migrations)
    if (foundTableSet.has("bookings")) {
      const hasIdempotencyUnique =
        (hasConstraintData &&
          existingConstraints.some(
            (c) =>
              c.table_name?.toLowerCase() === "bookings" &&
              (c.def || "").toLowerCase().includes("idempotency_key")
          )) ||
        (hasIndexData &&
          existingIndexes.some((idx) => {
            const t = (idx.tablename || idx.table_name || "").toLowerCase();
            const d = (idx.indexdef || "").toLowerCase();
            return (
              t === "bookings" &&
              d.includes("unique") &&
              d.includes("idempotency_key")
            );
          }));

      if (!hasIdempotencyUnique) {
        const idempRef = "bookings(idempotency_key)";
        missingUniqueConstraints.push(idempRef);
        errors.push(`Missing unique protection: ${idempRef} - booking idempotency uniqueness`);
      }
    }
  }

  // 5. Check Foreign Keys (if constraints catalog provided)
  if (hasConstraintData) {
    for (const reqFk of EXPECTED_BASELINE_FOREIGN_KEYS) {
      if (!foundTableSet.has(reqFk.table)) continue;

      const fkFound = existingConstraints.some((c) => {
        if (c.table_name?.toLowerCase() !== reqFk.table.toLowerCase()) return false;
        const isFk = c.type === "f" || (c.def || "").toLowerCase().includes("foreign key");
        if (!isFk) return false;

        const def = (c.def || "").toLowerCase();
        return (
          def.includes(reqFk.column.toLowerCase()) &&
          def.includes(reqFk.foreignTable.toLowerCase()) &&
          def.includes(reqFk.foreignColumn.toLowerCase())
        );
      });

      if (!fkFound) {
        const fkRef = `${reqFk.table}.${reqFk.column} -> ${reqFk.foreignTable}.${reqFk.foreignColumn}`;
        missingForeignKeys.push(fkRef);
        errors.push(`Missing foreign key relationship: ${fkRef}`);
      }
    }
  }

  // 6. Check Important Indexes (if indexes catalog provided)
  if (hasIndexData) {
    for (const reqIdx of EXPECTED_BASELINE_INDEXES) {
      if (!foundTableSet.has(reqIdx.table)) continue;

      const idxFound = existingIndexes.some((idx) => {
        const tableName = (idx.tablename || idx.table_name || "").toLowerCase();
        if (tableName !== reqIdx.table.toLowerCase()) return false;
        const def = (idx.indexdef || "").toLowerCase();
        return def.includes(reqIdx.column.toLowerCase());
      });

      if (!idxFound) {
        const idxRef = `${reqIdx.table}(${reqIdx.column})`;
        missingIndexes.push(idxRef);
        errors.push(`Missing required index on lookup path: ${idxRef}`);
      }
    }
  }

  // 7. Migration Stage Awareness:
  // For stage === "0000_baseline", we do NOT require the Phase 1.2 exclusion constraint
  // (which excludes both cancelled and rejected). A baseline database being adopted
  // will safely receive 0001 and 0002.
  if (stage === "latest" && hasConstraintData) {
    const hasFinalExclusion = existingConstraints.some((c) => {
      if (c.table_name?.toLowerCase() !== "bookings") return false;
      const def = (c.def || "").toLowerCase();
      return (
        c.type === "x" &&
        def.includes("exclude using gist") &&
        def.includes("cancelled") &&
        def.includes("rejected")
      );
    });

    if (!hasFinalExclusion) {
      errors.push("Missing Phase 1.2 final exclusion constraint on bookings excluding cancelled and rejected.");
    }
  }

  const canAdoptBaseline = errors.length === 0;

  return {
    canAdoptBaseline,
    isFreshDatabase: false,
    missingTables,
    missingColumns,
    missingUniqueConstraints,
    missingForeignKeys,
    missingIndexes,
    errors,
  };
}
