import "server-only"

import type { DbError } from "@/lib/server/amenities/errors"
import type { Db } from "@/lib/server/media/types"

import type { DocumentRpcName, DocumentRpcs } from "./types"

type RpcClient = {
  rpc(fn: string, args: object): PromiseLike<{ data: unknown; error: DbError }>
}

export type DocumentRpcResponse<K extends DocumentRpcName> =
  | { data: DocumentRpcs[K]["returns"]; error: null }
  | { data: null; error: NonNullable<DbError> }

/**
 * Calls an evidence-document RPC. Typed from ./types until lib/db/types.ts
 * is regenerated with B05-m6.
 */
export async function documentRpc<K extends DocumentRpcName>(
  db: Db,
  fn: K,
  args: DocumentRpcs[K]["args"]
): Promise<DocumentRpcResponse<K>> {
  const { data, error } = await (db as unknown as RpcClient).rpc(fn, args)
  if (error) return { data: null, error }
  return { data: data as DocumentRpcs[K]["returns"], error: null }
}
