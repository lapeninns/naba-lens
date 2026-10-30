import "server-only"

export type ArchiveConfig = {
  sourceUrl: string
  sourceProjectRef: string
  sourceServiceKey: string
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

/** Hosted deployments must make an explicit retention choice. */
export function readArchiveConfig(
  env: Record<string, string | undefined> = process.env
): ArchiveConfig | null {
  const mode = env.MEDIA_ARCHIVE_MODE?.trim()
  const identity = env.NABALENS_ENVIRONMENT
  const productionRef = env.MEDIA_ARCHIVE_PRODUCTION_PROJECT_REF
  const sourceUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? ""
  let parsed: URL
  try {
    parsed = new URL(sourceUrl)
    if (
      env.NEXT_PUBLIC_SUPABASE_URL &&
      env.SUPABASE_URL &&
      new URL(env.SUPABASE_URL).href !== parsed.href
    )
      throw new Error("ambiguous_source")
  } catch {
    throw new Error("archive_source_not_configured")
  }
  const local =
    ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) &&
    ["http:", "https:"].includes(parsed.protocol) &&
    !parsed.username &&
    !parsed.password &&
    parsed.pathname === "/" &&
    !parsed.search &&
    !parsed.hash
  // Operator scripts have no VERCEL_ENV. A remote source still needs the same
  // explicit identity/project binding as the deployed application.
  const hosted = Boolean(env.VERCEL_ENV || identity || !local)
  if (hosted) {
    if (
      (identity !== "production" && identity !== "staging") ||
      !/^[a-z0-9]{20}$/.test(productionRef ?? "")
    )
      throw new Error("archive_environment_not_configured")
    if (identity === "production" && mode !== "required")
      throw new Error("archive_production_requires_retention")
  }
  if (!hosted && local && (mode === "disabled" || !mode)) return null
  if (mode !== "required" && mode !== "disabled")
    throw new Error("archive_mode_not_configured")
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname)
  if (
    !match ||
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search ||
    parsed.hash ||
    (mode === "required" && match[1] !== env.MEDIA_ARCHIVE_SOURCE_PROJECT_REF)
  )
    throw new Error("archive_source_project_mismatch")
  if (hosted && (identity === "production") !== (match[1] === productionRef))
    throw new Error("archive_environment_project_mismatch")
  if (mode === "disabled") return null
  const accountId = env.MEDIA_ARCHIVE_R2_ACCOUNT_ID ?? ""
  const bucket = env.MEDIA_ARCHIVE_R2_BUCKET ?? ""
  const accessKeyId = env.MEDIA_ARCHIVE_R2_ACCESS_KEY_ID ?? ""
  const secretAccessKey = env.MEDIA_ARCHIVE_R2_SECRET_ACCESS_KEY ?? ""
  const sourceServiceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  if (
    !/^[a-f0-9]{32}$/.test(accountId) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
    !accessKeyId ||
    !secretAccessKey ||
    !sourceServiceKey
  )
    throw new Error("archive_credentials_not_configured")
  return {
    sourceUrl: parsed.origin,
    sourceProjectRef: match[1],
    sourceServiceKey,
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey,
  }
}
