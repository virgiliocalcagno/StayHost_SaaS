import { useEffect, useState } from "react";

export function useCopyFeedback(timeoutMs = 1500) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!copiedKey) return;
    const id = setTimeout(() => setCopiedKey(null), timeoutMs);
    return () => clearTimeout(id);
  }, [copiedKey, timeoutMs]);

  const copy = (value: string, key: string) => {
    if (!value) return;
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedKey(key);
  };

  return { copiedKey, copy };
}
