import { handleAnswersRequest } from "@/app/api/knowledge/_reader/handler"

// The reader answers within its own 5 s bound; this only caps a stuck call.
export const maxDuration = 15

type Context = { params: Promise<{ venueId: string }> }

/**
 * GET /api/knowledge/v1/venues/{venueId}/answers: the internal reader
 * (docs/knowledge/internal-reader-api.md). Server-to-server only, with a
 * consumer credential; never a session. Every method goes to the same handler
 * so a refused method gets the reader's own JSON 405.
 */
async function answers(request: Request, { params }: Context) {
  const { venueId } = await params
  return handleAnswersRequest(request, venueId)
}

export const GET = answers
export const HEAD = answers
export const POST = answers
export const PUT = answers
export const PATCH = answers
export const DELETE = answers
export const OPTIONS = answers
