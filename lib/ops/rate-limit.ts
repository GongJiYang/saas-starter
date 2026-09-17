type Counter = { startedAt: number; count: number };
const counters = new Map<string, Counter>();

export function consumeRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const current = counters.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    counters.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}
