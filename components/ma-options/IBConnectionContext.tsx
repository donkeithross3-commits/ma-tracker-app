"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface IBConnectionContextType {
  isConnected: boolean;
  isChecking: boolean;
  lastChecked: Date | null;
  checkConnection: () => Promise<void>;
}

const IBConnectionContext = createContext<IBConnectionContextType | undefined>(undefined);

export function IBConnectionProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkConnection = async (forceReconnect: boolean = false) => {
    setIsChecking(true);
    try {
      // If force reconnect requested, call reconnect endpoint first
      if (forceReconnect) {
        const reconnectResponse = await fetch("/api/ib-connection/reconnect", {
          method: "POST",
        });
        if (reconnectResponse.ok) {
          const data = await reconnectResponse.json();
          setIsConnected(data.connected);
          setLastChecked(new Date());
          setIsChecking(false);
          return;
        }
      }
      
      // Otherwise just check status
      const response = await fetch("/api/ib-connection/status");
      if (response.ok) {
        const data = await response.json();
        setIsConnected(data.connected);
        setLastChecked(new Date());
      } else {
        setIsConnected(false);
      }
    } catch (error) {
      setIsConnected(false);
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    checkConnection();
    // Check every 10 seconds
    const interval = setInterval(checkConnection, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <IBConnectionContext.Provider value={{ isConnected, isChecking, lastChecked, checkConnection }}>
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

