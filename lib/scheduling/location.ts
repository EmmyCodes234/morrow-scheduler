/**
 * Meeting Location Precedence Engine
 * 
 * Precedence Hierarchy:
 * 1. Explicit event-specific location configuration (when specified and not 'host_default')
 * 2. Host default when the event inherits its location
 * 3. Google Meet as the final fallback
 */

export interface LocationResolutionInput {
  eventType?: {
    locationType?: string | null;
    locationUrl?: string | null;
  } | null;
  host?: {
    defaultLocationType?: string | null;
    zoomMeetingUrl?: string | null;
    teamsMeetingUrl?: string | null;
  } | null;
}

export interface ResolvedLocation {
  locationType: "google_meet" | "zoom" | "teams" | "in_person" | "phone" | "custom";
  locationUrl?: string;
  source: "event" | "host" | "fallback";
}

export function resolveEffectiveLocation(input: LocationResolutionInput): ResolvedLocation {
  const eventLocType = input.eventType?.locationType?.trim();
  const eventLocUrl = input.eventType?.locationUrl?.trim();
  const hostLocType = input.host?.defaultLocationType?.trim();
  const hostZoomUrl = input.host?.zoomMeetingUrl?.trim();
  const hostTeamsUrl = input.host?.teamsMeetingUrl?.trim();

  // Tier 1: Explicit event-specific configuration
  if (eventLocType && eventLocType !== "host_default") {
    let finalUrl = eventLocUrl || undefined;
    if (eventLocType === "zoom" && !finalUrl && hostZoomUrl) {
      finalUrl = hostZoomUrl;
    }
    if (eventLocType === "teams" && !finalUrl && hostTeamsUrl) {
      finalUrl = hostTeamsUrl;
    }
    return {
      locationType: eventLocType as ResolvedLocation["locationType"],
      locationUrl: finalUrl,
      source: "event",
    };
  }

  // Tier 2: Host default when event inherits
  if (hostLocType && hostLocType.length > 0) {
    let finalUrl = eventLocUrl || undefined;
    if (hostLocType === "zoom" && !finalUrl && hostZoomUrl) {
      finalUrl = hostZoomUrl;
    }
    if (hostLocType === "teams" && !finalUrl && hostTeamsUrl) {
      finalUrl = hostTeamsUrl;
    }
    return {
      locationType: hostLocType as ResolvedLocation["locationType"],
      locationUrl: finalUrl,
      source: "host",
    };
  }

  // Tier 3: Final fallback to Google Meet
  return {
    locationType: "google_meet",
    locationUrl: undefined,
    source: "fallback",
  };
}
