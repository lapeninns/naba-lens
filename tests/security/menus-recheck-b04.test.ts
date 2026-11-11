// B04-d database contract (b04-design §7.5, §13.2 C-B04-2, §18 L5, §18.1;
// b05-design §4.10): declared material changes, the five declared photo
// recheck kinds and the re-created activation-time reconciliation, on the
// shared fixture fx_menu_recheck_public_withdrawal
// (tests/fixtures/menus/recheck-public-withdrawal; WS3's half of
// manifest.json is asserted here, WS4 asserts deliveries from the same file).
//
// Every scenario loads the fixture with psql (postgres, local only) in one
// session and one transaction that always rolls back, so nothing is left on
// the stack; the fixture's menus, labels, reviews and activations run as the
// signed-in actors through the RPCs. The SQL lives in menus-recheck-fixtures.ts.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { beforeAll, describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import {
  FIXTURE_DIR,
  checkpoints,
  closedMonthScript,
  commandsScript,
  fixtureScript,
  scopeScript,
} from "./menus-recheck-fixtures"

const CREDIT_MD5 = "b78b9daeb8ede1fec0b7224d99348659"

type Manifest = {
  fixture: string
  items: {
    key: string
    change: string
    photoState: string
    recheckKind: string | null
  }[]
  reaccept: { item: string; photoState: string }
  credit: {
    openMonthUnitsLost: string[]
    openMonthUnitsKept: string[]
    closedMonthsUnchanged: boolean
  }
}
const manifest = JSON.parse(
  readFileSync(join(FIXTURE_DIR, "manifest.json"), "utf8")
) as Manifest

type Photo = {
  state: string
  recheckKind: string | null
  primary: boolean
  head: number
  itemId: string
  events: string[]
}
type Checkpoint = {
  open: number
  closed: number
  photos: Record<string, Photo>
  creditMd5: string
}

function localDbUrl(): string {
  const url = process.env.NABALENS_TEST_DB_URL
  if (!url || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("Run through `pnpm test:security <workdir>` (local DB).")
  }
  return url
}

/** One psql script in one session; returns its checkpoints. */
function run(sql: string): Record<string, unknown> {
  const lines = execFileSync(
    "psql",
    [localDbUrl(), "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
    { encoding: "utf8", input: sql, maxBuffer: 16 * 1024 * 1024 }
  )
    .split("\n")
    .filter((line) => line.length > 0)
  return checkpoints(lines)
}

describe("fx_menu_recheck_public_withdrawal (b04-design §7.5, b05-design §4.10)", () => {
  let before: Checkpoint
  let after: Checkpoint
  let reaccept: { open: number; E: { state: string; primary: boolean } }

  beforeAll(() => {
    const out = run(fixtureScript())
    before = out.BEFORE as Checkpoint
    after = out.AFTER as Checkpoint
    reaccept = out.REACCEPT as typeof reaccept
  })

  it("starts from nine accepted photos, one per item", () => {
    expect(manifest.fixture).toBe("fx_menu_recheck_public_withdrawal")
    expect(Object.keys(before.photos).sort()).toEqual(
      manifest.items.map((i) => i.key).sort()
    )
    for (const p of Object.values(before.photos)) {
      expect(p.state).toBe("accepted")
      expect(p.events).toEqual(["accepted:-"])
    }
  })

  it("sends each changed item's photo to its kind, carries the description-only control, and bumps every head once", () => {
    for (const item of manifest.items) {
      const was = before.photos[item.key]!
      const now = after.photos[item.key]!
      expect(now, item.key).toMatchObject({
        state: item.photoState,
        recheckKind: item.recheckKind,
      })
      // A rename by source key keeps the item (no identity merged or split).
      expect(now.itemId, item.key).toBe(was.itemId)
      expect(now.head, item.key).toBe(was.head + 1)
      // Exactly one activation event: carried, or needs_recheck of its kind.
      expect(now.events, item.key).toEqual([
        ...was.events,
        item.recheckKind ? `needs_recheck:${item.recheckKind}` : "carried:-",
      ])
      if (item.photoState === "accepted")
        expect(now.primary, item.key).toBe(was.primary)
      else expect(now.primary, item.key).toBe(false)
    }
  })

  it("C-B04-2: a declared recheck removes the author's unit in the open month, a carried photo keeps it, re-acceptance restores it", () => {
    const n = manifest.items.length
    expect(before.open).toBe(n)
    expect(after.open).toBe(manifest.credit.openMonthUnitsKept.length)
    expect(manifest.credit.openMonthUnitsLost).toHaveLength(
      n - manifest.credit.openMonthUnitsKept.length
    )
    expect(after.closed).toBe(before.closed)
    expect(reaccept.E).toEqual({
      state: manifest.reaccept.photoState,
      primary: true,
    })
    expect(reaccept.open).toBe(after.open + 1)
    expect(before.creditMd5).toBe(CREDIT_MD5)
    expect(after.creditMd5).toBe(CREDIT_MD5)
  })

  it("C-B04-2: closed months are unchanged by an activation's rechecks", () => {
    const out = run(closedMonthScript())
    expect(manifest.credit.closedMonthsUnchanged).toBe(true)
    expect(out.CLOSED_BEFORE).toEqual({
      open: 0,
      closed: manifest.items.length,
    })
    expect(out.CLOSED_AFTER).toEqual(out.CLOSED_BEFORE)
  })
})

describe("declarations and activation (b04-design §7.2, §7.3, §18 L5)", () => {
  it("applies a variant's declaration only to that variant's photos, and retires a removed variant's trading line", () => {
    const out = run(scopeScript()).SCOPE as {
      dPhotos: Record<string, string>
      cLines: Record<
        string,
        { retired: boolean; retiredBy: string | null; revision: number }
      >
      admin: string
    }
    expect(out.dPhotos).toEqual({
      Bean: "needs_recheck:variant_meaning_changed",
      Beef: "accepted:-",
      item: "accepted:-",
    })
    expect(out.cLines).toEqual({
      Lamb: { retired: true, retiredBy: out.admin, revision: 2 },
      Chicken: { retired: false, retiredBy: null, revision: 1 },
    })
  })

  it("refuses declarations while the switch is off, from non-admins, off the version and after activation; replays the same note", () => {
    const out = run(commandsScript())
    const json = (label: string) =>
      JSON.parse(out[label] as string) as Record<string, unknown>
    expect(out.OFF_ADD).toBe("error:declarations_disabled")
    expect(out.OFF_REMOVE).toBe("error:declarations_disabled")
    expect(out.MANAGER).toBe("error:not_active_admin")
    expect(json("REPLAY")).toMatchObject({
      kind: "presentation",
      replayed: true,
    })
    expect(out.OTHER_NOTE).toBe("error:menu_change_declaration_exists")
    expect(json("NEW")).toMatchObject({ kind: "recipe", replayed: false })
    expect(out.NO_VARIANT).toBe("error:invalid_change_kind")
    expect(out.BAD_KIND).toBe("error:invalid_change_kind")
    expect(out.OFF_VERSION).toBe("error:menu_item_not_on_version")
    const read = JSON.parse(out.READ as string) as { kind: string }[]
    expect(read.map((d) => d.kind).sort()).toEqual([
      "portion",
      "presentation",
      "recipe",
      "recipe",
      "reviewer_flag",
      "variant_meaning",
    ])
    expect(out.REMOVE).toBe("")
    expect(out.REMOVED).toBe(0)
    expect(out.ACTIVE_ADD).toBe("error:menu_version_not_draft")
    expect(out.ACTIVE_REMOVE).toBe("error:menu_version_not_draft")
    expect(out.DIRECT_UPDATE).toBe("menu_change_declaration_immutable")
    expect(out.DIRECT_DELETE).toBe("menu_version_not_draft")
  })

  it("ships the switch off, the eight recheck kinds, and no client access beyond the admin commands", () => {
    expect(
      psql(
        `select enabled from private.menu_switches where name = 'menuChangeDeclarations'`
      )
    ).toBe("f")
    expect(
      psql(`select pg_get_constraintdef(oid) from pg_constraint
        where conname = 'menu_item_photos_recheck_kind_check'`)
    ).toBe(
      "CHECK ((recheck_kind = ANY (ARRAY['name_changed'::text, 'section_changed'::text, 'variant_removed'::text, 'variant_meaning_changed'::text, 'presentation_changed'::text, 'recipe_changed'::text, 'portion_changed'::text, 'reviewer_flag'::text])))"
    )
    for (const [table, role] of [
      ["public.menu_change_declarations", "anon"],
      ["public.menu_change_declarations", "authenticated"],
      ["private.menu_switches", "authenticated"],
      ["private.menu_switches", "service_role"],
    ] as const)
      expect(
        psql(`select has_table_privilege('${role}', '${table}', 'select')`),
        `${role} ${table}`
      ).toBe("f")
    expect(
      psql(
        `select relrowsecurity from pg_class where oid = 'public.menu_change_declarations'::regclass`
      )
    ).toBe("t")
    for (const fn of [
      "public.menu_change_declaration_add(uuid,uuid,uuid,text,text)",
      "public.menu_change_declaration_remove(uuid)",
      "public.menu_change_declarations_for_version(uuid)",
    ])
      expect(
        psql(`select has_function_privilege('anon', '${fn}', 'execute') || ':' ||
          has_function_privilege('authenticated', '${fn}', 'execute') || ':' ||
          has_function_privilege('service_role', '${fn}', 'execute')`),
        fn
      ).toBe("false:true:false")
    for (const fn of [
      "private.menu_switch_enabled(text)",
      "private.menu_versions_retire_trading_lines()",
      "private.reconcile_menu_item_photos(uuid,uuid)",
    ])
      expect(
        psql(`select has_function_privilege('anon', '${fn}', 'execute') || ':' ||
          has_function_privilege('authenticated', '${fn}', 'execute')`),
        fn
      ).toBe("false:false")
    // T9b: the new read is a STABLE definer with an empty search path.
    expect(
      psql(`select provolatile::text || ':' || prosecdef || ':' || array_to_string(proconfig, ',')
        from pg_proc where oid = 'public.menu_change_declarations_for_version(uuid)'::regprocedure`)
    ).toBe('s:true:search_path=""')
    expect(
      psql(`select string_agg(tgname, ',' order by tgname) from pg_trigger
        where tgrelid = 'public.menu_versions'::regclass and not tgisinternal
          and tgname in ('menu_versions_reconcile_item_photos', 'menu_versions_retire_trading_lines')`)
    ).toBe(
      "menu_versions_reconcile_item_photos,menu_versions_retire_trading_lines"
    )
  })
})
