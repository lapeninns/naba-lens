import type { ProviderStatusMap, TransportEvent } from "../outcomes"

export type ProviderImage = { mediaType: "image/webp"; bytes: Uint8Array }

/** Everything a provider receives. Built on the server; holds no NabaLens IDs. */
export type ProviderRequest = {
  promptText: string
  images: readonly ProviderImage[]
  maxOutputTokens: number
  idempotencyKey: string
}

export type AssistProvider = ProviderStatusMap & {
  id: string
  /** OD-B9-8: only true once the provider's idempotency guarantee is accepted. */
  idempotentRequests: boolean
  call(
    request: ProviderRequest,
    options: { signal: AbortSignal }
  ): Promise<TransportEvent>
}
