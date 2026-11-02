/**
 * Normalizes and compares two database URLs to detect if they point to the same database instance.
 * Handles variations in protocol, port, URL parameters, and Neon connection-pooler suffixes.
 */
export function isSameDatabase(url1?: string | null, url2?: string | null): boolean {
  if (!url1 || !url2) return false;
  try {
    const u1 = new URL(url1);
    const u2 = new URL(url2);

    // Normalize hostname: lowercase and strip neon -pooler suffix
    const host1 = u1.hostname.toLowerCase().replace(/-pooler(\.[^.]+)/, "$1");
    const host2 = u2.hostname.toLowerCase().replace(/-pooler(\.[^.]+)/, "$1");

    // Normalize port (default postgres 5432)
    const port1 = u1.port || "5432";
    const port2 = u2.port || "5432";

    // Normalize database name (strip leading slash)
    const db1 = u1.pathname.replace(/^\//, "").toLowerCase();
    const db2 = u2.pathname.replace(/^\//, "").toLowerCase();

    return host1 === host2 && port1 === port2 && db1 === db2;
  } catch {
    return url1.trim().toLowerCase() === url2.trim().toLowerCase();
  }
}
