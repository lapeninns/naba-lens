import { PRIVATE_HEADERS } from "@/lib/server/media/access"
import { getMediaActor } from "@/lib/server/media/context"
import { MENU_CSV_TEMPLATE_FILENAME, menuCsvTemplate } from "@/lib/menus/import"

/**
 * GET: the menu CSV template (spec §8 A3), header row and two example rows,
 * as a download. Admins only, like the import itself.
 */
export async function GET() {
  const auth = await getMediaActor("admin")
  if (!auth.ok)
    return Response.json(
      { ok: false, message: auth.message },
      { status: auth.status, headers: PRIVATE_HEADERS }
    )
  return new Response(menuCsvTemplate(), {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${MENU_CSV_TEMPLATE_FILENAME}"`,
    },
  })
}
