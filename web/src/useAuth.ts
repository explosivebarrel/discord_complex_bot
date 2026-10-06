import { useEffect, useState } from "react";
import { api, Me } from "./api";

export function useAuth() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch((e: Error) => {
        if (e.message !== "unauthorized") setError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);

  return { me, loading, error };
}
