import type { Instrumentation } from "next"

function enabled() {
  return (
    process.env.NEXT_RUNTIME === "nodejs" &&
    Boolean(process.env.SENTRY_DSN?.trim())
  )
}

export async function register() {
  if (enabled()) await (await import("./lib/server/log/sentry")).init()
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  if (!enabled()) return
  await (
    await import("./lib/server/log/sentry")
  ).capture(error, request, context)
}
