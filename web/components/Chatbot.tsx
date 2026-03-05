'use client';

import { useState, useRef, useEffect } from 'react';

interface QueryInfo {
  sql: string;
  rows: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  queries: QueryInfo[];
  error?: string;
  loading?: boolean;
}

interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'How many nodes are reporting?',
  'Show the latest SOC for all nodes',
  'Are there any active faults?',
  'What is the average pack voltage?',
  'Show temperature trends in the last hour',
  'Which node has the highest cell voltage?',
];

function renderMd(text: string): string {
  return text
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre>$1</pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>');
}

export default function Chatbot() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function newChat() {
    setMessages([]);
    setHistory([]);
    setShowSuggestions(true);
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput('');
    setBusy(true);
    setShowSuggestions(false);

    const userMsg: Message = { role: 'user', content: text, queries: [] };
    const assistantMsg: Message = { role: 'assistant', content: '', queries: [], loading: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    let accumulated = '';
    const queries: QueryInfo[] = [];

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event: { type: string; [k: string]: unknown };
          try { event = JSON.parse(line.slice(6)); } catch { continue; }

          if (event.type === 'text') {
            accumulated += event.text as string;
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = {
                ...next[next.length - 1],
                content: accumulated,
                loading: false,
              };
              return next;
            });
          } else if (event.type === 'query') {
            queries.push({ sql: event.sql as string, rows: event.rows as number });
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], queries: [...queries] };
              return next;
            });
          } else if (event.type === 'query_error') {
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = {
                ...next[next.length - 1],
                error: event.error as string,
                loading: false,
              };
              return next;
            });
          } else if (event.type === 'done') {
            const assistantText = (event.assistantText as string) || accumulated;
            setHistory((prev) => [
              ...prev,
              { role: 'user', content: text },
              { role: 'assistant', content: assistantText },
            ]);
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], loading: false };
              return next;
            });
          } else if (event.type === 'error') {
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = {
                ...next[next.length - 1],
                content: `Error: ${event.text}`,
                loading: false,
              };
              return next;
            });
          }
        }
      }
    } catch (e) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          ...next[next.length - 1],
          content: `Connection error: ${String(e)}`,
          loading: false,
        };
        return next;
      });
    }

    setBusy(false);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800 flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-cyan-400">UEI Data Assistant</h1>
          <p className="text-xs text-slate-500">Ask questions about your battery telemetry data</p>
        </div>
        <div className="flex items-center gap-3">
          <a href="/" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
            ← Dashboard
          </a>
          <button
            onClick={newChat}
            className="text-xs border border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500 rounded-lg px-3 py-1.5 transition-colors"
          >
            + New chat
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
            <p className="text-sm">Ask anything about your data</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-cyan-700 text-cyan-50 rounded-br-sm'
                  : 'bg-slate-800 text-slate-200 rounded-bl-sm'
              }`}
            >
              {/* Query badges */}
              {msg.queries.length > 0 && (
                <div className="flex flex-col gap-1 mb-2">
                  {msg.queries.map((q, qi) => (
                    <div
                      key={qi}
                      className="flex items-start gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-sky-400"
                    >
                      <span className="text-cyan-500 mt-0.5 flex-shrink-0">▶</span>
                      <span className="break-all">{q.sql.trim()}</span>
                      <span className="text-slate-600 ml-auto pl-2 flex-shrink-0 whitespace-nowrap">
                        {q.rows} rows
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Error */}
              {msg.error && (
                <p className="text-red-400 text-xs mb-1">Query error: {msg.error}</p>
              )}

              {/* Content */}
              {msg.loading ? (
                <div className="flex items-center gap-2 text-slate-500 italic text-xs">
                  <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                  Thinking…
                </div>
              ) : (
                <div
                  dangerouslySetInnerHTML={{ __html: renderMd(msg.content) }}
                  className="[&_pre]:bg-slate-900 [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_pre]:my-2 [&_code]:bg-slate-900 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_ul]:pl-4 [&_li]:my-0.5"
                />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {showSuggestions && (
        <div className="px-6 pb-2 flex flex-wrap gap-2 flex-shrink-0">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="bg-slate-800 border border-slate-700 rounded-full px-3 py-1 text-xs text-slate-400 hover:border-cyan-600 hover:text-cyan-400 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={onSubmit}
        className="px-6 pb-5 pt-2 border-t border-slate-800 flex gap-3 flex-shrink-0"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about your data..."
          autoComplete="off"
          className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-5 py-2.5 text-sm transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
