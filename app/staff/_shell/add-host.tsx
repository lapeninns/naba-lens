"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useMediaUploader } from "@/app/_media/use-media-uploader"
import { UploadDialog } from "@/components/nabalens"
import { AddProvider } from "@/components/nabalens/shell/add-context"
import { AddSheet, type AddBlocked } from "@/components/nabalens/shell/add-sheet"
import { MEDIA_LIMITS } from "@/lib/config/media"

/**
 * Hosts Add for every staff page. Phones get the Add sheet first; from md the
 * upload dialog opens straight away. A blocked account sees why instead. The
 * database repeats the block check, so this is display only.
 */
export function AddHost({
  blocked,
  children,
}: {
  blocked: AddBlocked | null
  children: React.ReactNode
}) {
  const router = useRouter()
  const uploader = useMediaUploader()
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [picked, setPicked] = React.useState<File[] | undefined>(undefined)

  const value = React.useMemo(
    () => ({
      openAdd: () => {
        const phone = !window.matchMedia("(min-width: 48rem)").matches
        if (blocked || phone) setSheetOpen(true)
        else {
          setPicked(undefined)
          setUploadOpen(true)
        }
      },
    }),
    [blocked]
  )

  return (
    <AddProvider value={value}>
      {children}
      <AddSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        blocked={blocked}
        onFiles={(files) => {
          setSheetOpen(false)
          setPicked(files)
          setUploadOpen(true)
        }}
      />
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        uploader={uploader}
        limits={MEDIA_LIMITS}
        initialFiles={picked}
        onUploaded={() => router.refresh()}
      />
    </AddProvider>
  )
}
