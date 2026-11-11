import "server-only"

import type { DbError } from "@/lib/server/amenities/errors"
import type { Db } from "@/lib/server/media/types"

import type { UseRpcName, UseRpcs } from "./types"

type RpcClient = {
  rpc(fn: string, args: object): PromiseLike<{ data: unknown; error: DbError }>
}

export type MediaUseRpcResponse<K extends UseRpcName> =
  | { data: UseRpcs[K]["returns"]; error: null }
  | { data: null; error: NonNullable<DbError> }

/**
 * Calls a use-grant RPC as the caller (the database checks who may grant,
 * withdraw or read). Typed from ./types until lib/db/types.ts is regenerated.
 */
export async function mediaUseRpc<K extends UseRpcName>(
  db: Db,
  fn: K,
  args: UseRpcs[K]["args"]
): Promise<MediaUseRpcResponse<K>> {
  const { data, error } = await (db as unknown as RpcClient).rpc(fn, args)
  if (error) return { data: null, error }
  return { data: data as UseRpcs[K]["returns"], error: null }
}
