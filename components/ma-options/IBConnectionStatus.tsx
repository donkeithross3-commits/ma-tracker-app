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
  delayed?: boolean;
  timestamp?: string;
  price_source?: string;
  last_trade_ts?: string;
  quote_ts?: string;
  error?: string;
}

export default function IBConnectionStatus() {
  const {
    isConnected, isChecking, lastMessage, checkConnection, reconnectIB, isReconnecting,
    agentOnline, agentVersion,
    gatewayRunning, isGatewayLoading, stopGateway, startGateway,
    restartAgent, isAgentRestarting,
  } = useIBConnection();
  const [futuresQuote, setFuturesQuote] = useState<FuturesQuote | null>(null);
  const [isFetchingFutures, setIsFetchingFutures] = useState(false);
  const [polygonQuote, setPolygonQuote] = useState<FuturesQuote | null>(null);
  const [isFetchingPolygon, setIsFetchingPolygon] = useState(false);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Gateway stop confirmation
  const [confirmingStop, setConfirmingStop] = useState(false);

  const testFuturesQuote = async () => {
    setIsFetchingFutures(true);
    setFuturesQuote(null);
    try {
      const response = await fetch("/api/ib-connection/test-futures", {
        credentials: "include",
      });
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

  const testPolygonQuote = async () => {
    setIsFetchingPolygon(true);
    setPolygonQuote(null);
    try {
      const response = await fetch("/api/ma-options/test-polygon-quote", {
        credentials: "include",
      });
      const data = await response.json();
      setPolygonQuote(data);
    } catch (error) {
      setPolygonQuote({
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch",
      });
    } finally {
      setIsFetchingPolygon(false);
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

  const handleStopGateway = async () => {
    if (!confirmingStop) {
      setConfirmingStop(true);
      // Auto-dismiss confirmation after 5s
      setTimeout(() => setConfirmingStop(false), 5000);
      return;
    }
    setConfirmingStop(false);
    await stopGateway();
  };

  const handleStartGateway = async () => {
    await startGateway();
  };

  const handleRestartAgent = async () => {
    await restartAgent();
  };

  // Show initial loading state only, not during background polling
  const showInitialLoading = isChecking && !futuresQuote;

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        {/* Top row: Connection status, quote data, test button */}
        <div className="flex items-center gap-2 text-xs">
          <div
            className={`w-2 h-2 rounded-full ${
              isChecking
                ? "bg-gray-500 animate-pulse"
                : isConnected
                ? "bg-green-500"
                : "bg-red-500"
            }`}
            title={isConnected ? "IB TWS connected" : lastMessage || "IB TWS not connected"}
          ></div>
          <span
            className={
              isChecking
                ? "text-gray-400"
                : isConnected
                ? "text-green-400"
                : "text-red-400"
            }
            title={isConnected ? "IB TWS connected" : lastMessage || "IB TWS not connected"}
          >
            {showInitialLoading
              ? "Checking..."
              : `IB TWS: ${isConnected ? "Connected" : "Disconnected"}`}
          </span>
          <button
            onClick={() => checkConnection()}
            className="text-gray-500 hover:text-gray-300"
            title="Refresh IB connection status"
            disabled={isChecking}
          >
            {isChecking ? "..." : "↻"}
          </button>

          {/* Reconnect button: always visible. Amber when disconnected, gray when connected (force mode) */}
          {!isChecking && (
            <button
              onClick={() => reconnectIB(isConnected)}
              disabled={isReconnecting}
              className={`px-2 py-0.5 rounded text-xs disabled:opacity-50 ${
                isConnected
                  ? "bg-gray-700 hover:bg-gray-600 text-gray-300"
                  : "bg-amber-700 hover:bg-amber-600 text-amber-100"
              }`}
              title={isConnected ? "Force disconnect and reconnect to IB" : "Trigger IB reconnect on the agent"}
            >
              {isReconnecting ? "Reconnecting..." : isConnected ? "Force Reconnect" : "Reconnect IB"}
            </button>
          )}

          {isConnected && (
            <button
              onClick={testFuturesQuote}
              disabled={isFetchingFutures}
              className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs disabled:opacity-50"
              title="Test IB connection by fetching ES futures quote"
            >
              {isFetchingFutures ? "..." : "IB: Test ES"}
            </button>
          )}

          {/* ES Quote inline when available */}
          {futuresQuote && futuresQuote.success && (
            <div className="flex items-center gap-2 text-gray-300 bg-gray-800 rounded px-2 py-0.5 text-[11px]">
              <span className="font-medium text-blue-400">{futuresQuote.contract}</span>
              {futuresQuote.delayed && (
                <span className="text-amber-400/90 text-[10px]" title="Account has delayed, not real-time, CME data">(Delayed)</span>
              )}
              <span>Bid: <span className="text-green-400">{futuresQuote.bid?.toFixed(2)}</span></span>
              <span>Ask: <span className="text-red-400">{futuresQuote.ask?.toFixed(2)}</span></span>
              <span>Last: <span className="text-yellow-400">{futuresQuote.last?.toFixed(2)}</span></span>
              <span className="text-gray-500 text-[10px]">
                {futuresQuote.timestamp ? new Date(futuresQuote.timestamp).toLocaleTimeString() : ""}
              </span>
            </div>
          )}

          {/* ES Error inline */}
          {futuresQuote && !futuresQuote.success && (
            <span className="text-red-400 text-[10px]">
              {futuresQuote.error || "Quote failed"}
            </span>
          )}

          <button
            onClick={testPolygonQuote}
            disabled={isFetchingPolygon}
            className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs disabled:opacity-50"
            title="Test Polygon connectivity by fetching SPY quote"
          >
            {isFetchingPolygon ? "..." : "Polygon: Test SPY"}
          </button>

          {/* SPY Polygon Quote inline when available */}
          {polygonQuote && polygonQuote.success && (
            <div className="flex items-center gap-2 text-gray-300 bg-gray-800 rounded px-2 py-0.5 text-[11px]">
              <span className="font-medium text-blue-400">SPY</span>
              <span>Bid: <span className="text-green-400">{polygonQuote.bid?.toFixed(2)}</span></span>
              <span>Ask: <span className="text-red-400">{polygonQuote.ask?.toFixed(2)}</span></span>
              <span>Last: <span className="text-yellow-400">{polygonQuote.last?.toFixed(2)}</span></span>
              {polygonQuote.price_source && (
                <span className="text-gray-400 text-[10px]">[{polygonQuote.price_source}]</span>
              )}
              <span className="text-gray-500 text-[10px]">
                {polygonQuote.last_trade_ts
                  ? new Date(polygonQuote.last_trade_ts).toLocaleTimeString()
                  : polygonQuote.quote_ts
                    ? new Date(polygonQuote.quote_ts).toLocaleTimeString()
                    : polygonQuote.timestamp
                      ? new Date(polygonQuote.timestamp).toLocaleTimeString()
                      : ""}
              </span>
            </div>
          )}

          {/* Polygon Error inline */}
          {polygonQuote && !polygonQuote.success && (
            <span className="text-red-400 text-[10px]">
              {polygonQuote.error || "Polygon quote failed"}
            </span>
          )}
        </div>

        {/* Second row: Infrastructure controls */}
        <div className="flex items-center gap-2 text-xs">
          {/* Gateway status indicator */}
          <div className="flex items-center gap-1.5">
            <div
              className={`w-2 h-2 rounded-full ${
                gatewayRunning === null
                  ? "bg-gray-600"
                  : gatewayRunning
                  ? "bg-green-500"
                  : "bg-red-500"
              }`}
              title={
                gatewayRunning === null
                  ? "Gateway status unknown"
                  : gatewayRunning
                  ? "IB Gateway running"
                  : "IB Gateway stopped"
              }
            />
            <span
              className={
                gatewayRunning === null
                  ? "text-gray-500"
                  : gatewayRunning
                  ? "text-green-400"
                  : "text-red-400"
              }
            >
              Gateway: {gatewayRunning === null ? "..." : gatewayRunning ? "Running" : "Stopped"}
            </span>
          </div>

          {/* Stop/Start Gateway */}
          {gatewayRunning === true && (
            <button
              onClick={handleStopGateway}
              disabled={isGatewayLoading}
              className={`px-2 py-0.5 rounded text-xs disabled:opacity-50 ${
                confirmingStop
                  ? "bg-red-600 hover:bg-red-500 text-white animate-pulse"
                  : "bg-red-900/60 hover:bg-red-800/60 text-red-300"
              }`}
              title="Stop IB Gateway — releases IB session so IBKR Mobile can connect"
            >
              {isGatewayLoading ? "Stopping..." : confirmingStop ? "Confirm Stop" : "Stop Gateway"}
            </button>
          )}

          {gatewayRunning === false && (
            <button
              onClick={handleStartGateway}
              disabled={isGatewayLoading}
              className="px-2 py-0.5 bg-green-900/60 hover:bg-green-800/60 text-green-300 rounded text-xs disabled:opacity-50"
              title="Start IB Gateway — re-enables automated IB connection"
            >
              {isGatewayLoading ? "Starting..." : "Start Gateway"}
            </button>
          )}

          {/* Separator */}
          <span className="text-gray-700">|</span>

          {/* Agent online status indicator */}
          <div className="flex items-center gap-1.5">
            <div
              className={`w-2 h-2 rounded-full ${
                isAgentRestarting
                  ? "bg-amber-500 animate-pulse"
                  : agentOnline === null
                  ? "bg-gray-600"
                  : agentOnline
                  ? "bg-green-500"
                  : "bg-red-500"
              }`}
              title={
                isAgentRestarting
                  ? "Agent restarting..."
                  : agentOnline === null
                  ? "Agent status unknown"
                  : agentOnline
                  ? "Trading agent connected to relay"
                  : "Trading agent offline"
              }
            />
            <span
              className={
                isAgentRestarting
                  ? "text-amber-400"
                  : agentOnline === null
                  ? "text-gray-500"
                  : agentOnline
                  ? "text-green-400"
                  : "text-red-400"
              }
            >
              Agent: {isAgentRestarting ? "Restarting..." : agentOnline === null ? "..." : agentOnline ? `Online${agentVersion ? ` v${agentVersion}` : ""}` : "Offline"}
            </span>
          </div>

          {/* Restart Agent */}
          <button
            onClick={handleRestartAgent}
            disabled={isAgentRestarting}
            className="px-2 py-0.5 bg-amber-900/50 hover:bg-amber-800/50 text-amber-300 rounded text-xs disabled:opacity-50"
            title="Restart trading agent process — systemd brings it back in ~10s"
          >
            {isAgentRestarting ? "Restarting..." : "Restart Agent"}
          </button>

          {/* Separator */}
          <span className="text-gray-700">|</span>

          {/* Local Agent download button */}
          <button
            onClick={() => setShowAgentModal(true)}
            className="text-gray-500 hover:text-gray-300 flex items-center gap-1"
          >
            <span>▶</span>
            <span>Local Agent</span>
            <span className="ml-0.5 px-1 py-0 bg-yellow-600/30 text-yellow-400 rounded text-[9px] font-medium">
              ALPHA
            </span>
          </button>
        </div>
      </div>

      {/* Modal */}
      {showAgentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowAgentModal(false)}
          />

          {/* Modal content */}
          <div className="relative bg-gray-900 border border-gray-700 rounded-lg p-5 max-w-md w-full mx-4 shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-100">
                Use Your Own IB Account
              </h3>
              <button
                onClick={() => setShowAgentModal(false)}
                className="text-gray-400 hover:text-gray-200 text-xl leading-none"
              >
                ×
              </button>
            </div>

            {/* Alpha warning */}
            <div className="bg-yellow-900/30 border border-yellow-600/50 rounded px-3 py-2 mb-4 text-yellow-300 text-sm">
              This feature is under development and in alpha testing (dev team only).
            </div>

            {/* Description */}
            <p className="text-gray-300 text-sm mb-4">
              Run a local agent on your computer to get real-time market data from your personal Interactive Brokers account.
            </p>

            {/* Download Button */}
            <button
              onClick={downloadAgent}
              disabled={isDownloading}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium mb-4 disabled:opacity-50"
            >
              {isDownloading ? "Downloading..." : "Download Local Agent"}
            </button>

            {/* Setup Instructions */}
            <div className="border-t border-gray-700 pt-4">
              <div className="text-gray-300 font-medium mb-2 text-sm">Quick Setup:</div>
              <ol className="text-gray-400 text-sm list-decimal list-inside space-y-1.5">
                <li>Download and extract the ZIP file</li>
                <li>Start IB TWS/Gateway (enable API on port 7497)</li>
                <li>
                  Run <code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs">start_windows.bat</code> (Win) or <code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs">./start_unix.sh</code> (Mac/Linux)
                </li>
              </ol>
              <div className="text-green-400 text-sm mt-3">
                ✓ Your API key is pre-configured in the download
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
