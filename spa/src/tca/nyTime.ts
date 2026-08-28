/**
 * New York wall-clock helpers.
 *
 * Everything in this app is UTC, but the settlement instants the Allianz report
 * targets are defined in New York local time — and 15:00 NY is 19:00 UTC in
 * summer but 20:00 UTC in winter. Getting this wrong shifts every benchmark by
 * an hour for half the year, so the conversion is done properly rather than with
 * a fixed offset.
 *
 * No new dependency: Intl carries the full IANA database, so
 * `timeZone: "America/New_York"` gives the correct offset for any instant,
 * including across DST transitions.
 */

const NY_TZ = "America/New_York";

const NY_DATE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The NY wall-clock reading at a given instant. */
function nyWallClockAt(d: Date): WallClock {
  const parts = NY_DATE_PARTS.formatToParts(d);
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // hour12:false yields "24" for midnight in some ICU versions.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * NY's UTC offset at a given instant, in milliseconds (negative — NY is behind
 * UTC). Derived by asking what NY wall-clock time the instant shows and
 * comparing that reading, read as if it were UTC, against the instant itself.
 */
function nyOffsetMsAt(d: Date): number {
  const w = nyWallClockAt(d);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asIfUtc - d.getTime();
}

/** NY calendar date for an instant, as "YYYY-MM-DD". */
export function nyDateOf(d: Date): string {
  const w = nyWallClockAt(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${p(w.month)}-${p(w.day)}`;
}

/**
 * The UTC instant of a NY wall-clock time on a given NY calendar date.
 *
 *   nyWallClockToUtc("2026-07-15", 15, 0) -> 2026-07-15T19:00:00Z  (EDT)
 *   nyWallClockToUtc("2026-01-15", 15, 0) -> 2026-01-15T20:00:00Z  (EST)
 *
 * Two passes: the first uses the offset at the naive instant, the second
 * re-checks it at the corrected instant. They differ only within an hour of a
 * DST transition, which is exactly where a single pass would be wrong.
 *
 * Returns null for an unparseable date string rather than an Invalid Date that
 * would propagate silently.
 */
export function nyWallClockToUtc(
  nyDate: string,
  hour: number,
  minute: number,
): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nyDate.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const firstOffset = nyOffsetMsAt(new Date(naive));
  let utcMs = naive - firstOffset;

  const secondOffset = nyOffsetMsAt(new Date(utcMs));
  if (secondOffset !== firstOffset) utcMs = naive - secondOffset;

  return new Date(utcMs);
}
