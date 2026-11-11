// Which computer the journal runs on decides the add-on instructions: Windows, or macOS / Linux.
import { useEffect, useState } from 'react';

let cached = null;
const guess = () => (/Win/i.test(navigator.userAgentData?.platform || navigator.platform || '') ? 'windows' : 'unix');

/** 'windows' | 'unix' for the computer running RoninFlow (the browser's own system until the server answers). */
export function useJournalOs() {
  const [os, setOs] = useState(cached || guess());
  useEffect(() => {
    if (cached) return;
    let live = true;
    fetch('/api/system/info').then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j?.platform) return;
      cached = j.platform === 'win32' ? 'windows' : 'unix';
      if (live) setOs(cached);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return os;
}

export const OS_OPTIONS = [{ value: 'windows', label: 'Windows' }, { value: 'unix', label: 'Mac / Linux' }];
