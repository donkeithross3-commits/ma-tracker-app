// ---------------------------------------------------------------------------
// Admin identity helper (Edge-compatible — no Prisma/Node imports)
// ---------------------------------------------------------------------------

export const ADMIN_EMAIL = "don.keith.ross3@gmail.com"

export function isAdmin(email: string | null | undefined): boolean {
  return email === ADMIN_EMAIL
}
