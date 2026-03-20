/**
 * Derive a DNS-safe ENS label from an agent name.
 * e.g. "Bullish Scout #1" -> "bullish-scout-1"
 * Max 40 chars; no leading/trailing hyphens.
 */
export function deriveEnsSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
