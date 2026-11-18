"use server"

import { revalidatePath } from "next/cache"

import {
  createExportPackage,
  rebuildExportPackage,
  recordPublication,
  saveDestination,
  setExportProfile,
} from "@/lib/server/exports/service"
import { exportHrefs } from "@/lib/server/exports/hrefs"
import { actorFailureMessage, getMediaActor } from "@/lib/server/media/context"

/**
 * S1-EXPORT Server Functions, shared by the admin Publishing screen and the
 * manager's Exports. Reachable by direct POST, so every input is untrusted:
 * the caller is read again here and the database decides access (a manager
 * only for their venue, public mode only; publication records and settings
 * admins only). Failures are returned as values, never thrown.
 */

type Failure = { ok: false; message: string }

/**
 * The caller, or the failure in its own words (S3-R6, V6): signed out, the
 * second sign-in step, an inactive account or a failed account check.
 */
async function actor() {
  const auth = await getMediaActor(["staff", "manager", "admin"])
  return auth.ok
    ? { ok: true as const, actor: auth.actor }
    : ({ ok: false, message: actorFailureMessage(auth) } satisfies Failure)
}

function refresh() {
  revalidatePath(exportHrefs.admin, "layout")
  revalidatePath(exportHrefs.manager, "layout")
}

export async function createPackageAction(input: {
  requestKey: unknown
  mode: unknown
  profileKey: unknown
  items: unknown
  customWidth?: unknown
  customHeight?: unknown
  note?: unknown
}): Promise<{ ok: true; packageId: string } | Failure> {
  const auth = await actor()
  if (!auth.ok) return auth
  const a = auth.actor
  const result = await createExportPackage(a, input)
  if (!result.ok) return { ok: false, message: result.message }
  refresh()
  return { ok: true, packageId: result.packageId }
}

export async function rebuildPackageAction(input: {
  requestKey: unknown
  packageId: unknown
}): Promise<{ ok: true; packageId: string; removed: number } | Failure> {
  const auth = await actor()
  if (!auth.ok) return auth
  const a = auth.actor
  const result = await rebuildExportPackage(a, input)
  if (!result.ok) return { ok: false, message: result.message }
  refresh()
  return {
    ok: true,
    packageId: result.packageId,
    removed: result.removed.length,
  }
}

export async function recordPublicationAction(input: {
  requestKey: unknown
  destinationId: unknown
  assetId: unknown
  action: unknown
  occurredOn: unknown
  externalUrl?: unknown
  externalRef?: unknown
  note?: unknown
  packageId?: unknown
}): Promise<{ ok: true; state: string | null } | Failure> {
  const auth = await actor()
  if (!auth.ok) return auth
  const a = auth.actor
  const result = await recordPublication(a, input)
  if (!result.ok) return { ok: false, message: result.message }
  refresh()
  return { ok: true, state: result.state }
}

export async function saveDestinationAction(input: {
  destinationId: unknown
  venueId: unknown
  label: unknown
  url: unknown
  active: unknown
  revision: unknown
}): Promise<{ ok: true } | Failure> {
  const auth = await actor()
  if (!auth.ok) return auth
  const a = auth.actor
  const result = await saveDestination(a, input)
  if (!result.ok) return { ok: false, message: result.message }
  refresh()
  return { ok: true }
}

export async function setProfileAction(input: {
  key: unknown
  label: unknown
  format: unknown
  maxWidth: unknown
  maxHeight: unknown
  quality: unknown
  revision: unknown
}): Promise<{ ok: true } | Failure> {
  const auth = await actor()
  if (!auth.ok) return auth
  const a = auth.actor
  const result = await setExportProfile(a, input)
  if (!result.ok) return { ok: false, message: result.message }
  refresh()
  return { ok: true }
}
