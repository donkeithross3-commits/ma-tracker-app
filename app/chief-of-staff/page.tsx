"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Send, Bot, Zap, Clock, ChevronDown, ChevronRight } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  specialist?: string;
  escalated?: boolean;
  thinking?: string;
  latency_ms?: number;
  model?: string;
}

interface ActivityEntry {
  timestamp: string;
  message_id: string;
  user_message: string;
  specialist: string;
  escalated: boolean;
  thinking: string;
  response: string;
  confidence: number;
  latency_ms: number;
  model: string;
}

const SPECIALIST_COLORS: Record<string, string> = {
  cos: "bg-gray-500/20 text-gray-300",
  krj_signals: "bg-blue-500/20 text-blue-400",
  deal_intel: "bg-purple-500/20 text-purple-400",
  algo_trading: "bg-green-500/20 text-green-400",
  bmc_research: "bg-amber-500/20 text-amber-400",
  trading_engine: "bg-red-500/20 text-red-400",
  ops: "bg-indigo-500/20 text-indigo-400",
};

function SpecialistBadge({ specialist, escalated }: { specialist: string; escalated?: boolean }) {
  const colors = SPECIALIST_COLORS[specialist] || SPECIALIST_COLORS.cos;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`text-xs px-2 py-0.5 rounded-full ${colors}`}>
        {specialist.replace(/_/g, " ")}
      </span>
      {escalated && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 flex items-center gap-0.5">
          <Zap className="w-3 h-3" /> Opus
        </span>
      )}
    </span>
  );
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);
  if (!thinking) return null;
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-gray-500 hover:text-gray-400 flex items-center gap-1"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        thinking
      </button>
      {open && (
        <pre className="mt-1 text-xs text-gray-500 bg-gray-900 rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
          {thinking}
        </pre>
      )}
    </div>
  );
}

export default function ChiefOfStaffPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Poll activity feed
  useEffect(() => {
    const fetchActivity = async () => {
      try {
        const res = await fetch("/api/cos/activity?limit=20");
        if (res.ok) {
          const data = await res.json();
          setActivity(data.entries || []);
        }
      } catch {
        // silent
      }
    };
    fetchActivity();
    const interval = setInterval(fetchActivity, 30000);
    return () => clearInterval(interval);
  }, []);

  const sendMessage = useCallback(async () => {
    const msg = input.trim();
    if (!msg || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setLoading(true);

    try {
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/cos/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, conversation_history: history }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.response,
            specialist: data.specialist,
            escalated: data.escalated,
            thinking: data.thinking,
            latency_ms: data.latency_ms,
            model: data.model,
          },
        ]);
        // Refresh activity after a response
        try {
          const actRes = await fetch("/api/cos/activity?limit=20");
          if (actRes.ok) {
            const actData = await actRes.json();
            setActivity(actData.entries || []);
          }
        } catch {
          // silent
        }
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${data.error || data.detail || "Unknown error"}`,
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Connection error: ${err instanceof Error ? err.message : "Failed to reach CoS API"}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-200">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-cyan-400" />
            <h1 className="text-lg font-semibold">Chief of Staff</h1>
          </div>
          <span className="text-xs text-gray-500">DeepSeek-R1-32B · Opus escalation</span>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex h-[calc(100vh-49px)]">
        {/* Chat panel — 60% */}
        <div className="w-3/5 flex flex-col border-r border-gray-800">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-gray-600 mt-20">
                <Bot className="w-12 h-12 mx-auto mb-3 text-gray-700" />
                <p className="text-lg">Chief of Staff</p>
                <p className="text-sm mt-1">Ask about deals, signals, fleet, trading, or ops.</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 ${
                    msg.role === "user"
                      ? "bg-cyan-900/30 text-gray-100"
                      : "bg-gray-900 text-gray-200"
                  }`}
                >
                  {msg.role === "assistant" && msg.specialist && (
                    <div className="mb-1 flex items-center gap-2">
                      <SpecialistBadge specialist={msg.specialist} escalated={msg.escalated} />
                      {msg.latency_ms != null && (
                        <span className="text-xs text-gray-600">{msg.latency_ms}ms</span>
                      )}
                    </div>
                  )}
                  <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                  {msg.thinking && <ThinkingBlock thinking={msg.thinking} />}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-900 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <div className="animate-pulse">Thinking...</div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-gray-800 px-4 py-3">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask the Chief of Staff..."
                rows={1}
                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 resize-none focus:outline-none focus:border-cyan-600"
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="bg-cyan-700 hover:bg-cyan-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg px-3 py-2 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Activity feed — 40% */}
        <div className="w-2/5 flex flex-col">
          <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-400">Activity Log</h2>
            <span className="text-xs text-gray-600">{activity.length} entries</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {activity.length === 0 && (
              <div className="text-center text-gray-700 mt-10 text-sm">No activity yet</div>
            )}
            {activity.map((entry) => (
              <div
                key={entry.message_id}
                className="px-3 py-2 border-b border-gray-800/50 hover:bg-gray-900/50"
              >
                <div className="flex items-center justify-between mb-1">
                  <SpecialistBadge specialist={entry.specialist} escalated={entry.escalated} />
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <span className="flex items-center gap-0.5">
                      <Clock className="w-3 h-3" />
                      {entry.latency_ms}ms
                    </span>
                    <span>
                      {new Date(entry.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 truncate">{entry.user_message}</p>
                <p className="text-xs text-gray-500 truncate mt-0.5">{entry.response}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
