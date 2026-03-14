"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Send, Bot, Zap, Clock, ChevronDown, ChevronRight, RotateCcw, ThumbsUp, ThumbsDown, DollarSign } from "lucide-react";

interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  specialist?: string;
  escalated?: boolean;
  thinking?: string;
  latency_ms?: number;
  model?: string;
  message_id?: string;
  token_usage?: TokenUsage;
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
  token_usage?: TokenUsage;
  feedback?: { escalation_worthy?: boolean; quality_good?: boolean };
}

const SPECIALIST_COLORS: Record<string, string> = {
  cos: "bg-gray-500/20 text-gray-300",
  krj_signals: "bg-blue-500/20 text-blue-400",
  deal_intel: "bg-purple-500/20 text-purple-400",
  algo_trading: "bg-green-500/20 text-green-400",
  bmc_research: "bg-amber-500/20 text-amber-400",
  trading_engine: "bg-red-500/20 text-red-400",
  ops: "bg-indigo-500/20 text-indigo-400",
  autoloop: "bg-teal-500/20 text-teal-400",
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

function OpusFeedback({ messageId, tokenUsage }: { messageId: string; tokenUsage?: TokenUsage }) {
  const [escalationWorthy, setEscalationWorthy] = useState<boolean | null>(null);
  const [qualityGood, setQualityGood] = useState<boolean | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const submitFeedback = useCallback(async (field: "escalation_worthy" | "quality_good", value: boolean) => {
    const newEscalation = field === "escalation_worthy" ? value : escalationWorthy;
    const newQuality = field === "quality_good" ? value : qualityGood;
    if (field === "escalation_worthy") setEscalationWorthy(value);
    if (field === "quality_good") setQualityGood(value);

    try {
      await fetch("/api/cos/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_id: messageId,
          escalation_worthy: newEscalation,
          quality_good: newQuality,
        }),
      });
      if (newEscalation !== null && newQuality !== null) setSubmitted(true);
    } catch { /* silent */ }
  }, [messageId, escalationWorthy, qualityGood]);

  return (
    <div className="mt-2 pt-2 border-t border-gray-800 flex flex-wrap items-center gap-3">
      {tokenUsage && tokenUsage.cost_usd > 0 && (
        <span className="text-xs text-orange-400 flex items-center gap-1">
          <DollarSign className="w-3 h-3" />
          {tokenUsage.cost_usd.toFixed(4)} ({tokenUsage.input_tokens}in/{tokenUsage.output_tokens}out)
        </span>
      )}
      {!submitted ? (
        <>
          <span className="text-xs text-gray-500">Worth escalating?</span>
          <button
            onClick={() => submitFeedback("escalation_worthy", true)}
            className={`p-1 rounded transition-colors ${escalationWorthy === true ? "bg-green-800 text-green-300" : "text-gray-500 hover:text-green-400 hover:bg-green-900/30"}`}
          >
            <ThumbsUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => submitFeedback("escalation_worthy", false)}
            className={`p-1 rounded transition-colors ${escalationWorthy === false ? "bg-red-800 text-red-300" : "text-gray-500 hover:text-red-400 hover:bg-red-900/30"}`}
          >
            <ThumbsDown className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs text-gray-600">|</span>
          <span className="text-xs text-gray-500">Good quality?</span>
          <button
            onClick={() => submitFeedback("quality_good", true)}
            className={`p-1 rounded transition-colors ${qualityGood === true ? "bg-green-800 text-green-300" : "text-gray-500 hover:text-green-400 hover:bg-green-900/30"}`}
          >
            <ThumbsUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => submitFeedback("quality_good", false)}
            className={`p-1 rounded transition-colors ${qualityGood === false ? "bg-red-800 text-red-300" : "text-gray-500 hover:text-red-400 hover:bg-red-900/30"}`}
          >
            <ThumbsDown className="w-3.5 h-3.5" />
          </button>
        </>
      ) : (
        <span className="text-xs text-gray-500">Feedback saved</span>
      )}
    </div>
  );
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);
  if (!thinking) return null;

  // Detect brain exchange format (contains ═══ SYSTEM PROMPT / USER PROMPT / RESPONSE sections)
  const isBrainExchange = thinking.includes("═══ SYSTEM PROMPT") || thinking.includes("═══ USER PROMPT");

  if (isBrainExchange) {
    return <BrainExchangeBlock content={thinking} />;
  }

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

function BrainExchangeBlock({ content }: { content: string }) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  // Parse sections from the formatted content
  const sections: { label: string; body: string; color: string }[] = [];
  const sectionRegex = /═══ (SYSTEM PROMPT|USER PROMPT|RESPONSE) \(([^)]+)\) ═══\n([\s\S]*?)(?=\n═══ |$)/g;
  let match;
  while ((match = sectionRegex.exec(content)) !== null) {
    const name = match[1];
    const meta = match[2];
    const body = match[3].trim();
    const label = name === "SYSTEM PROMPT"
      ? `System Prompt (${meta})`
      : name === "USER PROMPT"
      ? `Prompt → Claude (${meta})`
      : `Response ← Claude (${meta})`;
    const color = name === "SYSTEM PROMPT"
      ? "text-gray-500 border-gray-700"
      : name === "USER PROMPT"
      ? "text-cyan-400 border-cyan-800"
      : "text-emerald-400 border-emerald-800";
    sections.push({ label, body, color });
  }

  // Fallback if parsing fails
  if (sections.length === 0) {
    return (
      <div className="mt-1">
        <pre className="text-xs text-gray-500 bg-gray-900 rounded p-2 whitespace-pre-wrap max-h-60 overflow-y-auto">
          {content}
        </pre>
      </div>
    );
  }

  const toggle = (label: string) =>
    setOpenSections(prev => ({ ...prev, [label]: !prev[label] }));

  return (
    <div className="mt-2 space-y-1">
      <div className="text-xs text-amber-400/70 font-medium mb-1">🧠 LLM Exchange</div>
      {sections.map((s) => (
        <div key={s.label} className={`border-l-2 ${s.color.split(" ")[1]} pl-2`}>
          <button
            onClick={() => toggle(s.label)}
            className={`text-xs ${s.color.split(" ")[0]} hover:brightness-125 flex items-center gap-1 w-full text-left`}
          >
            {openSections[s.label]
              ? <ChevronDown className="w-3 h-3 flex-shrink-0" />
              : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
            {s.label}
          </button>
          {openSections[s.label] && (
            <pre className="mt-1 text-xs text-gray-400 bg-gray-950 rounded p-2 whitespace-pre-wrap max-h-[50vh] overflow-y-auto">
              {s.body}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ChiefOfStaffPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamPhase, setStreamPhase] = useState("");
  const [streamThinking, setStreamThinking] = useState("");
  const [streamText, setStreamText] = useState("");
  const [streamMeta, setStreamMeta] = useState<{specialist?: string; escalated?: boolean} | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on stream updates and new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamThinking, streamText]);

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
    setStreamPhase("routing");
    setStreamThinking("");
    setStreamText("");
    setStreamMeta(null);

    try {
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/cos/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, conversation_history: history }),
      });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({ error: "Stream failed" }));
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${errData.error || errData.detail || "Unknown error"}` },
        ]);
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let thinkingAcc = "";
      let textAcc = "";
      let finalMeta: Record<string, unknown> = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // keep incomplete line

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              switch (currentEvent) {
                case "phase":
                  setStreamPhase(data.phase);
                  break;
                case "routed":
                  setStreamMeta({ specialist: data.specialist, escalated: data.escalate });
                  break;
                case "thinking_delta":
                  thinkingAcc += data.content;
                  setStreamThinking(thinkingAcc);
                  setStreamPhase("thinking");
                  break;
                case "thinking_done":
                  setStreamPhase("responding");
                  break;
                case "thinking":
                  // Non-streaming thinking (Opus fallback)
                  thinkingAcc = data.content;
                  setStreamThinking(thinkingAcc);
                  break;
                case "text_delta":
                  textAcc += data.content;
                  setStreamText(textAcc);
                  setStreamPhase("responding");
                  break;
                case "text":
                  // Non-streaming text (Opus fallback)
                  textAcc = data.content;
                  setStreamText(textAcc);
                  break;
                case "done":
                  finalMeta = data;
                  break;
              }
            } catch {
              // skip malformed
            }
            currentEvent = "";
          }
        }
      }

      // Finalize — add completed message
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: textAcc,
          specialist: (finalMeta.specialist as string) || streamMeta?.specialist || "",
          escalated: (finalMeta.escalated as boolean) || false,
          thinking: thinkingAcc,
          latency_ms: (finalMeta.latency_ms as number) || 0,
          model: (finalMeta.model as string) || "",
          message_id: (finalMeta.message_id as string) || "",
          token_usage: (finalMeta.token_usage as TokenUsage) || undefined,
        },
      ]);
      setStreamPhase("");
      setStreamThinking("");
      setStreamText("");
      setStreamMeta(null);

      // Refresh activity
      try {
        const actRes = await fetch("/api/cos/activity?limit=20");
        if (actRes.ok) {
          const actData = await actRes.json();
          setActivity(actData.entries || []);
        }
      } catch {
        // silent
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Connection error: ${err instanceof Error ? err.message : "Failed to reach CoS API"}`,
        },
      ]);
      setStreamPhase("");
      setStreamThinking("");
      setStreamText("");
      setStreamMeta(null);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, streamMeta]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const loadFromActivity = useCallback((entry: ActivityEntry) => {
    setSelectedActivityId(entry.message_id);
    setMessages([
      { role: "user", content: entry.user_message },
      {
        role: "assistant",
        content: entry.response,
        specialist: entry.specialist,
        escalated: entry.escalated,
        thinking: entry.thinking,
        latency_ms: entry.latency_ms,
        model: entry.model,
        message_id: entry.message_id,
        token_usage: entry.token_usage,
      },
    ]);
    inputRef.current?.focus();
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setSelectedActivityId(null);
    setInput("");
    inputRef.current?.focus();
  }, []);

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
          <span className="text-xs text-gray-500">Qwen3-Coder-30B · Opus escalation</span>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-800 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            New chat
          </button>
        )}
      </div>

      {/* Status banner */}
      <div className="px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-400/80 flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        One-way status updates only — not monitoring incoming chats. Check the Activity Log for fleet status.
      </div>

      {/* Two-panel layout */}
      <div className="flex h-[calc(100vh-54px)]">
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
                  {msg.escalated && msg.message_id && (
                    <OpusFeedback messageId={msg.message_id} tokenUsage={msg.token_usage} />
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-900 rounded-lg px-3 py-2 max-w-[85%]">
                  {/* Phase indicator */}
                  <div className="flex items-center gap-2 mb-1">
                    {streamMeta?.specialist && (
                      <SpecialistBadge specialist={streamMeta.specialist} escalated={streamMeta.escalated} />
                    )}
                    <span className="text-xs text-gray-500 animate-pulse">
                      {streamPhase === "routing" && "Routing..."}
                      {streamPhase === "context" && "Fetching context..."}
                      {streamPhase === "executing" && "Connecting to model..."}
                      {streamPhase === "thinking" && "Reasoning..."}
                      {streamPhase === "responding" && "Writing..."}
                      {!streamPhase && "Starting..."}
                    </span>
                  </div>
                  {/* Live thinking stream */}
                  {streamThinking && (
                    <pre className="text-xs text-gray-500 bg-gray-950 rounded p-2 whitespace-pre-wrap max-h-48 overflow-y-auto mb-1">
                      {streamThinking}
                    </pre>
                  )}
                  {/* Live response stream */}
                  {streamText && (
                    <div className="text-sm text-gray-200 whitespace-pre-wrap">{streamText}</div>
                  )}
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
            {activity.map((entry) => {
              const isSelected = selectedActivityId === entry.message_id;
              return (
                <button
                  key={entry.message_id}
                  onClick={() => loadFromActivity(entry)}
                  className={`w-full text-left px-3 py-2 border-b border-gray-800/50 transition-colors ${
                    isSelected
                      ? "bg-cyan-900/20 border-l-2 border-l-cyan-500"
                      : "hover:bg-gray-900/50 border-l-2 border-l-transparent"
                  }`}
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
                  {entry.token_usage?.cost_usd ? (
                    <span className="text-xs text-orange-400/70 mt-0.5 flex items-center gap-0.5">
                      <DollarSign className="w-2.5 h-2.5" />{entry.token_usage.cost_usd.toFixed(4)}
                      {entry.token_usage.input_tokens ? (
                        <span className="text-gray-600 ml-0.5">
                          ({(entry.token_usage.input_tokens / 1000).toFixed(1)}k/{(entry.token_usage.output_tokens / 1000).toFixed(1)}k)
                        </span>
                      ) : null}
                      {entry.feedback && (
                        <span className="ml-1 text-gray-600">
                          {entry.feedback.escalation_worthy === true ? "+" : entry.feedback.escalation_worthy === false ? "-" : "?"}
                          {entry.feedback.quality_good === true ? "+" : entry.feedback.quality_good === false ? "-" : "?"}
                        </span>
                      )}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
