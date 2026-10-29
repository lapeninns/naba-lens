export const MEDIA_LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 2,
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
  maxAvatarBytes: 5 * 1024 * 1024,
  signedUrlTtlSeconds: 60,
  pageSize: 24,
  abandonedUploadHours: 24,
} as const
