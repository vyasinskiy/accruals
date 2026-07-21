/**
 * Converts a local time string ("HH:mm") to a UTC time string ("HH:mm").
 */
export function localTimeToUtc(localTimeStr: string): string {
  if (!localTimeStr) return '10:00';
  const parts = localTimeStr.split(':').map(Number);
  const h = isNaN(parts[0]) ? 10 : parts[0];
  const m = isNaN(parts[1]) ? 0 : parts[1];
  const date = new Date();
  date.setHours(h, m, 0, 0);
  const utcH = String(date.getUTCHours()).padStart(2, '0');
  const utcM = String(date.getUTCMinutes()).padStart(2, '0');
  return `${utcH}:${utcM}`;
}

/**
 * Converts a UTC time string ("HH:mm") to a local time string ("HH:mm").
 */
export function utcTimeToLocal(utcTimeStr: string | null | undefined): string {
  if (!utcTimeStr) return '10:00';
  const parts = utcTimeStr.split(':').map(Number);
  const utcH = isNaN(parts[0]) ? 10 : parts[0];
  const utcM = isNaN(parts[1]) ? 0 : parts[1];
  const date = new Date();
  date.setUTCHours(utcH, utcM, 0, 0);
  const localH = String(date.getHours()).padStart(2, '0');
  const localM = String(date.getMinutes()).padStart(2, '0');
  return `${localH}:${localM}`;
}
