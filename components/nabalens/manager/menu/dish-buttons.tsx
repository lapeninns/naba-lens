"use client"

import { PhotoTips } from "@/components/nabalens/guide/photo-tips"
import { DishAddButtons } from "@/components/nabalens/menu-photos/item-row"
import { useAdd, useAddDish } from "@/components/nabalens/shell/add-context"

/**
 * A Menu row's dish photo buttons, only while the workspace's Add offers a
 * dish (R8: the account can upload and label). Above the row's whole-row
 * link, so they take their own clicks.
 */
export function ManagerDishButtons({
  item,
  describedBy,
}: {
  item: { itemId: string; name: string }
  describedBy: string
}) {
  const openAdd = useAdd()
  const dish = useAddDish()
  if (!openAdd || !dish) return null
  return (
    <div className="relative z-10 col-span-2 flex flex-wrap gap-2 max-sm:*:flex-auto">
      <DishAddButtons openAdd={openAdd} item={item} describedBy={describedBy} />
    </div>
  )
}

/** Optional photo tips on Menu while Add offers a dish (D8); no guide link. */
export function ManagerPhotoTips() {
  const openAdd = useAdd()
  const dish = useAddDish()
  return openAdd && dish ? <PhotoTips /> : null
}
