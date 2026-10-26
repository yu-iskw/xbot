import { errorMessage } from "../errors";
import { deriveIdempotencyKey, occurrenceId } from "../research/idempotency";
import {
  DiscoveryResultSchema,
  type ResearchReport,
  type ResearchRun,
  type TriggerType,
} from "../schemas/research";
import type { CreateRunInput, XbotStore } from "../storage/store";
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

/** Insert a run, or return the run that already holds this occurrence's idempotency key. */
export function admitWorkflowRun(
  store: XbotStore,
  spec: {
    id: string;
    workflow: CreateRunInput["workflow"];
    workflowId: string;
    tenantId: string;
    topicId?: string;
    trigger: TriggerType;
    triggerEventId?: string;
    explicitKey?: string;
    input: unknown;
    keyInput: Record<string, unknown>;
    now: Date;
  },
) {
  const idempotencyKey = deriveIdempotencyKey({
    tenantId: spec.tenantId,
    workflow: spec.workflowId,
    input: spec.keyInput,
    triggerEventId: occurrenceId(spec.trigger, spec.triggerEventId, spec.now),
    explicitKey: spec.explicitKey,
  });
  return store.acquireRun({
    id: spec.id,
    workflow: spec.workflow,
    tenantId: spec.tenantId,
    ...(spec.topicId ? { topicId: spec.topicId } : {}),
    trigger: spec.trigger,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    input: spec.input,
    startedAt: spec.now.toISOString(),
  });
}

/** Workflow output for an occurrence that already finished. Throws when it is still running or has no report. */
export async function researchReplay(
  store: XbotStore,
  run: ResearchRun,
): Promise<{
  runId: string;
  runStatus: "completed";
  deduplicated: true;
  reportId: string;
  report: ResearchReport;
}> {
  const report = run.reportId ? await store.getReport(run.reportId, run.tenantId) : undefined;
  if (run.status === "running" || !report) {
    throw new Error(
      run.status === "running"
        ? `An identical research run (${run.id}) is already in progress`
        : `Research run ${run.id} produced no report`,
    );
  }
  return { runId: run.id, runStatus: "completed", deduplicated: true, reportId: report.id, report };
}

/** Stored discovery result for an occurrence that already finished. */
export function discoveryReplay(run: ResearchRun) {
  const prior = DiscoveryResultSchema.safeParse(run.output);
  if (!prior.success) {
    throw new Error(
      `An identical discovery run (${run.id}) is ${run.status === "running" ? "already in progress" : "without a result"}`,
    );
  }
  return { runId: run.id, deduplicated: true as const, runStatus: "completed" as const, result: prior.data };
}
