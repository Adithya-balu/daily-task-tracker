/** Compact token count, e.g. 950, 12.3k, 1.2M. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** API-equivalent cost estimate. Team/Pro plans aren't billed per token. */
export function formatUsd(n: number): string {
  if (n === 0) return '$0'
  return n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`
}
