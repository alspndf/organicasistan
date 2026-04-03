/**
 * Cron job utility — provides helpers used by API routes.
 * Actual scheduling is done via cron-runner.mjs (run alongside `next start`).
 * See /cron-runner.mjs at project root.
 */

export function isCronAuthorized(req: Request): boolean {
  const secret = req.headers.get('x-cron-secret')
  if (!process.env.CRON_SECRET) return true // no secret configured = allow all
  return secret === process.env.CRON_SECRET
}
