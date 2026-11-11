/** « 5:30 » → 330 s, « 1:02:00 » → 3720 s, « 12 » → 12 min ; `undefined` si illisible. */
export function parseDuration(text: string): number | undefined {
  const t = text.trim().replace(',', '.');
  if (!t) return undefined;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60);
  const parts = t.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return undefined;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n >= 60)) return undefined;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

/** 330 → « 5:30 », 3720 → « 1:02:00 ». */
export function formatDuration(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
