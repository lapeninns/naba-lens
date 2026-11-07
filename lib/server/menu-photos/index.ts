import "server-only"

// Manager-facing menu photo services: the venue manager workspace (/manager)
// and the admin Review page. Separate from lib/server/coverage, whose venue
// resolution keeps manager accounts out of the legacy coverage screens.

export {
  getManagerPhotoCtx,
  managerPhotoCtxFor,
  type ManagerPhotoCtx,
} from "./context"
export { decideMenuPhoto } from "./decide"
export { menuPhotoFailure, OWN_PHOTO_MESSAGE } from "./errors"
export {
  getContributor,
  getManagerItem,
  getManagerOverview,
  listContributors,
  listItemEvents,
  listManagerMenuItems,
  listReviewQueue,
} from "./read"
export { isMenuStatus, isQueueStatus, parseDecideInput } from "./validate"
export type * from "./types"
