/**
 * Per-user IB account exclusion config.
 *
 * Maps dashboard user IDs to IB account codes that should be hidden
 * from positions and orders. Used when a user's TWS shows sub-accounts
 * they don't want in the dashboard (e.g. advisor-managed accounts).
 */

// KRJ user: exclude managed account, keep personal U127613
const EXCLUDED_ACCOUNTS_BY_USER: Record<string, Set<string>> = {
  "e864fcde-e2f5-4f8b-87f2-ee9811ecc652": new Set(["U22621569"]),
};

/**
 * Filter an array of position or order objects, removing any whose
 * `account` field is in the user's exclusion set.
 * Returns the array unchanged if no exclusions are configured.
 */
export function filterByAccount<T extends { account?: string }>(
  userId: string,
  items: T[]
): T[] {
  const excluded = EXCLUDED_ACCOUNTS_BY_USER[userId];
  if (!excluded) return items;
  return items.filter((item) => !excluded.has(item.account ?? ""));
}
