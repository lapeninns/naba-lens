import assert from "node:assert/strict"
import test from "node:test"
import { transition } from "./policy.mjs"
const context = { head: "a".repeat(40), tree: "b".repeat(40), clean: true }
const initial = () => ({
  version: 1,
  phase: "implementation",
  tasks: ["labels", "review"],
  completed: [],
  attempts: [],
  repairs: [],
})
function freeze() {
  let s = initial()
  for (const task of s.tasks)
    s = transition(s, { type: "complete", task }, context)
  s = transition(s, { type: "integrate" }, context)
  return transition(
    s,
    {
      type: "freeze",
      reviewHead: context.head,
      review: "local-review-evidence.md",
    },
    context
  )
}
test("cannot qualify while implementation or review is unfinished", () => {
  assert.throws(() => transition(initial(), { type: "integrate" }, context))
  assert.throws(() => transition(initial(), { type: "qualify" }, context))
  assert.throws(() =>
    transition(initial(), { type: "freeze", review: "review" }, context)
  )
})
test("dirty source, changed candidate and review of a different head fail closed", () => {
  assert.throws(() =>
    transition(freeze(), { type: "qualify" }, { ...context, clean: false })
  )
  assert.throws(() =>
    transition(
      freeze(),
      { type: "qualify" },
      { ...context, head: "c".repeat(40) }
    )
  )
  let s = initial()
  s.completed = [...s.tasks]
  s.phase = "integration"
  assert.throws(() =>
    transition(
      s,
      { type: "freeze", reviewHead: "old", review: "review" },
      context
    )
  )
})
test("one candidate cannot start a second qualification or change scope while a gate runs", () => {
  const s = transition(freeze(), { type: "qualify" }, context)
  assert.throws(() => transition(s, { type: "qualify" }, context))
  assert.throws(() =>
    transition(
      s,
      { type: "repair", task: "new-work", reason: "another improvement" },
      context
    )
  )
})
test("a passing command cannot qualify changed source and an unknown or failed result stays blocked", () => {
  const s = transition(freeze(), { type: "qualify" }, context)
  for (const ctx of [
    { ...context, clean: false },
    { ...context, tree: "changed" },
  ]) {
    const result = transition(
      s,
      { type: "result", passed: true, at: "now" },
      ctx
    )
    assert.equal(result.phase, "blocked")
    assert.equal(result.attempts[0].passed, false)
  }
  assert.equal(
    transition(s, { type: "result", passed: false }, context).phase,
    "blocked"
  )
})
test("qualified evidence is not replayable without a documented blocking repair and new review", () => {
  let s = transition(freeze(), { type: "qualify" }, context)
  s = transition(s, { type: "result", passed: true }, context)
  assert.equal(s.phase, "qualified")
  assert.throws(() => transition(s, { type: "qualify" }, context))
  assert.throws(() =>
    transition(s, { type: "repair", task: "fix", reason: "" }, context)
  )
  s = transition(
    s,
    {
      type: "repair",
      task: "filter-fix",
      reason: "blocking pagination defect from review",
    },
    context
  )
  assert.equal(s.phase, "implementation")
  assert.equal(s.candidate, undefined)
  assert.equal(s.attempts.length, 1)
  assert.equal(s.repairs.length, 1)
  assert.throws(() => transition(s, { type: "integrate" }, context))
})
test("closing requires the unchanged qualified candidate and preserves the input state", () => {
  let s = transition(freeze(), { type: "qualify" }, context)
  s = transition(s, { type: "result", passed: true }, context)
  assert.throws(() =>
    transition(s, { type: "close" }, { ...context, head: "changed" })
  )
  assert.equal(transition(s, { type: "close" }, context).phase, "closed")
  assert.equal(s.phase, "qualified")
})
