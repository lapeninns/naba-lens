/** Verification planning is an auditable workflow, not a substitute for CI gates. */
export const phases = [
  "implementation",
  "integration",
  "frozen",
  "qualifying",
  "qualified",
  "blocked",
  "closed",
]
export function transition(previous, action, context) {
  const s = structuredClone(previous)
  const fail = (message) => {
    throw Error(message)
  }
  if (!s || s.version !== 1 || !phases.includes(s.phase))
    fail("Invalid batch state")
  if (action.type === "complete") {
    if (s.phase !== "implementation" || !s.tasks.includes(action.task))
      fail("Complete an existing task during implementation")
    s.completed = [...new Set([...s.completed, action.task])]
  } else if (action.type === "integrate") {
    if (
      s.phase !== "implementation" ||
      s.tasks.some((t) => !s.completed.includes(t))
    )
      fail("Finish every agreed task before integration")
    s.phase = "integration"
  } else if (action.type === "freeze") {
    if (
      s.phase !== "integration" ||
      !context.clean ||
      !action.review ||
      action.reviewHead !== context.head
    )
      fail(
        "Freeze needs integration, a clean committed candidate, and review evidence for this exact head"
      )
    s.phase = "frozen"
    s.candidate = {
      head: context.head,
      tree: context.tree,
      review: action.review,
      profileDigest: context.profileDigest,
    }
  } else if (action.type === "qualify") {
    if (
      s.phase !== "frozen" ||
      !context.clean ||
      s.candidate.head !== context.head ||
      s.candidate.tree !== context.tree ||
      s.candidate.profileDigest !== context.profileDigest
    )
      fail(
        "Candidate changed or is not frozen; integrate and review the final head first"
      )
    s.phase = "qualifying"
  } else if (action.type === "result") {
    if (s.phase !== "qualifying") fail("No qualification is running")
    const unchanged =
      context.clean &&
      s.candidate.head === context.head &&
      s.candidate.tree === context.tree &&
      s.candidate.profileDigest === context.profileDigest
    s.phase = action.passed && unchanged ? "qualified" : "blocked"
    s.attempts.push({
      head: s.candidate.head,
      at: action.at,
      passed: Boolean(action.passed && unchanged),
      evidence: action.evidence,
    })
  } else if (action.type === "repair") {
    if (
      !["integration", "frozen", "blocked", "qualified"].includes(s.phase) ||
      typeof action.reason !== "string" ||
      action.reason.trim().length < 12
    )
      fail(
        "Reopen only for a documented blocking finding; a running gate cannot be reopened"
      )
    if (!action.task || /[\r\n]/.test(action.task))
      fail("Name the blocking repair task")
    s.repairs.push({
      reason: action.reason,
      task: action.task,
      previousCandidate: s.candidate?.head,
    })
    s.phase = "implementation"
    delete s.candidate
    s.tasks = [...new Set([...s.tasks, action.task])]
    s.completed = s.completed.filter((t) => t !== action.task)
  } else if (action.type === "close") {
    if (
      s.phase !== "qualified" ||
      !context.clean ||
      s.candidate.head !== context.head ||
      s.candidate.profileDigest !== context.profileDigest
    )
      fail("Close only the qualified unchanged candidate")
    s.phase = "closed"
  } else fail("Unknown transition")
  return s
}
