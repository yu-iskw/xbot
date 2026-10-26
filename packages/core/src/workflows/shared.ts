import { errorMessage } from "../errors";
import type { XbotStore } from "../storage/store";
import type { BudgetedXReadClient } from "../x/budget";

/** Close the run's budget, mark it failed, and rethrow. Store errors never mask the original error. */
export async function failRun(
  deps: { x: BudgetedXReadClient; store: XbotStore; now: () => Date },
  runId: string,
  error: unknown,
): Promise<never> {
  deps.x.closeRun(runId);
  await deps.store
    .updateRun(runId, { status: "failed", error: errorMessage(error), completedAt: deps.now().toISOString() })
    .catch(() => undefined);
  throw error;
}
