// Generated synthetic blue frames only; no downloaded or identifiable media.
import { execFileSync } from "node:child_process"
const source = ["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=0.2"]
execFileSync("ffmpeg", [
  ...source,
  "-c:v",
  "libx265",
  "-tag:v",
  "hvc1",
  "-pix_fmt",
  "yuv420p",
  "tests/fixtures/media/review-hevc.mov",
  "-loglevel",
  "error",
])
execFileSync("ffmpeg", [
  ...source,
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "empty_moov+frag_keyframe",
  "tests/fixtures/media/review-fragmented.mp4",
  "-loglevel",
  "error",
])
