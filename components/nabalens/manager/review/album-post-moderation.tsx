"use client"

import { useActionState, useId, useState } from "react"

import { moderateAlbumPost } from "@/app/manager/review/album-post-actions"
import { AlbumPostFeedback } from "@/components/nabalens/album/posted-photos"
import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { Database } from "@/lib/db/types"
import type { AlbumPost } from "@/lib/server/staff-album-posts"

type Choice =
  Database["public"]["Functions"]["staff_album_review_options"]["Returns"][number]
type Action = "feedback" | "retake" | "label" | "remove"
const ACTIONS: Record<Action, string> = {
  feedback: "Leave feedback",
  retake: "Request another photo",
  label: "Correct Album label",
  remove: "Remove from Album",
}
const control =
  "min-h-12 w-full rounded-control border border-line-strong bg-surface px-3 text-body text-ink focus-ring"

export function AlbumPostModeration({
  post,
  choices,
}: {
  post: AlbumPost
  choices: Choice[]
}) {
  const titleId = useId()
  const actionId = useId()
  const labelId = useId()
  const noteId = useId()
  const [action, setAction] = useState<Action>("feedback")
  const [reply, submit, pending] = useActionState(
    moderateAlbumPost.bind(null, post.id),
    null
  )
  const groups = new Map<string, Choice[]>()
  for (const choice of choices) {
    const group = groups.get(choice.group_name) ?? []
    group.push(choice)
    groups.set(choice.group_name, group)
  }

  return (
    <section
      aria-labelledby={titleId}
      className="grid gap-3 rounded-card border border-line bg-surface p-4"
    >
      <h2 id={titleId} className="type-section-title text-ink">
        Staff Album
      </h2>
      <p className="text-body text-ink-muted">
        {post.removed
          ? "This photo was removed from the staff Album."
          : "This photo has been posted to the staff Album."}
      </p>
      {!post.removed ? (
        <form
          action={submit}
          aria-labelledby={titleId}
          className="grid max-w-xl gap-3"
        >
          <div className="grid gap-1.5">
            <label htmlFor={actionId} className="text-label text-ink">
              Action
            </label>
            <select
              id={actionId}
              name="action"
              className={control}
              value={action}
              onChange={(e) => setAction(e.target.value as Action)}
            >
              {Object.entries(ACTIONS).map(([key, text]) => (
                <option key={key} value={key}>
                  {text}
                </option>
              ))}
            </select>
          </div>
          {action === "label" ? (
            <div className="grid gap-1.5">
              <label htmlFor={labelId} className="text-label text-ink">
                Dish, drink or space
              </label>
              <select
                id={labelId}
                name="label"
                className={control}
                defaultValue=""
                required
              >
                <option value="" disabled>
                  Choose a label
                </option>
                {[...groups].map(([name, options]) => (
                  <optgroup label={name} key={name}>
                    {options.map((option) => (
                      <option
                        value={`${option.kind}:${option.id}`}
                        key={option.id}
                      >
                        {option.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <label htmlFor={noteId} className="text-label text-ink">
              {action === "remove"
                ? "Reason for removal"
                : action === "label"
                  ? "Note for the uploader (optional)"
                  : "Note for the uploader"}
            </label>
            <Textarea
              id={noteId}
              name="note"
              required={action !== "label"}
              maxLength={500}
              rows={3}
            />
          </div>
          <Button
            type="submit"
            variant={action === "remove" ? "danger" : "secondary"}
            loading={pending}
            className="justify-self-start"
          >
            {action === "feedback" ? "Send feedback" : ACTIONS[action]}
          </Button>
        </form>
      ) : null}
      {reply ? (
        <Notice tone={reply.ok ? "positive" : "negative"}>
          {reply.message}
        </Notice>
      ) : null}
      {post.feedback.length ? (
        <AlbumPostFeedback notes={post.feedback} removed={false} />
      ) : null}
    </section>
  )
}
