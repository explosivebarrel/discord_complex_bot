import { useCallback, useState } from "react";

/** A boolean UI preference persisted in localStorage ("1"/"0"). */
export function useLocalPref(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : raw === "1";
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, v ? "1" : "0");
      } catch {
        // Private mode or storage quota: the preference just is not persisted.
      }
    },
    [key],
  );
  return [value, set];
}
