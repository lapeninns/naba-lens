/**
 * Explicit Node server entrypoints (operator CLI and fixture runner) execute
 * server modules outside Next's compiler. Select server-only's published server
 * export for those processes, without changing React's resolution conditions or
 * propagating NODE_OPTIONS into the Next server/browser build.
 *
 * Application modules must never import this bootstrap: their server-only
 * markers remain enforced by Next and by an ordinary unbootstrapped Node import.
 */
import { registerHooks } from "node:module"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "server-only") return nextResolve(specifier, context)
    return nextResolve(specifier, {
      ...context,
      conditions: [...context.conditions, "react-server"],
    })
  },
})
