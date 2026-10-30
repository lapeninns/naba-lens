declare module "heic-decode" {
  const decode: {
    all(options: {
      buffer: Uint8Array
    }): Promise<
      Array<{
        width: number
        height: number
        decode(): Promise<{
          width: number
          height: number
          data: Uint8ClampedArray
        }>
      }> & { dispose(): void }
    >
  }
  export default decode
}
