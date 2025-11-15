/**
 * Shared date formatting utilities for consistent display across the app
 */

/**
 * Format a date string to include both date and time in a compact format
 * Example: "Nov 14, 2025, 08:05 AM"
 */
export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return "Unknown";

  // Ensure UTC timezone marker
  const utcDateString = dateString.endsWith('Z') ? dateString : dateString + 'Z';

  return new Date(utcDateString).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format just the date portion (no time)
 * Example: "Nov 14, 2025"
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "Unknown";

  const utcDateString = dateString.endsWith('Z') ? dateString : dateString + 'Z';

  return new Date(utcDateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
