/** Words every admin boundary shares (redesign R5, ia.md). */
export const ADMIN_BOUNDARY_COPY = {
  /** Error notices say Retry (decision 11). */
  retry: "Retry",
  requestId: (digest: string) => `Request ID ${digest}`,
} as const
