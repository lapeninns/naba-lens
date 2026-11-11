// @vitest-environment jsdom
// B03 UI design §4.2, §4.3, §4.5: the policy editor's sections.
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  emptyPolicy,
  POLICY_COPY,
  type PolicyDraft,
  type PolicyStance,
} from "@/components/nabalens/knowledge/policy-detail"
import {
  PolicyDetailFields,
  PolicyNeedsPanel,
  PolicyRuleField,
} from "@/components/nabalens/knowledge/policy-detail-fields"

afterEach(cleanup)

const BAR = {
  subjectId: "5a000000-0000-4000-8000-000000000001",
  kind: "area" as const,
  label: "⟨Back bar⟩",
  active: true,
}
const LEAD = {
  code: "on_lead",
  label: "⟨On a lead⟩",
  needsValue: false,
  valueKind: null,
}
const today = "2026-11-10"

function Fields(
  props: Partial<React.ComponentProps<typeof PolicyDetailFields>> & {
    initial?: Partial<PolicyDraft>
    onDraft?: (d: PolicyDraft) => void
  }
) {
  const { initial, onDraft, ...rest } = props
  const [value, setValue] = React.useState<PolicyDraft>({
    ...emptyPolicy({ requiresZones: rest.requiresZones }),
    ...initial,
  })
  return (
    <PolicyDetailFields
      id="p"
      value={value}
      onChange={(next) => {
        setValue(next)
        onDraft?.(next)
      }}
      places={[BAR]}
      conditionTypes={[]}
      exceptionTypes={[]}
      requiresZones={false}
      basis="venue_manager"
      canStateOrgPolicy={false}
      errors={{}}
      today={today}
      {...rest}
    />
  )
}

describe("the rule", () => {
  it("keeps Allowed with conditions unavailable with no condition types, saying why", async () => {
    const onChange = vi.fn<(s: PolicyStance) => void>()
    render(
      <PolicyRuleField
        id="rule"
        value={null}
        onChange={onChange}
        staff={false}
        conditionsAvailable={false}
      />
    )
    const conditional = screen.getByRole("radio", {
      name: "Allowed with conditions",
    })
    expect(conditional.getAttribute("aria-disabled")).toBe("true")
    expect(conditional.getAttribute("aria-describedby")).toBe(
      "rule-conditional-off"
    )
    expect(
      screen.getByText("No condition types are set up yet. Ask an admin.")
    ).toBeTruthy()
    await userEvent.setup().click(conditional)
    expect(onChange).not.toHaveBeenCalled()
    await userEvent
      .setup()
      .click(screen.getByRole("radio", { name: "Allowed" }))
    expect(onChange).toHaveBeenCalledWith("allowed")
  })

  it("asks staff for the rule they saw, and says it doesn't set the rule", () => {
    render(
      <PolicyRuleField
        id="rule"
        value={null}
        onChange={() => {}}
        staff
        conditionsAvailable={false}
      />
    )
    expect(screen.getByRole("group", { name: "The rule you saw" })).toBeTruthy()
    expect(
      screen.getByText(
        "A manager or an admin states the policy. What you send helps them; it doesn't set the rule."
      )
    ).toBeTruthy()
    expect(
      screen
        .getByRole("radio", { name: "Allowed with conditions" })
        .getAttribute("aria-disabled")
    ).toBeNull()
  })
})

describe("policy sections", () => {
  it("marks Areas required and starts with a row when the version requires them", () => {
    render(<Fields requiresZones />)
    const areas = screen.getByRole("group", { name: "Areas (required)" })
    expect(within(areas).getByRole("group", { name: "Area 1" })).toBeTruthy()
    expect(within(areas).getByLabelText("Place")).toBeTruthy()
  })

  it("adds an area named somewhere else, with its own rule", async () => {
    const user = userEvent.setup()
    const onDraft = vi.fn<(d: PolicyDraft) => void>()
    render(<Fields onDraft={onDraft} />)
    await user.click(screen.getByRole("button", { name: "Add an area" }))
    await user.selectOptions(screen.getByLabelText("Place"), "Somewhere else")
    await user.type(screen.getByLabelText("Name the place"), "⟨Garden⟩")
    await user.click(
      within(screen.getByRole("group", { name: "Rule here" })).getByRole(
        "radio",
        { name: "Not allowed" }
      )
    )
    expect(onDraft.mock.lastCall?.[0].zones).toEqual([
      { place: { label: "⟨Garden⟩" }, stance: "not_allowed" },
    ])
  })

  it("says no condition or exception types are set up yet", () => {
    render(<Fields initial={{ stance: "conditional" }} />)
    expect(
      screen.getByText("No condition types are set up yet. Ask an admin.")
    ).toBeTruthy()
    expect(screen.getByText("No exception types are set up yet.")).toBeTruthy()
    expect(screen.queryByRole("group", { name: "Exceptions" })).toBeNull()
  })

  it("offers conditions from the list for Allowed with conditions", async () => {
    const user = userEvent.setup()
    const onDraft = vi.fn<(d: PolicyDraft) => void>()
    render(
      <Fields
        initial={{ stance: "conditional" }}
        conditionTypes={[LEAD]}
        onDraft={onDraft}
      />
    )
    await user.click(screen.getByRole("button", { name: "Add a condition" }))
    await user.selectOptions(screen.getByLabelText("Condition"), "⟨On a lead⟩")
    expect(onDraft.mock.lastCall?.[0].conditions).toEqual([
      { type: "on_lead", value: "", note: "" },
    ])
  })

  it("still names a retired condition on an old answer", () => {
    render(
      <Fields
        initial={{
          stance: "conditional",
          conditions: [{ type: "old_code", value: "", note: "" }],
        }}
        conditionTypes={[LEAD]}
      />
    )
    const select = screen.getByLabelText("Condition") as HTMLSelectElement
    expect(select.value).toBe("old_code")
    expect(
      within(select).getByRole("option", {
        name: "old_code (no longer offered)",
      })
    ).toBeTruthy()
  })

  it("names a retired condition and exception from their own lists when codes match", () => {
    // Codes are unique per list only: the same code may be retired in both.
    const shared = (label: string) => ({
      code: "shared",
      label,
      needsValue: false,
      valueKind: null,
    })
    render(
      <Fields
        initial={{
          stance: "conditional",
          conditions: [{ type: "shared", value: "", note: "" }],
          exceptions: [{ type: "shared", note: "" }],
        }}
        conditionTypes={[LEAD]}
        exceptionTypes={[{ ...LEAD, code: "staff_only", label: "⟨Staff⟩" }]}
        retiredConditionTypes={[shared("⟨Condition label⟩")]}
        retiredExceptionTypes={[shared("⟨Exception label⟩")]}
      />
    )
    const condition = screen.getByLabelText("Condition") as HTMLSelectElement
    const exception = screen.getByLabelText(
      POLICY_COPY.exceptionType
    ) as HTMLSelectElement
    expect(condition.selectedOptions[0]?.textContent).toBe(
      "⟨Condition label⟩ (no longer offered)"
    )
    expect(exception.selectedOptions[0]?.textContent).toBe(
      "⟨Exception label⟩ (no longer offered)"
    )
  })

  it("offers Every venue only to someone who may state it", () => {
    render(<Fields />)
    expect(screen.queryByRole("group", { name: "Applies to" })).toBeNull()
    cleanup()
    render(<Fields basis="admin" canStateOrgPolicy />)
    const scope = screen.getByRole("group", { name: "Applies to" })
    expect(
      within(scope).getByRole("radio", { name: "This venue" })
    ).toHaveProperty("checked", true)
    expect(
      within(scope).getByRole("radio", { name: "Every venue" })
    ).toBeTruthy()
    expect(screen.getByText("You, as admin")).toBeTruthy()
  })

  it("asks who stated it, with the basis from the account", () => {
    render(<Fields />)
    expect(screen.getByText("You, as venue manager")).toBeTruthy()
    const date = screen.getByLabelText("Stated on") as HTMLInputElement
    expect(date.max).toBe(today)
    expect(screen.getByRole("group", { name: "Where" })).toBeTruthy()
    expect(screen.getByPlaceholderText("⟨Reference⟩")).toBeTruthy()
  })

  it("gives staff only the areas", () => {
    render(<Fields basis={null} initial={{ stance: "conditional" }} />)
    expect(screen.getByRole("group", { name: "Areas" })).toBeTruthy()
    expect(
      screen.queryByText("No condition types are set up yet. Ask an admin.")
    ).toBeNull()
    expect(screen.queryByLabelText("Stated on")).toBeNull()
    expect(screen.queryByRole("group", { name: "Applies to" })).toBeNull()
  })
})

describe("what this policy still needs", () => {
  it("lists each item in a note, and says when nothing is missing", () => {
    const { rerender } = render(
      <PolicyNeedsPanel needs={["zones", "stated_on"]} />
    )
    const note = screen.getByRole("note")
    expect(
      within(note)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(["at least one area with its rule", "the date it was stated"])
    expect(within(note).getByRole("status").textContent).toBe("")
    rerender(<PolicyNeedsPanel needs={[]} />)
    expect(screen.getByRole("status").textContent).toBe("Nothing is missing.")
    expect(screen.queryByRole("list")).toBeNull()
  })
})
