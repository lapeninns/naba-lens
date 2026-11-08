import { SessionGuardHost } from "@/components/nabalens/session-guard-host"
import { requireActiveAdmin } from "@/lib/auth"
import { getLoginCaptchaConfig } from "@/lib/auth/captcha"

/**
 * Early role gate for every /admin page. It runs outside the segment's
 * loading.tsx Suspense boundary, so a staff, inactive or profile-less request is
 * answered with a real 307 before any HTML streams (inside the boundary,
 * redirect() can only send 200 plus a client-side redirect).
 *
 * Not the authorisation boundary: layouts do not re-render on client
 * navigation, so each page, Server Function and Route Handler still calls
 * lib/auth itself. An ended session is met in place (Sign in again over the
 * page) rather than by losing the page.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireActiveAdmin()
  const captcha = getLoginCaptchaConfig()
  return (
    <SessionGuardHost
      captchaRequired={captcha.enabled}
      captchaSiteKey={captcha.siteKey}
    >
      {children}
    </SessionGuardHost>
  )
}
