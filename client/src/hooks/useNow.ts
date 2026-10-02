import { useEffect, useState } from 'react';

// The current time, refreshed every minute, so pages that depend on "now" (the next
// hearing, today's hearings) stay correct while they are left open.
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
