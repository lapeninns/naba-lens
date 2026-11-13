// @vitest-environment jsdom
// Add's value changes while the page is still streaming in (R8's choices
// arrive, the auth client reports who is signed in), and its context no
// longer carries the value (a new context value above a streamed boundary
// still waiting to be revealed made the browser render that boundary again:
// two search forms on /manager/search). Readers follow a store instead: they
// hydrate with the value the server rendered, follow later values, and a
// reader mounted later starts from the current one. jsdom does not reproduce
// the browser's second render of the boundary (the old context passes this
// file too); tests/e2e/search.spec.ts (i) does, on a cold server.
import * as React from "react"
import { act } from "react"
import { createRoot, hydrateRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import {
  AddProvider,
  useAddContext,
} from "@/components/nabalens/shell/add-context"

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const never = new Promise<never>(() => {})

function Reader() {
  return <p data-reader="">{useAddContext() ? "add" : "none"}</p>
}

function Waiting(): React.ReactNode {
  return React.use(never)
}

/** Like ManagerShell: the page passed through, between Add and the boundary. */
function Shell({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>
}

/** Set by the mounted components, for the test to drive them. */
const drive = {
  setOn: (on: boolean): void => void on,
  show: (on: boolean): void => void on,
}

/** Like AddHost: its own state, the page passed in as children. */
function Host({ children }: { children: React.ReactNode }) {
  const [on, set] = React.useState(false)
  React.useLayoutEffect(() => {
    drive.setOn = set
  }, [])
  const value = React.useMemo(() => (on ? { openAdd: () => {} } : null), [on])
  return <AddProvider value={value}>{children}</AddProvider>
}

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
})

describe("AddProvider while a streamed boundary waits", () => {
  it("keeps the server's boundary and still updates its readers", async () => {
    // The server's HTML with the boundary's content streamed in but not yet
    // revealed ("$~": React's reveal script has it queued).
    const container = document.createElement("div")
    container.innerHTML =
      '<div><p data-reader="">none</p><!--$~--><template id="B:0"></template><span id="fallback">Loading</span><!--/$--></div>'
    document.body.append(container)
    const serverFallback = container.querySelector("#fallback")

    await act(async () => {
      root = hydrateRoot(
        container,
        <Host>
          <Shell>
            <Reader />
            <React.Suspense fallback={<span id="fallback">Loading</span>}>
              <Waiting />
            </React.Suspense>
          </Shell>
        </Host>,
        {
          onRecoverableError: (error) => {
            throw error
          },
        }
      )
    })
    expect(container.querySelector("[data-reader]")?.textContent).toBe("none")

    await act(async () => drive.setOn(true))

    expect(container.querySelector("[data-reader]")?.textContent).toBe("add")
    // Not rendered again in the browser: the server's node is still there.
    expect(container.querySelector("#fallback")).toBe(serverFallback)
    expect(container.innerHTML).toContain("<!--$~-->")
  })

  it("gives a reader mounted after a change the current value", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    function Later() {
      const [shown, set] = React.useState(false)
      React.useLayoutEffect(() => {
        drive.show = set
      }, [])
      return shown ? <Reader /> : null
    }
    const client = createRoot(container)
    root = client
    await act(async () =>
      client.render(
        <Host>
          <Reader />
          <Later />
        </Host>
      )
    )
    await act(async () => drive.setOn(true))
    await act(async () => drive.show(true))
    const readers = container.querySelectorAll("[data-reader]")
    expect([...readers].map((r) => r.textContent)).toEqual(["add", "add"])
    await act(async () => drive.setOn(false))
    expect(
      [...container.querySelectorAll("[data-reader]")].map((r) => r.textContent)
    ).toEqual(["none", "none"])
  })
})
