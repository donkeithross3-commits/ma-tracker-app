"use client";

import { useState } from "react";
import { useIBConnection } from "./IBConnectionContext";

interface FuturesQuote {
  success: boolean;
  contract?: string;
  bid?: number;
  ask?: number;
  last?: number;
  mid?: number;
  timestamp?: string;
  error?: string;
}

export default function IBConnectionStatus() {
  const { isConnected, isChecking, checkConnection } = useIBConnection();
  const [futuresQuote, setFuturesQuote] = useState<FuturesQuote | null>(null);
  const [isFetchingFutures, setIsFetchingFutures] = useState(false);

  const testFuturesQuote = async () => {
    setIsFetchingFutures(true);
    setFuturesQuote(null);
    try {
      const response = await fetch("/api/ib-connection/test-futures");
      const data = await response.json();
      setFuturesQuote(data);
    } catch (error) {
      setFuturesQuote({
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch",
      });
    } finally {
      setIsFetchingFutures(false);
    }
  };

  if (isChecking) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse"></div>
        <span>Checking IB connection...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs">
        <div
          className={`w-2 h-2 rounded-full ${
            isConnected ? "bg-green-500" : "bg-red-500"
          }`}
          title={isConnected ? "IB TWS connected" : "IB TWS not connected"}
        ></div>
        <span
          className={isConnected ? "text-green-400" : "text-red-400"}
          title={isConnected ? "IB TWS connected" : "IB TWS not connected"}
        >
          IB TWS: {isConnected ? "Connected" : "Disconnected"}
        </span>
        <button
          onClick={() => checkConnection()}
          className="text-gray-500 hover:text-gray-300 ml-1"
          title="Force reconnect to IB TWS"
          disabled={isChecking}
        >
          {isChecking ? "..." : "↻"}
        </button>
        {isConnected && (
          <button
            onClick={testFuturesQuote}
            disabled={isFetchingFutures}
            className="ml-2 px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs disabled:opacity-50"
            title="Test connection by fetching ES futures quote"
          >
            {isFetchingFutures ? "Testing..." : "Test ES Quote"}
          </button>
        )}
      </div>
      
      {futuresQuote && (
        <div className="text-xs ml-4 mt-1">
          {futuresQuote.success ? (
            <div className="flex items-center gap-3 text-gray-300 bg-gray-800 rounded px-2 py-1">
              <span className="font-medium text-blue-400">{futuresQuote.contract}</span>
              <span>Bid: <span className="text-green-400">{futuresQuote.bid?.toFixed(2)}</span></span>
              <span>Ask: <span className="text-red-400">{futuresQuote.ask?.toFixed(2)}</span></span>
              <span>Last: <span className="text-yellow-400">{futuresQuote.last?.toFixed(2)}</span></span>
              <span className="text-gray-500 text-[10px]">
                {futuresQuote.timestamp ? new Date(futuresQuote.timestamp).toLocaleTimeString() : ""}
              </span>
            </div>
          ) : (
            <div className="text-red-400 bg-gray-800 rounded px-2 py-1">
              {futuresQuote.error || "Failed to fetch futures quote"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

