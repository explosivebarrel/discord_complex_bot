import { useCallback, useState } from "react";

/** A string UI preference persisted in localStorage. */
export function useLocalPrefValue(key: string, initial: string): [string, (v: string) => void] {
  const [value, setValue] = useState<string>(() => {
    try {
      return window.localStorage.getItem(key) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: string) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, v);
      } catch {
        // Private mode or storage quota: the preference just is not persisted.
      }
    },
    [key],
  );
  return [value, set];
}
