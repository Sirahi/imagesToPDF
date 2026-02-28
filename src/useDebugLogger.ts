import { useCallback, useEffect, useState } from 'react';

export type DebugEntry = {
  id: string;
  timestamp: string;
  message: string;
};

const createId = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const DEBUG_FEATURE_ENABLED = import.meta.env.DEV;

export const useDebugLogger = () => {
  const [showDebug, setShowDebug] = useState(false);
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);

  const appendDebug = useCallback((message: string) => {
    if (!DEBUG_FEATURE_ENABLED) {
      return;
    }

    setDebugEntries((current) => {
      const next: DebugEntry = {
        id: createId(),
        timestamp: new Date().toISOString(),
        message
      };
      return [next, ...current].slice(0, 30);
    });
  }, []);

  const clearDebug = useCallback(() => {
    setDebugEntries([]);
  }, []);

  useEffect(() => {
    if (!DEBUG_FEATURE_ENABLED) {
      return;
    }

    const onWindowError = (event: ErrorEvent) => {
      appendDebug(`window.onerror: ${event.message}`);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      appendDebug(`unhandledrejection: ${message}`);
    };

    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [appendDebug]);

  return {
    debugEnabled: DEBUG_FEATURE_ENABLED,
    showDebug,
    setShowDebug,
    debugEntries,
    appendDebug,
    clearDebug
  };
};
