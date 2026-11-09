import { handleMetaRequest } from "@/app/api/knowledge/_reader/handler"

export const maxDuration = 15

/**
 * GET /api/knowledge/v1/meta: what the calling consumer's credential may read
 * (docs/knowledge/internal-reader-api.md). Every method goes to the same
 * handler so a refused method gets the reader's own JSON 405.
 */
async function meta(request: Request) {
  return handleMetaRequest(request)
}

export const GET = meta
export const HEAD = meta
export const POST = meta
export const PUT = meta
export const PATCH = meta
export const DELETE = meta
export const OPTIONS = meta
