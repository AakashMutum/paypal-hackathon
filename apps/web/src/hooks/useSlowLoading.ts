import { useEffect, useState } from 'react';

/** True once loading has lasted longer than delayMs. Used for the "waking up the server" note. */
export function useSlowLoading(loading: boolean, delayMs = 3000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), delayMs);
    return () => window.clearTimeout(t);
  }, [loading, delayMs]);
  return slow;
}
