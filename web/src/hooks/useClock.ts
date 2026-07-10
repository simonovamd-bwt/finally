import { useEffect, useState } from 'react';

/** A ticking wall-clock string (UTC) for the Status Bar. */
export function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now.toISOString().slice(11, 19) + ' UTC';
}
