import "server-only"

import type { DbError } from "@/lib/server/amenities/errors"
import type { Db } from "@/lib/server/media/types"

import type { SearchRpcName, SearchRpcs } from "./types"

type RpcClient = {
  rpc(fn: string, args: object): PromiseLike<{ data: unknown; error: DbError }>
}

export type SearchRpcResponse<K extends SearchRpcName> =
  | { data: SearchRpcs[K]["returns"]; error: null }
  | { data: null; error: NonNullable<DbError> }

/**
 * Calls an asset-search RPC as the caller (the database decides who may
 * search and what they find). Typed from ./types until lib/db/types.ts is
 * regenerated.
 */
export async function searchRpc<K extends SearchRpcName>(
  db: Db,
  fn: K,
  args: SearchRpcs[K]["args"]
): Promise<SearchRpcResponse<K>> {
  const { data, error } = await (db as unknown as RpcClient).rpc(fn, args)
  if (error) return { data: null, error }
  return { data: data as SearchRpcs[K]["returns"], error: null }
}
