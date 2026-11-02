import { NextRequest } from "next/server";

export type ParseJsonResult<T = Record<string, unknown>> =
  | { success: true; data: T }
  | { success: false; error: string; status: 400; errorCode: string };

/**
 * Safely parses request body JSON:
 * - Catches JSON syntax errors separately and returns HTTP 400.
 * - Rejects null, arrays, and non-object top-level payloads with HTTP 400.
 * - Ensures downstream handlers receive a non-null JSON object.
 */
export async function parseJsonRequest<T = Record<string, unknown>>(
  req: NextRequest
): Promise<ParseJsonResult<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      success: false,
      error: "Malformed JSON payload in request body.",
      status: 400,
      errorCode: "INVALID_JSON",
    };
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      success: false,
      error: "Request body must be a non-null JSON object.",
      status: 400,
      errorCode: "INVALID_PAYLOAD",
    };
  }

  return { success: true, data: raw as T };
}
