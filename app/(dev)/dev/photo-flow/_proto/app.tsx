"use client"

import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"

import { BASE, Screen } from "./bits"
import { AlbumFolder, AlbumGroup, AlbumHome, AlbumShelf } from "./screens-album"
import {
  AddScreen,
  BatchLabel,
  BatchReview,
  DemoStart,
  Launcher,
  Missing,
} from "./screens-add"
import { MyPhotos, PhotoDetail, UnlabelledArea } from "./screens-photos"
import { usePhone } from "./store"

/*
 * The prototype's screens, chosen from the address so that every screen has
 * its own link and a refresh lands on the same one:
 *
 *   /dev/photo-flow                      start page (dev only)
 *   /dev/photo-flow/demo                 seed the demo, open its batch
 *   /dev/photo-flow/add                  Add photos
 *   /dev/photo-flow/batch/<id>           the photos just added
 *   /dev/photo-flow/batch/<id>/label     label that batch
 *   /dev/photo-flow/my-photos            My photos
 *   /dev/photo-flow/my-photos/unlabelled the Unlabelled area
 *   /dev/photo-flow/photo/<id>           one photo
 *   /dev/photo-flow/album/...            Album, shelf, group, folder
 */
export function PhotoFlowApp() {
  const pathname = usePathname()
  const state = usePhone()
  const first = useRef(true)

  // Moving to another screen puts focus on its title, so a screen reader
  // says where the person now is. Not on the first load.
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    document.querySelector<HTMLElement>("[data-screen-title]")?.focus()
  }, [pathname])

  if (!state) {
    return (
      <Screen foot="none">
        <p className="sr-only" role="status">
          Loading
        </p>
      </Screen>
    )
  }

  const parts = pathname
    .slice(BASE.length)
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent)
  const [area, a, b, c] = parts

  if (!area) return <Launcher state={state} />
  if (area === "demo") return <DemoStart />
  if (area === "add") return <AddScreen state={state} />
  if (area === "batch" && a) {
    return b === "label" ? (
      <BatchLabel state={state} batchId={a} />
    ) : (
      <BatchReview state={state} batchId={a} />
    )
  }
  if (area === "my-photos") {
    return a === "unlabelled" ? (
      <UnlabelledArea state={state} />
    ) : (
      <MyPhotos state={state} />
    )
  }
  if (area === "photo" && a) return <PhotoDetail state={state} photoId={a} />
  if (area === "album") {
    if (!a) return <AlbumHome state={state} />
    if (!b) return <AlbumShelf state={state} shelf={a} />
    if (!c) return <AlbumGroup state={state} shelf={a} groupId={b} />
    return <AlbumFolder state={state} folderId={`${a}/${b}/${c}`} />
  }
  return <Missing state={state} what="page" />
}
