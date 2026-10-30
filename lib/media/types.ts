export class MediaError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = "MediaError"
  }
}
export const view = (b: Uint8Array) =>
  Buffer.from(b.buffer, b.byteOffset, b.byteLength)
