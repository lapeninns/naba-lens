"use client"

import { ImagesIcon } from "@phosphor-icons/react"

import {
  OUR_MENU_LIST_CLASS,
  OurMenuItemRow,
} from "@/components/nabalens/menu-photos/item-row"
import { useAdd } from "@/components/nabalens/shell/add-context"
import { Button } from "@/components/ui/button"

import type { OurMenuItem } from "@/lib/server/coverage/types"

/**
 * Home's Still needed rows: the same dish row as Our menu (name, state word,
 * "Add photos of this dish" with the dish as a label). Nobody owns a dish,
 * so the rows carry no person, date or due state. A person who may not add
 * photos sees the dishes with no actions.
 */
export function StillNeededList({
  items,
  canAdd,
  primaryItemId = null,
}: {
  items: OurMenuItem[]
  canAdd: boolean
  /** The dish whose Add photos is Home's one main action, if any. */
  primaryItemId?: string | null
}) {
  return (
    <ul aria-label="Still needed" className={OUR_MENU_LIST_CLASS}>
      {items.map((item) => (
        <li key={item.itemId}>
          <OurMenuItemRow
            item={item}
            canAdd={canAdd}
            primary={item.itemId === primaryItemId}
          />
        </li>
      ))}
    </ul>
  )
}

/**
 * The menu is complete: Home's one main action opens the phone's photos for
 * any photo (goals decision 12; gallery first, DESIGN.md §2). Hidden outside
 * the staff layout.
 */
export function AddPhotosButton() {
  const openAdd = useAdd()
  if (!openAdd) return null
  return (
    <Button
      variant="primary"
      size="lg"
      className="w-full sm:w-auto"
      // openAdd clicks the library input inside this click handler.
      onClick={() => openAdd({ source: "library" })}
    >
      <ImagesIcon data-icon="inline-start" aria-hidden />
      Add photos from your gallery
    </Button>
  )
}
