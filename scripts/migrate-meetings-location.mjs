import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";

dotenv.config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);

async function run() {
  console.log("Checking columns on 'meetings' table...");
  const cols = await sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'meetings'
  `;
  const existingCols = cols.map((c) => c.column_name);
  console.log("Existing columns on 'meetings':", existingCols);

  if (!existingCols.includes("location_type")) {
    console.log("Adding location_type column...");
    await sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS location_type text DEFAULT 'google_meet'`;
  }

  if (!existingCols.includes("location_url")) {
    console.log("Adding location_url column...");
    await sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS location_url text`;
  }

  console.log("Migration complete.");
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
