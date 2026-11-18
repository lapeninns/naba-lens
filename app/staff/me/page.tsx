import { notFound } from "next/navigation"

import { ALBUM_UPLOAD_TRAY } from "@/lib/config/album-upload-tray"
import StaffPage from "../page"

export const metadata = { title: "Me" }

export default function StaffMePage(props: Parameters<typeof StaffPage>[0]) {
  if (!ALBUM_UPLOAD_TRAY) notFound()
  return <StaffPage {...props} />
}
