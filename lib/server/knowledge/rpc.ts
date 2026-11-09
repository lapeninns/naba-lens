import "server-only"

import type { KnowledgeRpcName, KnowledgeRpcs } from "@/lib/knowledge/contract"
import type { DbError } from "@/lib/server/amenities/errors"
import type { Db } from "@/lib/server/media/types"

type RpcResult = { data: unknown; error: DbError }
type RpcCall = PromiseLike<RpcResult> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResult>
}
type RpcClient = { rpc(fn: string, args: object): RpcCall }

export type KnowledgeRpcResponse<K extends KnowledgeRpcName> =
  | { data: KnowledgeRpcs[K]["returns"]; error: null }
  | { data: null; error: NonNullable<DbError> }

/**
 * Calls a knowledge RPC on `db`: the caller's client for every screen and
 * command (the database checks role and venue), the service client only for
 * the reader. Types come from lib/knowledge/contract, so this compiles before
 * the functions are in the generated `lib/db/types.ts`.
 */
export async function knowledgeRpc<K extends KnowledgeRpcName>(
  db: Db,
  fn: K,
  args: KnowledgeRpcs[K]["args"],
  options: { signal?: AbortSignal } = {}
): Promise<KnowledgeRpcResponse<K>> {
  const client = db as unknown as RpcClient
  const call = client.rpc(fn, args)
  // Aborting cancels the HTTP request to the API; it does not promise that a
  // statement already running in Postgres stops at once.
  const { data, error } = await (options.signal && call.abortSignal
    ? call.abortSignal(options.signal)
    : call)
  if (error) return { data: null, error }
  return { data: data as KnowledgeRpcs[K]["returns"], error: null }
}
