// Prints the resolved perf stack config (no connections, no secrets):
//   PERF_STACK=spare7 node tests/perf/stack-config.mjs [api-port|db-port|app-port|name]
import { perfStack } from "./lib.mjs"

const stack = perfStack()
const field = process.argv[2]
const keys = { "api-port": "apiPort", "db-port": "dbPort", "app-port": "appPort", name: "name" }
if (!field) console.log(JSON.stringify(stack, null, 2))
else if (keys[field]) console.log(stack[keys[field]])
else throw new Error(`Unknown field "${field}". Use ${Object.keys(keys).join(", ")}.`)
