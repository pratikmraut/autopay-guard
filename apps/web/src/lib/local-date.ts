export function todayInTimeZone(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts
      .filter(({ type }) => ["year", "month", "day"].includes(type))
      .map(({ type, value: partValue }) => [type, partValue]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

export function addLocalDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day + days));
  return toIsoDate(instant);
}

export function monthRange(yearMonth: string) {
  const [year, month] = yearMonth.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  return { from: toIsoDate(first), to: toIsoDate(last) };
}

export function addLocalMonths(yearMonth: string, offset: number) {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return toIsoDate(date).slice(0, 7);
}

export function formatLocalDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatYearMonth(yearMonth: string) {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function calendarWeeks(yearMonth: string) {
  const { from, to } = monthRange(yearMonth);
  const firstWeekday = weekdayMondayFirst(from);
  const cells: Array<string | null> = Array.from(
    { length: firstWeekday },
    () => null,
  );
  let cursor = from;
  while (cursor <= to) {
    cells.push(cursor);
    cursor = addLocalDays(cursor, 1);
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  const weeks: Array<Array<string | null>> = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

function weekdayMondayFirst(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (sundayFirst + 6) % 7;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
