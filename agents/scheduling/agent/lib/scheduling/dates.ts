/** Date helpers. HCP timestamps are UTC; the business runs on America/Chicago days. */
export const TZ = "America/Chicago";
export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
const WEEKDAYS: Weekday[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD in Chicago for an ISO timestamp. */
export function localDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

/** Weekday of a YYYY-MM-DD (calendar date, no timezone math needed). */
export function weekdayOf(ymd: string): Weekday {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.UTC(...(fromYmd.split("-").map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]);
  const b = Date.UTC(...(toYmd.split("-").map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]);
  return Math.round((b - a) / 86_400_000);
}

/** The Monday of the week containing ymd. */
export function mondayOf(ymd: string): string {
  const wd = weekdayOf(ymd);
  const back = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[wd];
  return addDays(ymd, -back);
}

/** Mon..Sun of the week starting at monday. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Today's Chicago date; overridable for fixtures/tests via SCHEDULING_TODAY. */
export function today(env: NodeJS.ProcessEnv = process.env): string {
  return env.SCHEDULING_TODAY ?? localDate(new Date().toISOString());
}

/** Hours between two ISO timestamps. */
export function hoursBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000;
}

/** "2026-09-28" + "08:00" in America/Chicago → ISO 8601 with the correct offset for that date (DST-aware). */
export function chicagoIso(ymd: string, hhmm: string): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);
  const offsetMin = chicagoOffsetMinutes(new Date(asUtc));
  const instant = new Date(asUtc - offsetMin * 60_000);
  // Re-check the offset at the actual instant (matters right at a DST switch).
  const offset2 = chicagoOffsetMinutes(instant);
  const final = offset2 === offsetMin ? instant : new Date(asUtc - offset2 * 60_000);
  const sign = offset2 >= 0 ? "+" : "-";
  const abs = Math.abs(offset2);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ymd}T${pad(hh)}:${pad(mm)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}` + (final ? "" : "");
}

/** Minutes east of UTC for America/Chicago at the given instant (-300 CDT, -360 CST). */
export function chicagoOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((local - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}
