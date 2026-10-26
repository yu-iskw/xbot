import { XApiError } from "./x/port";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * How a bounded collection loop should react to a failed query: stop gracefully (budget or rate
 * limit), abort the run (credentials), or record it and continue with the next query.
 */
export function classifyQueryError(
  error: unknown,
  stopOn: readonly XApiError["code"][],
): "stop" | "abort" | "skip" {
  if (!(error instanceof XApiError)) return "skip";
  if (stopOn.includes(error.code)) return "stop";
  if (error.code === "unauthorized" || error.code === "forbidden") return "abort";
  return "skip";
}
