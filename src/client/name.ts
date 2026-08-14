/**
 * URL-derived kebab-case skill name (pure, browser-safe).
 */

/** Kebab-case name for a URL import (derived from the URL's last path segment). */
export function nameFromUrl(url: string): string {
  const cleaned = url.split(/[?#]/)[0]?.replace(/\/+$/, '') ?? ''
  const segment = cleaned.split('/').filter(Boolean).pop() ?? 'skill'
  const base = segment.replace(/\.md$/i, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return base.toLowerCase() || 'skill'
}
