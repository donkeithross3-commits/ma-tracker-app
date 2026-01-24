"use client";

import { useIBConnection } from "./IBConnectionContext";

export default function IBConnectionStatus() {
  const { isConnected, isChecking, checkConnection } = useIBConnection();

  if (isChecking) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse"></div>
        <span>Checking IB connection...</span>
      </div>
    );
  }

  return (
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
    </div>
  );
}

