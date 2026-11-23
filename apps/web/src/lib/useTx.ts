"use client";

import { useCallback, useState } from "react";
import { errMsg } from "./format";
import { explainWindowError, quantumSupported } from "./quantum";

/** Run one wallet action at a time with pending / error / done state. */
export function useTx() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>, after?: () => unknown): Promise<T | undefined> => {
    setPending(label);
    setError(null);
    setDone(null);
    try {
      const out = await fn();
      setDone(label);
      await after?.();
      return out;
    } catch (e) {
      const hint = quantumSupported ? await explainWindowError(e).catch(() => null) : null;
      setError(hint ?? errMsg(e));
      return undefined;
    } finally {
      setPending(null);
    }
  }, []);

  return { pending, error, done, run, clear: () => (setError(null), setDone(null)) };
}
