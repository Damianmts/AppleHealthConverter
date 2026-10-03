/** Returns a 28-calendar-day inclusive range: end date plus the preceding 27 dates. */
export function getStartDateFor28DayWindow(endDate: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime()) || toDateInputValue(date) !== endDate) return undefined;
  date.setDate(date.getDate() - 27);
  return toDateInputValue(date);
}

export function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
