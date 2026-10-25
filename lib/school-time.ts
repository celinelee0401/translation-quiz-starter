import { schoolConfig } from '../school.config.ts';

export const schoolTimeZone: string = schoolConfig.timeZone;

const localFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: schoolTimeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

/** Formats a date as `YYYY-MM-DDTHH:mm` in the school's time zone. */
export function toSchoolLocal(date: Date): string {
  return localFormat.format(date).replace(' ', 'T');
}

/**
 * Converts a `YYYY-MM-DDTHH:mm` wall-clock time in the school's time zone to an
 * instant. Returns null for times that do not exist (for example in a DST gap).
 */
export function fromSchoolLocal(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let instant = wall;
  // Two passes settle the offset, including around daylight-saving changes.
  for (let pass = 0; pass < 2; pass++) {
    const shown = fromParts(toSchoolLocal(new Date(instant)));
    instant += wall - shown;
  }
  const date = new Date(instant);
  return toSchoolLocal(date) === value ? date : null;
}

function fromParts(local: string): number {
  const [datePart, timePart] = local.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h, mi);
}
