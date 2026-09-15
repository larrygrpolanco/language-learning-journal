/** Date and count formatting. One place, so the kicker and the timeline never disagree. */

const DAY_MS = 86_400_000

/** "Fri 12 Sep". Used in the kicker strip and on the timeline's dated rules. */
export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })

/** "Friday 12 September 2026". Entry detail. */
export const longDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

const startOfLocalDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/**
 * "today", "yesterday", "3 days ago", "5 weeks ago".
 *
 * Counts calendar days rather than elapsed hours, so something written last night at 23:00 reads as
 * yesterday this morning rather than as today.
 */
export const relativeDay = (iso: string, now: Date = new Date()): string => {
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(new Date(iso))) / DAY_MS)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'last week'
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return `${Math.round(days / 30)} months ago`
}

/** "3 entries", "1 entry". */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`

/**
 * "11th", "2nd".
 *
 * Only used where an encounter count reads as prose rather than as a number: the re-encounter line in
 * quick add, the same line on the capture chip, and Extract's "already in this notebook · 11th time".
 */
export const ordinalWord = (n: number): string => {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? 'th'
      : n % 10 === 1
        ? 'st'
        : n % 10 === 2
          ? 'nd'
          : n % 10 === 3
            ? 'rd'
            : 'th'
  return `${n}${suffix}`
}

/** Same-day check against the local calendar, for "today's entry" in the UI. */
export const isToday = (iso: string, now: Date = new Date()): boolean =>
  startOfLocalDay(new Date(iso)) === startOfLocalDay(now)
