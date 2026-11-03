import fs from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
import { REQUIRED_BASELINE_SCHEMA, verifyBaselineSchema } from "../lib/database/schema-verifier.mjs";

dotenv.config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Error: DATABASE_URL is not set.");
  process.exit(1);
}

const sql = neon(connectionString);

async function runMigrations() {
  console.log("Starting safe database migration runner...");

  // 1. Ensure __drizzle_migrations tracking table exists
  await sql`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;

  const appliedRows = await sql`SELECT hash, created_at FROM "__drizzle_migrations"`;
  const appliedHashes = new Set(appliedRows.map((r) => r.hash));

  // 2. Safe Baseline Adoption for Pre-existing Databases:
  // If no migrations are recorded yet, check if the original baseline schema already exists
  if (appliedHashes.size === 0) {
    const requiredTables = Object.keys(REQUIRED_BASELINE_SCHEMA);

    const existingTablesResult = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name = ANY(${requiredTables})
    `;
    const foundTables = existingTablesResult.map((r) => r.table_name);

    const columnsResult = await sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY(${requiredTables})
    `;

    const foundColumnsByTable = {};
    for (const row of columnsResult) {
      if (!foundColumnsByTable[row.table_name]) {
        foundColumnsByTable[row.table_name] = [];
      }
      foundColumnsByTable[row.table_name].push(row.column_name);
    }

    const constraintsResult = await sql`
      SELECT 
        con.conname AS name,
        con.contype::text AS type,
        rel.relname AS table_name,
        pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
    `;

    const indexesResult = await sql`
      SELECT tablename AS table_name, indexname AS index_name, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
    `;

    const verification = verifyBaselineSchema({
      existingTables: foundTables,
      existingColumnsByTable: foundColumnsByTable,
      existingConstraints: constraintsResult,
      existingIndexes: indexesResult,
      stage: "0000_baseline",
    });

    if (verification.isFreshDatabase) {
      console.log("[i] Fresh database detected (no baseline tables found). Running migrations from scratch.");
    } else if (!verification.canAdoptBaseline) {
      console.error(`\n[FATAL] Incomplete or incompatible baseline schema detected:`);
      for (const err of verification.errors) {
        console.error(`  - ${err}`);
      }
      console.error(`Cannot adopt baseline safely. Please inspect the database.\n`);
      process.exit(1);
    } else {
      console.log(
        "[i] Detected complete, compatible pre-migration database with all 7 required baseline tables and verified columns."
      );
      console.log(
        "[i] Safely adopting 0000_massive_songbird as existing baseline without re-running destructive table creation."
      );

      await sql`
        INSERT INTO "__drizzle_migrations" (hash, created_at)
        VALUES ('0000_massive_songbird', ${Date.now()})
      `;
      appliedHashes.add("0000_massive_songbird");
    }
  }

  // 3. Read journal
  const journalPath = path.resolve(import.meta.dirname, "../drizzle/meta/_journal.json");
  if (!fs.existsSync(journalPath)) {
    console.error("Migration journal not found at:", journalPath);
    process.exit(1);
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
  const entries = journal.entries || [];

  for (const entry of entries) {
    const tag = entry.tag;
    if (appliedHashes.has(tag)) {
      console.log(`[✓] Migration already applied: ${tag}`);
      continue;
    }

    const sqlFilePath = path.resolve(import.meta.dirname, `../drizzle/${tag}.sql`);
    if (!fs.existsSync(sqlFilePath)) {
      console.error(`Migration file missing: ${sqlFilePath}`);
      process.exit(1);
    }

    console.log(`[→] Applying migration: ${tag}...`);
    const sqlContent = fs.readFileSync(sqlFilePath, "utf-8");
    const statements = sqlContent
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        await sql.query(stmt);
      } catch (err) {
        // Distinguish genuinely existing baseline objects from missing columns, invalid constraints, or permissions
        const errObj = err || {};
        const sqlCode = errObj.code || (errObj.cause && errObj.cause.code);

        // PostgreSQL error codes:
        // 42P07: duplicate_table / duplicate_relation
        // 42710: duplicate_object
        const isDuplicateObject = sqlCode === "42P07" || sqlCode === "42710";

        if (tag.startsWith("0000") && isDuplicateObject) {
          console.log(`    Note: baseline object already exists (SQLSTATE ${sqlCode}), skipping duplicate statement #${i + 1}.`);
          continue;
        }

        console.error(`\n[FATAL] Migration failed at statement #${i + 1} of ${tag}:`);
        console.error(`Statement: ${stmt.slice(0, 150)}...`);
        console.error(`Error Code: ${sqlCode || "UNKNOWN"}`);
        console.error(`Error Message: ${errObj.message || String(err)}\n`);
        throw err;
      }
    }

    await sql`
      INSERT INTO "__drizzle_migrations" (hash, created_at)
      VALUES (${tag}, ${Date.now()})
    `;
    console.log(`[✓] Successfully applied: ${tag}`);
  }

  console.log("All migrations successfully verified and up to date.");
}

runMigrations().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
