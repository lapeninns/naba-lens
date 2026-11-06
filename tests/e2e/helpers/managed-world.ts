import { randomUUID } from "node:crypto"

import { expect } from "@playwright/test"

import { signIn } from "../../support/identities"
import {
  provisionCoverageWorld,
  seedImages,
  type CoverageWorld,
} from "./coverage-world"
import { activateMenu, createMenuDraft, ok } from "./menus"
import { provisioner, psql } from "./stack"

/**
 * A coverage world whose manager holds a venue grant and has prepared the
 * month, so coverage, team, checklist and task pages carry real chips; plus a
 * staff task, an active menu and a draft for the editor.
 */
export type ManagedWorld = {
  world: CoverageWorld
  checklistItemId: string
  taskId: string
  draftId: string
}

export async function provisionManagedWorld(
  label: string
): Promise<ManagedWorld> {
  const world = await provisionCoverageWorld()
  await seedImages(world.staffA, world.venue1, 3, { prefix: `${label}-a` })
  await seedImages(world.staffB, world.venue1, 2, { prefix: `${label}-b` })

  const service = provisioner()
  const adminDb = await signIn(service, world.admin.email)
  const managerDb = await signIn(service, world.manager.email)
  await activateMenu(
    adminDb,
    await createMenuDraft(adminDb, world.venue1.id, `${label} menu`)
  )
  const draftId = await createMenuDraft(
    adminDb,
    world.venue1.id,
    `${label} menu draft`
  )
  await ok(
    adminDb.rpc("grant_venue_manager", {
      p_staff_id: world.manager.id,
      p_venue_id: world.venue1.id,
    })
  )
  await ok(
    managerDb.rpc("prepare_coverage_month", { p_venue_id: world.venue1.id })
  )
  const checklistItemId = psql(
    `select id from public.coverage_requirements where venue_id = '${world.venue1.id}'::uuid and status = 'needs_setup' order by title limit 1`
  )
  expect(checklistItemId, "a prepared checklist item").toMatch(
    /^[0-9a-f-]{36}$/
  )
  const [task] = await ok(
    managerDb.rpc("save_coverage_requirement", {
      p_venue_id: world.venue1.id,
      p_requirement_id: null as never,
      p_expected_revision: null as never,
      p_kind: "venue_specific",
      p_title: `${label} back bar ${world.tag}`,
      p_guidance: "Bottles facing out, labels readable.",
      p_photo_target: 2,
      p_due_on: null as never,
      p_client_request_key: `${label}-${randomUUID()}`,
    })
  )
  const taskId = (task as { requirement_id: string }).requirement_id
  await ok(
    managerDb.rpc("set_coverage_requirement_assignees", {
      p_requirement_id: taskId,
      p_staff_ids: [world.staffA.id],
    })
  )
  return { world, checklistItemId, taskId, draftId }
}

export const staffPages = (m: ManagedWorld) => [
  "/staff/tasks",
  `/staff/tasks/${m.taskId}`,
  "/staff/tasks/month",
  "/staff/tasks/guide",
  "/staff",
  "/staff/community",
  "/staff/people",
  `/staff/people/${m.world.staffB.id}`,
]

export const managerPages = (m: ManagedWorld) => [
  "/staff/manage",
  "/staff/manage/team",
  "/staff/manage/checklist",
  `/staff/manage/checklist/${m.checklistItemId}`,
  "/staff/manage/review",
  "/staff/manage/menu",
]

export const adminPages = (m: ManagedWorld) => [
  "/admin",
  "/admin/staff",
  `/admin/staff/${m.world.staffA.id}`,
  "/admin/coverage",
  "/admin/coverage/managers",
  `/admin/coverage/${m.world.venue1.id}`,
  `/admin/coverage/${m.world.venue1.id}/team`,
  `/admin/coverage/${m.world.venue1.id}/checklist`,
  "/admin/menus",
  `/admin/menus/${m.world.venue1.id}`,
  `/admin/menus/versions/${m.draftId}`,
]
