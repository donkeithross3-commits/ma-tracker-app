/**
 * Single source of truth for email whitelist (used by seed script and admin API).
 * Format: "Alias: XYZ" in notes allows auto-provisioning with that alias.
 */
export const WHITELIST_ENTRIES = [
  { email: "don@limitlessventures.us", alias: "DR3" },
  { email: "don.keith.ross3@gmail.com", alias: "DR3_dev" },
  { email: "keith@unrival.network", alias: "KRJ" },
  { email: "luis@limitlessventures.us", alias: "LVS" },
  { email: "alexander@limitlessventures.us", alias: "ASH" },
  { email: "dmartensen@myvbu.com", alias: "DOM" },
  { email: "dr79.cipriano@gmail.com", alias: "DRC" },
];
