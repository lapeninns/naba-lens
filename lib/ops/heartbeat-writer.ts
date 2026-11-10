import "server-only"

import { randomUUID } from "node:crypto"

import {
  jobRunArgs,
  type OpsJob,
  type OpsJobResult,
  type OpsJobRunArgs,
} from "@/lib/ops/heartbeats"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * public.ops_record_job_run (B10-m1): service role only. Typed here, like
 * lib/server/knowledge/rpc.ts, so it compiles before the function is in the
 * generated `lib/db/types.ts`.
 */
export type OpsRpcs = {
  ops_record_job_run: {
    args: OpsJobRunArgs
    returns: "recorded" | "replayed"
  }
}

type RpcResult = { data: unknown; error: unknown }
type RpcCall = PromiseLike<RpcResult> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResult>
}
type RpcClient = { rpc(fn: string, args: object): RpcCall }

/** One write attempt; a slow database never holds the route past this. */
export const RECEIPT_TIMEOUT_MS = 3_000

/** The only thing logged when a receipt is not stored. */
export const RECEIPT_FAILURE_CODE = "ops_receipt_not_recorded"

export type ReceiptStatus = "recorded" | "replayed" | "not_recorded"

export type JobRun = {
  readonly job: OpsJob
  /**
   * Appends the run's single terminal receipt. Never rejects, and only the
   * first call writes: the route's status and body never depend on it, and
   * the job is never started or retried from here. A function is evaluated
   * inside that isolation, so reading an unexpected report cannot fail the
   * route either.
   */
  finish(result: OpsJobResult | (() => OpsJobResult)): Promise<ReceiptStatus>
}

export type JobRunOptions = {
  now?: () => Date
  client?: () => RpcClient
  timeoutMs?: number
}

/**
 * Starts the receipt for one admitted invocation: call it only after the
 * route's own authorisation and configuration checks let the job run. The
 * run ID and start time are fixed here, so a replay of the same receipt is
 * harmless and a different one under the same ID is refused.
 */
export function startJobRun(job: OpsJob, options: JobRunOptions = {}): JobRun {
  const now = options.now ?? (() => new Date())
  const runId = randomUUID()
  const startedAt = now().toISOString()
  let finished: Promise<ReceiptStatus> | null = null
  return {
    job,
    finish(result) {
      finished ??= write(job, runId, startedAt, result, now, options).catch(
        () => "not_recorded" as const
      )
      return finished
    },
  }
}

async function write(
  job: OpsJob,
  runId: string,
  startedAt: string,
  report: OpsJobResult | (() => OpsJobResult),
  now: () => Date,
  options: JobRunOptions
): Promise<ReceiptStatus> {
  try {
    const result = typeof report === "function" ? report() : report
    // A wall clock that stepped back still finishes no earlier than it began.
    const end = now()
    const finishedAt =
      end.getTime() < Date.parse(startedAt) ? startedAt : end.toISOString()
    const args = jobRunArgs({ runId, job, startedAt, finishedAt, result })
    if (!args) return notRecorded(job)
    const client =
      options.client?.() ?? (createAdminClient() as unknown as RpcClient)
    const call = client.rpc("ops_record_job_run", args)
    const signal = AbortSignal.timeout(options.timeoutMs ?? RECEIPT_TIMEOUT_MS)
    // Aborting cancels the HTTP request; the race bounds the wait even if a
    // client ignores the signal.
    const { data, error } = await Promise.race([
      Promise.resolve(call.abortSignal ? call.abortSignal(signal) : call),
      new Promise<RpcResult>((resolve) =>
        signal.addEventListener(
          "abort",
          () => resolve({ data: null, error: "timeout" }),
          { once: true }
        )
      ),
    ])
    if (error || (data !== "recorded" && data !== "replayed"))
      return notRecorded(job)
    return data
  } catch {
    return notRecorded(job)
  }
}

/**
 * No exception, payload or credential is logged: the heartbeat metric shows
 * the missing receipt, and nothing synthesises one.
 */
function notRecorded(job: OpsJob): ReceiptStatus {
  console.error("ops job receipt not recorded", {
    job,
    code: RECEIPT_FAILURE_CODE,
  })
  return "not_recorded"
}
