"use client";

import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from "react";

interface IBConnectionContextType {
  isConnected: boolean;
  isChecking: boolean;
  lastChecked: Date | null;
  lastMessage?: string; // From status API (e.g. relay error when disconnected)
  checkConnection: () => Promise<void>;
  reconnectIB: (force?: boolean) => Promise<{ success: boolean; message: string }>;
  isReconnecting: boolean;
}

const IBConnectionContext = createContext<IBConnectionContextType | undefined>(undefined);

export function IBConnectionProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [lastMessage, setLastMessage] = useState<string | undefined>(undefined);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const hasInitialized = useRef(false);

  const checkConnection = useCallback(async (forceReconnect: boolean = false) => {
    // Only show "checking" state on initial load or manual refresh
    // Background polling should be silent to avoid UI jitter
    const isInitialLoad = !hasInitialized.current;

    if (isInitialLoad || forceReconnect) {
      setIsChecking(true);
    }

    try {
      // If force reconnect requested, call reconnect endpoint first
      if (forceReconnect) {
        const reconnectResponse = await fetch("/api/ib-connection/reconnect", {
          method: "POST",
        });
        if (reconnectResponse.ok) {
          const data = await reconnectResponse.json();
          setIsConnected(data.connected);
          setLastMessage(data.message);
          setLastChecked(new Date());
          hasInitialized.current = true;
          setIsChecking(false);
          return;
        }
      }

      // Otherwise just check status
      const response = await fetch("/api/ib-connection/status");
      if (response.ok) {
        const data = await response.json();
        setIsConnected(data.connected);
        setLastMessage(data.message ?? data.relayError);
        setLastChecked(new Date());
      } else {
        setIsConnected(false);
        setLastMessage(undefined);
      }
    } catch (error) {
      setIsConnected(false);
      setLastMessage(undefined);
    } finally {
      hasInitialized.current = true;
      setIsChecking(false);
    }
  }, []);

  const reconnectIB = useCallback(async (force: boolean = false): Promise<{ success: boolean; message: string }> => {
    setIsReconnecting(true);
    try {
      const response = await fetch("/api/ib-connection/reconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await response.json();

      // Refresh status after reconnect attempt
      await checkConnection();

      return {
        success: data.success ?? false,
        message: data.message ?? "Unknown result",
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Failed to reconnect",
      };
    } finally {
      setIsReconnecting(false);
    }
  }, [checkConnection]);

  useEffect(() => {
    checkConnection();
    // Check every 15 seconds silently; skip when tab is hidden to save resources
    const interval = setInterval(() => {
      if (!document.hidden) checkConnection(false);
    }, 15_000);
    return () => clearInterval(interval);
  }, [checkConnection]);

  return (
    <IBConnectionContext.Provider value={{ isConnected, isChecking, lastChecked, lastMessage, checkConnection, reconnectIB, isReconnecting }}>
      {children}
    </IBConnectionContext.Provider>
  );
}

export function useIBConnection() {
  const context = useContext(IBConnectionContext);
  if (context === undefined) {
    throw new Error("useIBConnection must be used within IBConnectionProvider");
  }
  return context;
}
