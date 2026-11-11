import "server-only"

import type { AmenityRpcName, AmenityRpcs } from "@/lib/amenities/contract"
import type {
  AmenityKeyedRpcName,
  AmenityKeyedRpcs,
} from "@/lib/knowledge/contract"
import type { MediaActor } from "@/lib/server/media/types"

import type { DbError } from "./errors"

type RpcClient = {
  rpc(fn: string, args: object): PromiseLike<{ data: unknown; error: DbError }>
}

export type RpcResponse<K extends AmenityRpcName> =
  | { data: AmenityRpcs[K]["returns"]; error: null }
  | { data: null; error: NonNullable<DbError> }

/**
 * Calls an amenity RPC as the caller (RLS and the database's role checks
 * apply). Argument and return types come from the contract, so this compiles
 * with or without the amenity functions in the generated `lib/db/types.ts`.
 */
export async function amenityRpc<K extends AmenityRpcName>(
  actor: MediaActor,
  fn: K,
  args: AmenityRpcs[K]["args"]
): Promise<RpcResponse<K>> {
  const client = actor.db as unknown as RpcClient
  const { data, error } = await client.rpc(fn, args)
  if (error) return { data: null, error }
  return { data: data as AmenityRpcs[K]["returns"], error: null }
}

export type KeyedRpcResponse<K extends AmenityKeyedRpcName> =
  | { data: AmenityKeyedRpcs[K]["returns"]; error: null }
  | { data: null; error: NonNullable<DbError> }

/** The keyed overload of a legacy check write (B02 R10), as the caller. */
export async function amenityKeyedRpc<K extends AmenityKeyedRpcName>(
  actor: MediaActor,
  fn: K,
  args: AmenityKeyedRpcs[K]["args"]
): Promise<KeyedRpcResponse<K>> {
  const client = actor.db as unknown as RpcClient
  const { data, error } = await client.rpc(fn, args)
  if (error) return { data: null, error }
  return { data: data as AmenityKeyedRpcs[K]["returns"], error: null }
}
