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

interface AgentKey {
  key: string;
  createdAt: string;
  lastUsed: string | null;
}

export default function IBConnectionStatus() {
  const { isConnected, isChecking, checkConnection } = useIBConnection();
  const [futuresQuote, setFuturesQuote] = useState<FuturesQuote | null>(null);
  const [isFetchingFutures, setIsFetchingFutures] = useState(false);
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [agentKey, setAgentKey] = useState<AgentKey | null>(null);
  const [isLoadingKey, setIsLoadingKey] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

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

  const fetchAgentKey = async () => {
    setIsLoadingKey(true);
    setKeyError(null);
    try {
      const response = await fetch("/api/ma-options/agent-key");
      if (!response.ok) throw new Error("Failed to fetch key");
      const data = await response.json();
      setAgentKey(data);
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : "Failed to load key");
    } finally {
      setIsLoadingKey(false);
    }
  };

  const regenerateKey = async () => {
    if (!confirm("Regenerate API key? This will disconnect any active agents.")) {
      return;
    }
    setIsLoadingKey(true);
    setKeyError(null);
    try {
      const response = await fetch("/api/ma-options/agent-key", { method: "POST" });
      if (!response.ok) throw new Error("Failed to regenerate key");
      const data = await response.json();
      setAgentKey(data);
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : "Failed to regenerate");
    } finally {
      setIsLoadingKey(false);
    }
  };

  const downloadAgent = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch("/api/ma-options/download-agent");
      if (!response.ok) throw new Error("Download failed");
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ib-data-agent.zip";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Download failed");
    } finally {
      setIsDownloading(false);
    }
  };

  const toggleAgentPanel = () => {
    if (!showAgentPanel && !agentKey) {
      fetchAgentKey();
    }
    setShowAgentPanel(!showAgentPanel);
  };

  const copyKey = () => {
    if (agentKey?.key) {
      navigator.clipboard.writeText(agentKey.key);
      alert("API key copied to clipboard");
    }
  };

  // Show initial loading state only, not during background polling
  const showInitialLoading = isChecking && !futuresQuote;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs">
        <div
          className={`w-2 h-2 rounded-full ${
            isChecking
              ? "bg-gray-500 animate-pulse"
              : isConnected
              ? "bg-green-500"
              : "bg-red-500"
          }`}
          title={isConnected ? "IB TWS connected" : "IB TWS not connected"}
        ></div>
        <span
          className={
            isChecking
              ? "text-gray-400"
              : isConnected
              ? "text-green-400"
              : "text-red-400"
          }
          title={isConnected ? "IB TWS connected" : "IB TWS not connected"}
        >
          {showInitialLoading
            ? "Checking IB connection..."
            : `IB TWS: ${isConnected ? "Connected" : "Disconnected"}`}
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
              <span className="font-medium text-blue-400">
                {futuresQuote.contract}
              </span>
              <span>
                Bid:{" "}
                <span className="text-green-400">
                  {futuresQuote.bid?.toFixed(2)}
                </span>
              </span>
              <span>
                Ask:{" "}
                <span className="text-red-400">
                  {futuresQuote.ask?.toFixed(2)}
                </span>
              </span>
              <span>
                Last:{" "}
                <span className="text-yellow-400">
                  {futuresQuote.last?.toFixed(2)}
                </span>
              </span>
              <span className="text-gray-500 text-[10px]">
                {futuresQuote.timestamp
                  ? new Date(futuresQuote.timestamp).toLocaleTimeString()
                  : ""}
              </span>
            </div>
          ) : (
            <div className="text-red-400 bg-gray-800 rounded px-2 py-1">
              {futuresQuote.error || "Failed to fetch futures quote"}
            </div>
          )}
        </div>
      )}

      {/* Local Agent Section */}
      <div className="mt-2 border-t border-gray-700 pt-2">
        <button
          onClick={toggleAgentPanel}
          className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
        >
          <span>{showAgentPanel ? "▼" : "▶"}</span>
          <span>Use Your Own IB Account</span>
          <span className="ml-1 px-1.5 py-0.5 bg-yellow-600/30 text-yellow-400 rounded text-[9px] font-medium">
            ALPHA
          </span>
        </button>

        {showAgentPanel && (
          <div className="mt-2 bg-gray-800 rounded p-3 text-xs">
            <div className="bg-yellow-900/30 border border-yellow-600/50 rounded px-2 py-1.5 mb-3 text-yellow-300 text-[10px]">
              This feature is under development and in alpha testing (dev team only).
            </div>
            <p className="text-gray-300 mb-3">
              Run a local agent to get market data from your personal IB account.
            </p>

            {/* Download Button */}
            <button
              onClick={downloadAgent}
              disabled={isDownloading}
              className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded mb-3 disabled:opacity-50"
            >
              {isDownloading ? "Downloading..." : "Download Local Agent"}
            </button>

            {/* API Key Section */}
            <div className="border-t border-gray-700 pt-2 mt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-400">Your API Key:</span>
                <button
                  onClick={regenerateKey}
                  disabled={isLoadingKey}
                  className="text-yellow-500 hover:text-yellow-400 text-[10px]"
                >
                  {isLoadingKey ? "..." : "Regenerate"}
                </button>
              </div>
              
              {keyError && (
                <div className="text-red-400 text-[10px] mb-2">{keyError}</div>
              )}
              
              {isLoadingKey ? (
                <div className="text-gray-500">Loading...</div>
              ) : agentKey ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-900 px-2 py-1 rounded font-mono text-[10px] text-gray-300 truncate">
                    {agentKey.key.slice(0, 8)}...{agentKey.key.slice(-8)}
                  </code>
                  <button
                    onClick={copyKey}
                    className="text-gray-400 hover:text-white px-1"
                    title="Copy full key"
                  >
                    📋
                  </button>
                </div>
              ) : null}
              
              {agentKey?.lastUsed && (
                <div className="text-gray-500 text-[10px] mt-1">
                  Last used: {new Date(agentKey.lastUsed).toLocaleString()}
                </div>
              )}
            </div>

            {/* Setup Instructions */}
            <div className="border-t border-gray-700 pt-2 mt-3">
              <div className="text-gray-400 mb-1">Quick Setup:</div>
              <ol className="text-gray-500 text-[10px] list-decimal list-inside space-y-1">
                <li>Download and extract the agent ZIP</li>
                <li>Run <code className="bg-gray-900 px-1">python install.py</code></li>
                <li>Start IB TWS (port 7497)</li>
                <li>Run <code className="bg-gray-900 px-1">start_windows.bat</code> or <code className="bg-gray-900 px-1">./start_unix.sh</code></li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

