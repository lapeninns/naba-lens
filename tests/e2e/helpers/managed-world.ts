import { randomUUID } from "node:crypto"

import { expect } from "@playwright/test"

import { signIn } from "../../support/identities"
import { convertToManager } from "./manager-world"
import {
  provisionCoverageWorld,
  seedImages,
  type CoverageWorld,
} from "./coverage-world"
import { activateMenu, createMenuDraft, ok } from "./menus"
import { provisioner, psql } from "./stack"

/**
 * A coverage world whose manager is a venue manager ACCOUNT (converted by the
 * admin, so it holds an effective grant and uses /manager, decision D3) and has
 * a prepared month. The admin, who may manage every venue, prepares the
 * month and saves the staff task before the manager is converted: a manager
 * account makes no legacy coverage writes (`deny_manager_coverage_writes`).
 * So coverage, team, checklist and task pages carry real chips; plus a
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

  const adminDb = await signIn(provisioner(), world.admin.email)
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
    adminDb.rpc("prepare_coverage_month", { p_venue_id: world.venue1.id })
  )
  const checklistItemId = psql(
    `select id from public.coverage_requirements where venue_id = '${world.venue1.id}'::uuid and status = 'needs_setup' order by title limit 1`
  )
  expect(checklistItemId, "a prepared checklist item").toMatch(
    /^[0-9a-f-]{36}$/
  )
  const [task] = await ok(
    adminDb.rpc("save_coverage_requirement", {
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
    adminDb.rpc("set_coverage_requirement_assignees", {
      p_requirement_id: taskId,
      p_staff_ids: [world.staffA.id],
    })
  )
  await convertToManager(adminDb, world.manager, world.venue1)
  return { world, checklistItemId, taskId, draftId }
}

export const staffPages = (m: ManagedWorld) => [
  "/staff/home",
  "/staff/album",
  "/staff/album/menu",
  "/staff/photos",
  "/staff/me",
  "/staff/me/settings",
  `/staff/tasks/${m.taskId}`,
  "/staff/tasks/month",
  "/staff/tasks/guide",
  "/staff/community",
  "/staff/people",
  `/staff/people/${m.world.staffB.id}`,
]

/** The venue manager workspace (/manager, decision D3). */
export const managerPages = () => [
  "/manager",
  "/manager/team",
  "/manager/review",
  "/manager/menu",
  "/manager/requests",
  "/manager/album",
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
