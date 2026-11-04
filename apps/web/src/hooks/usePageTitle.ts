import { useEffect } from 'react';

/** Sets document.title for a screen: "Scan · TrustOra". */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · TrustOra` : 'TrustOra';
  }, [title]);
}
