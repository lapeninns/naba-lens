import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../../../lib/db/types"

import type { TestClock } from "./clock"

export type Row = Record<string, unknown>
export type DbError = { code?: string; message: string }

export type Operation =
  | {
      kind: "select" | "insert" | "upsert" | "update" | "delete"
      table: string
      patch?: Row
      rows?: Row[]
    }
  | { kind: "rpc"; name: string; args: Row }

export type WriteLogEntry = {
  seq: number
  at: number
  op: Operation
  /** Lease holder at the time of the write, when the lease named below exists. */
  leaseHolder?: string
}

/** A client handle that can be "killed": later operations never settle (process death). */
export type ClientContext = { dead: boolean }

export type DbFault = {
  match: (op: Operation) => boolean
  after?: number
  times?: number
  /** Resolve with this error instead of applying the operation. */
  error?: DbError
  /** Throw (e.g. to simulate a crash) instead of returning. */
  crash?: Error
  /** Run before the operation is applied; may mutate the world (steal a lease, advance time). */
  before?: (op: Operation) => void | Promise<void>
  /** Run after the operation was applied but before its result is returned. */
  afterApply?: (op: Operation) => void | Promise<void>
}

type TableConfig = {
  /** Auto-increment column, as `generated always as identity`. */
  identity?: string
  /** Column sets that conflict on upsert/insert. */
  unique?: string[][]
  /**
   * Reject update/delete like an append-only trigger or missing grant.
   * `"no-update"` rejects only updates (deletes of old rows stay possible).
   */
  appendOnly?: boolean | "no-update"
  defaults?: Row
}

type Lease = { holder: string; expiresAt: number }

const LEASE_NAME = "media_archive_audit"

/**
 * Minimal in-memory stand-in for the PostgREST/Supabase surface the archive
 * code uses. It models semantics that matter to the contract (lease TTL on the
 * test clock, append-only tables, identity ids, projection, upsert conflict
 * handling) and nothing more. RPCs are pluggable so new ones can be added
 * without changing the engine.
 */
export class FakeDb {
  tables: Record<string, Row[]> = {}
  configs: Record<string, TableConfig> = {}
  rpcs: Record<string, (args: Row, db: FakeDb) => unknown> = {}
  leases = new Map<string, Lease>()
  writeLog: WriteLogEntry[] = []
  rpcLog: {
    seq: number
    at: number
    name: string
    args: Row
    result: unknown
  }[] = []
  private faults: { fault: DbFault; seen: number; applied: number }[] = []
  private ids: Record<string, number> = {}
  private seq = 0

  constructor(readonly clock: TestClock) {
    this.rpcs.acquire_maintenance_lease = (args) => this.acquire(args)
    this.rpcs.release_maintenance_lease = (args) => this.release(args)
  }

  define(table: string, config: TableConfig = {}, rows: Row[] = []) {
    this.tables[table] = rows
    this.configs[table] = config
    return this
  }

  rows(table: string) {
    return this.tables[table] ?? (this.tables[table] = [])
  }

  inject(fault: DbFault) {
    const entry = { fault, seen: 0, applied: 0 }
    this.faults.push(entry)
    return () => {
      this.faults = this.faults.filter((candidate) => candidate !== entry)
    }
  }

  clearFaults() {
    this.faults = []
  }

  get client() {
    return this.makeClient({
      dead: false,
    }) as unknown as SupabaseClient<Database>
  }

  /**
   * A client whose process can be killed at any point. After `kill()` no
   * operation from it is applied or returns, and no `finally` cleanup runs
   * (the lease is left to expire), which is what a crashed function leaves.
   */
  killable() {
    const context: ClientContext = { dead: false }
    return {
      client: this.makeClient(context) as unknown as SupabaseClient<Database>,
      kill: () => {
        context.dead = true
      },
      get dead() {
        return context.dead
      },
    }
  }

  // ---- leases (mirrors private.maintenance_leases + the two RPCs) ----

  private ttlMs(ttl: unknown) {
    const match = /^(\d+)\s*(second|minute|hour)s?$/.exec(String(ttl))
    if (!match) throw new Error(`unsupported interval in fake: ${String(ttl)}`)
    return (
      Number(match[1]) *
      { second: 1e3, minute: 6e4, hour: 36e5 }[match[2] as "second"]
    )
  }

  private acquire(args: Row) {
    const name = String(args.p_name)
    const holder = String(args.p_holder)
    const now = this.clock.now()
    const lease = this.leases.get(name)
    // Same SQL: free, expired, or already ours (renewal) acquires.
    if (!lease || lease.expiresAt <= now || lease.holder === holder) {
      this.leases.set(name, { holder, expiresAt: now + this.ttlMs(args.p_ttl) })
      return true
    }
    return false
  }

  private release(args: Row) {
    const name = String(args.p_name)
    if (this.leases.get(name)?.holder === String(args.p_holder))
      this.leases.delete(name)
    return null
  }

  /** Another worker takes the lease over (as after an expiry while this run hung). */
  stealLease(
    holder = "00000000-0000-4000-8000-000000000bad",
    name = LEASE_NAME
  ) {
    this.leases.set(name, { holder, expiresAt: this.clock.now() + 600_000 })
  }

  expireLease(name = LEASE_NAME) {
    const lease = this.leases.get(name)
    if (lease) lease.expiresAt = this.clock.now()
  }

  holdLease(holder: string, ttlMs = 600_000, name = LEASE_NAME) {
    this.leases.set(name, { holder, expiresAt: this.clock.now() + ttlMs })
  }

  // ---- engine ----

  nextId(table: string) {
    return (this.ids[table] = (this.ids[table] ?? 0) + 1)
  }

  private async gate(op: Operation, context: ClientContext) {
    if (context.dead) await never()
    for (const entry of [...this.faults]) {
      const { fault } = entry
      if (!fault.match(op)) continue
      entry.seen++
      if (entry.seen <= (fault.after ?? 0)) continue
      if (entry.applied >= (fault.times ?? Infinity)) continue
      entry.applied++
      await fault.before?.(op)
      if (context.dead) await never()
      if (fault.crash) throw fault.crash
      if (fault.error) return { error: fault.error, afterApply: undefined }
      return { error: undefined, afterApply: fault.afterApply }
    }
    return { error: undefined, afterApply: undefined }
  }

  private log(op: Operation) {
    this.writeLog.push({
      seq: this.seq++,
      at: this.clock.now(),
      op,
      leaseHolder: this.leases.get(LEASE_NAME)?.holder,
    })
  }

  private makeClient(context: ClientContext) {
    return {
      rpc: (name: string, args: Row = {}) =>
        thenable(async () => {
          const op: Operation = { kind: "rpc", name, args }
          const gated = await this.gate(op, context)
          if (gated.error) return { data: null, error: gated.error }
          const handler = this.rpcs[name]
          if (!handler)
            return {
              data: null,
              error: { code: "PGRST202", message: `no such function ${name}` },
            }
          this.log(op)
          let data: unknown
          try {
            data = await handler(args, this)
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            const code = (error as { code?: string }).code
            return { data: null, error: { code, message } }
          }
          this.rpcLog.push({
            seq: this.seq,
            at: this.clock.now(),
            name,
            args,
            result: data,
          })
          await gated.afterApply?.(op)
          if (context.dead) await never()
          return { data, error: null }
        }),
      from: (table: string) => new Query(this, table, context),
    }
  }

  /** @internal used by Query */
  async execute(
    table: string,
    state: QueryState,
    context: ClientContext
  ): Promise<{ data: unknown; error: DbError | null }> {
    const config = this.configs[table]
    const all = this.rows(table)
    if (!config)
      return {
        data: null,
        error: { code: "42P01", message: `no table ${table}` },
      }
    const matching = () =>
      all.filter((row) => state.filters.every((f) => f(row)))
    const op: Operation = {
      kind: state.mode,
      table,
      patch: state.patch,
      rows: state.rows,
    }
    const gated = await this.gate(op, context)
    if (gated.error) return { data: null, error: gated.error }
    let result: Row[]
    if (state.mode === "select") {
      result = matching()
    } else {
      this.log(op)
      if (state.mode === "insert" || state.mode === "upsert") {
        result = []
        for (const input of state.rows ?? []) {
          const row: Row = { ...config.defaults, ...input }
          if (config.identity && row[config.identity] === undefined)
            row[config.identity] = this.nextId(table)
          const conflict = all.find((existing) =>
            (config.unique ?? []).some((columns) =>
              columns.every((column) => existing[column] === row[column])
            )
          )
          if (conflict) {
            if (state.mode === "upsert" && state.ignoreDuplicates) continue
            if (state.mode === "upsert") {
              Object.assign(conflict, row)
              result.push(conflict)
              continue
            }
            return {
              data: null,
              error: { code: "23505", message: "duplicate key value" },
            }
          }
          all.push(row)
          result.push(row)
        }
      } else {
        if (
          config.appendOnly === true ||
          (config.appendOnly === "no-update" && state.mode === "update")
        )
          return {
            data: null,
            error: { code: "42501", message: "permission denied" },
          }
        result = matching()
        if (state.mode === "update")
          for (const row of result) Object.assign(row, state.patch)
        else for (const row of result) all.splice(all.indexOf(row), 1)
      }
    }
    await gated.afterApply?.(op)
    if (context.dead) await never()
    return finish(result, state)
  }
}

type QueryState = {
  mode: "select" | "insert" | "upsert" | "update" | "delete"
  columns: string
  filters: ((row: Row) => boolean)[]
  orderBy: { column: string; ascending: boolean }[]
  limit?: number
  rows?: Row[]
  patch?: Row
  ignoreDuplicates?: boolean
  wantRows: boolean
  count?: boolean
  head?: boolean
  single: "one" | "maybe" | null
}

function finish(rows: Row[], state: QueryState) {
  if (state.head)
    return { data: null, count: state.count ? rows.length : null, error: null }
  const total = rows.length
  let out = rows.map((row) => ({ ...row }))
  for (const { column, ascending } of [...state.orderBy].reverse())
    out.sort((a, b) => {
      const left = a[column] as number | string
      const right = b[column] as number | string
      return (left < right ? -1 : left > right ? 1 : 0) * (ascending ? 1 : -1)
    })
  if (state.limit !== undefined) out = out.slice(0, state.limit)
  if (state.mode === "select" || state.wantRows) {
    const columns =
      state.columns === "*"
        ? null
        : state.columns.split(",").map((column) => column.trim())
    if (columns)
      out = out.map((row) =>
        Object.fromEntries(columns.map((column) => [column, row[column]]))
      )
  } else {
    return { data: null, error: null }
  }
  if (state.single) {
    if (out.length === 1) return { data: out[0], error: null }
    if (out.length === 0 && state.single === "maybe")
      return { data: null, error: null }
    return {
      data: null,
      error: {
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
      },
    }
  }
  return { data: out, count: state.count ? total : null, error: null }
}

class Query implements PromiseLike<unknown> {
  private state: QueryState = {
    mode: "select",
    columns: "*",
    filters: [],
    orderBy: [],
    wantRows: false,
    single: null,
  }
  constructor(
    private db: FakeDb,
    private table: string,
    private context: ClientContext
  ) {}

  select(columns = "*", options: { count?: string; head?: boolean } = {}) {
    if (this.state.mode !== "select") this.state.wantRows = true
    this.state.columns = columns
    this.state.count = options.count === "exact"
    this.state.head = options.head
    return this
  }
  insert(rows: Row | Row[]) {
    this.state.mode = "insert"
    this.state.rows = [rows].flat()
    return this
  }
  upsert(rows: Row | Row[], options: { ignoreDuplicates?: boolean } = {}) {
    this.state.mode = "upsert"
    this.state.rows = [rows].flat()
    this.state.ignoreDuplicates = options.ignoreDuplicates
    return this
  }
  update(patch: Row) {
    this.state.mode = "update"
    this.state.patch = patch
    return this
  }
  delete() {
    this.state.mode = "delete"
    return this
  }
  eq(column: string, value: unknown) {
    this.state.filters.push((row) => row[column] === value)
    return this
  }
  neq(column: string, value: unknown) {
    this.state.filters.push((row) => row[column] !== value)
    return this
  }
  gt(column: string, value: unknown) {
    this.state.filters.push(
      (row) => (row[column] as number) > (value as number)
    )
    return this
  }
  gte(column: string, value: unknown) {
    this.state.filters.push(
      (row) => (row[column] as number) >= (value as number)
    )
    return this
  }
  lt(column: string, value: unknown) {
    this.state.filters.push(
      (row) => (row[column] as number) < (value as number)
    )
    return this
  }
  lte(column: string, value: unknown) {
    this.state.filters.push(
      (row) => (row[column] as number) <= (value as number)
    )
    return this
  }
  in(column: string, values: unknown[]) {
    this.state.filters.push((row) => values.includes(row[column]))
    return this
  }
  is(column: string, value: unknown) {
    this.state.filters.push((row) => (row[column] ?? null) === value)
    return this
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.state.orderBy.push({ column, ascending: options.ascending ?? true })
    return this
  }
  limit(count: number) {
    this.state.limit = count
    return this
  }
  single() {
    this.state.single = "one"
    return this
  }
  maybeSingle() {
    this.state.single = "maybe"
    return this
  }
  then<A, B>(
    onfulfilled?: ((value: unknown) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ) {
    return this.db
      .execute(this.table, this.state, this.context)
      .then(onfulfilled, onrejected)
  }
}

function thenable<T>(run: () => Promise<T>): PromiseLike<T> {
  return {
    then: (onfulfilled, onrejected) => run().then(onfulfilled, onrejected),
  }
}

const never = () => new Promise<never>(() => undefined)
