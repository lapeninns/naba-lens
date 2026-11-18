import { notFound } from "next/navigation"

import { ALBUM_UPLOAD_TRAY } from "@/lib/config/album-upload-tray"
import AlbumHomePage from "../tasks/page"

export const metadata = { title: "Album" }

export default function StaffAlbumPage(
  props: Parameters<typeof AlbumHomePage>[0]
) {
  if (!ALBUM_UPLOAD_TRAY) notFound()
  return <AlbumHomePage {...props} />
}
