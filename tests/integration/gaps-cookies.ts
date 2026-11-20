export type CookieJar = { current: Map<string, string> }

/** `next/headers` replacement backed by the jar. */
export function cookiesModule(jar: CookieJar) {
  return {
    cookies: async () => ({
      getAll: () => [...jar.current].map(([name, value]) => ({ name, value })),
      get: (name: string) =>
        jar.current.has(name)
          ? { name, value: jar.current.get(name)! }
          : undefined,
      has: (name: string) => jar.current.has(name),
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  }
}
