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
import { Notice } from "@/components/nabalens/notice"

import {
  Help,
  Me,
  Notices,
  Person,
  Settings,
  Team,
  YourMonth,
} from "./screens-me"
import { QuestionScreen, QuestionsList } from "./screens-questions"
import { SignIn, Today, Welcome } from "./screens-today"
import { useOnline, usePhone } from "./store"
import { hasAlbum, useWorld } from "./world"
import { NoAlbum } from "./screens-me"

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
  const world = useWorld()
  const online = useOnline()
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

  if (!state || !world) {
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

  const screen = () => {
    if (!area) return <Launcher state={state} />
    if (area === "demo") return <DemoStart />
    // Every staff screen is behind sign-in; the start page is not.
    if (area === "sign-in" || !world.signedIn) return <SignIn world={world} />
    if (area === "welcome") return <Welcome world={world} />
    if (area === "today") return <Today state={state} world={world} />
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
    if (area === "question" && a)
      return <QuestionScreen key={a} state={state} world={world} id={a} />
    if (area === "album") {
      if (!hasAlbum(world))
        return <NoAlbum state={state} world={world} title="Album" />
      if (!a) return <AlbumHome state={state} />
      if (a === "questions")
        return <QuestionsList state={state} world={world} />
      if (!b) return <AlbumShelf state={state} shelf={a} />
      if (!c) return <AlbumGroup state={state} shelf={a} groupId={b} />
      return <AlbumFolder state={state} folderId={`${a}/${b}/${c}`} />
    }
    if (area === "me") {
      const props = { state, world }
      if (!a) return <Me {...props} />
      if (a === "notices") return <Notices {...props} />
      if (a === "month") return <YourMonth {...props} />
      if (a === "settings") return <Settings {...props} />
      if (a === "help") return <Help {...props} />
      if (a === "team")
        return b ? <Person {...props} id={b} /> : <Team {...props} />
    }
    return <Missing state={state} what="page" />
  }

  return (
    <>
      {!online && area ? (
        <div className="mx-auto w-full max-w-feed">
          <Notice
            tone="negative"
            role="status"
            data-offline=""
            title="You’re offline"
          >
            You can keep going. Photos and labels are saved on this phone and
            upload when you’re back online.
          </Notice>
        </div>
      ) : null}
      {screen()}
    </>
  )
}
