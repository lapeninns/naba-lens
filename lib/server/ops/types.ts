import type { ApiError } from "@/lib/server/http/errors"
import type { Db } from "@/lib/server/media/types"

/** The caller-scoped client: every read and write runs as the signed-in person. */
export type OpsCaller = { db: Db }

export type OpsResult<T> = ({ ok: true } & T) | ApiError
