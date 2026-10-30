import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Bot, Minus } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { sendMessage } from "../services/chat.service";
import ReactMarkdown from "react-markdown";

interface Message {
  id: number;
  text: string;
  sender: "user" | "bot";
}

interface ChatDrawerProps {
  open: boolean;
  onClose: () => void;
}

const quickQuestions = [
  "What courses do you offer?",
  "Tell me about placements",
  "What is the fee structure?",
  "How to apply for admissions?",
];

export default function ChatDrawer({ open, onClose }: ChatDrawerProps) {
  const { user, loading } = useAuth();

  const getInitialGreeting = useCallback((): Message[] => {
    return [
      {
        id: 1,
        text: `Hi ${
          user?.name?.split(" ")[0] || "there"
        }! 👋 I'm EduReach Bot. Ask me anything!`,
        sender: "bot",
      },
    ];
  }, [user?.name]);

  // Pure in-memory session state (strictly NOT persisted to shared localStorage)
  const [messages, setMessages] = useState<Message[]>(getInitialGreeting);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Safety: purge any legacy unauthenticated shared cache if present in localStorage
  useEffect(() => {
    try {
      localStorage.removeItem("chat");
    } catch {
      // Ignore storage restrictions
    }
  }, []);

  // Reset in-memory session state when authenticated student ID changes or on logout
  useEffect(() => {
    sessionRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    setInput("");
    setSending(false);
    setErrorMessage("");

    if (user?.id) {
      setMessages(getInitialGreeting());
    } else {
      setMessages([]);
    }
  }, [user?.id, getInitialGreeting]);

  // Clean up any in-flight request when component unmounts
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // Auto focus input when drawer opens
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleSend = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText || sending || !user?.id) return;

    const userMsg: Message = {
      id: Date.now(),
      text: messageText,
      sender: "user",
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    setErrorMessage("");

    // Setup AbortController and track generation ID to prevent stale/cross-user message injection
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const currentSession = sessionRef.current;
    const currentUserId = user.id;

    try {
      const data = await sendMessage(messageText, controller.signal);

      // Verify the session and student identity are still active before displaying the bot response
      if (sessionRef.current !== currentSession || user?.id !== currentUserId) {
        return; // Stale response from previous student or logged out session -> discard!
      }

      const botMsg: Message = {
        id: Date.now() + 1,
        text: data.message,
        sender: "bot",
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err: any) {
      // If aborted deliberately due to logout or account switch, ignore
      if (err?.name === "CanceledError" || err?.name === "AbortError") {
        return;
      }

      if (sessionRef.current !== currentSession || user?.id !== currentUserId) {
        return;
      }

      setErrorMessage("Sorry, something went wrong. Please try again.");
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          text: "Sorry, I encountered an issue. Please try again.",
          sender: "bot",
        },
      ]);
    } finally {
      if (sessionRef.current === currentSession && user?.id === currentUserId) {
        setSending(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearChat = () => {
    abortControllerRef.current?.abort();
    setSending(false);
    setErrorMessage("");
    setMessages([
      {
        id: Date.now(),
        text: `Chat cleared. Ask me anything, ${user?.name?.split(" ")[0] || "there"}!`,
        sender: "bot",
      },
    ]);
  };

  // Do not display if not open, still initializing authentication, or user is unauthenticated
  if (!open || loading || !user) return null;

  const firstName = user.name?.split(" ")[0] || "Student";

  return (
    <div className="fixed bottom-24 right-6 z-50 w-[380px] h-[520px] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border">
      {/* Header */}
      <div className="bg-maroon px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="text-white w-5 h-5" />
          <div>
            <h3 className="text-white text-sm font-semibold">
              EduReach Bot • {firstName}
            </h3>
            <p className="text-white/70 text-xs">Ask me anything</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleClearChat}
            aria-label="Clear chat"
            title="Clear chat"
            className="text-white text-xs hover:underline focus:outline-none"
          >
            Clear
          </button>

          <button
            onClick={onClose}
            aria-label="Minimize chat"
            title="Minimize chat"
            className="text-white hover:opacity-80"
          >
            <Minus className="w-4 h-4" />
          </button>

          <button
            onClick={onClose}
            aria-label="Close chat"
            title="Close chat"
            className="text-white hover:opacity-80"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${
              msg.sender === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                msg.sender === "user"
                  ? "bg-maroon text-white"
                  : "bg-white border shadow-sm"
              }`}
            >
              <ReactMarkdown>{msg.text}</ReactMarkdown>
            </div>
          </div>
        ))}

        {sending && <p className="text-xs text-gray-400">Typing...</p>}
        {errorMessage && <p className="text-xs text-red-500">{errorMessage}</p>}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Questions */}
      {messages.length <= 1 && (
        <div className="p-2 border-t">
          {quickQuestions.map((q) => (
            <button
              key={q}
              onClick={() => handleSend(q)}
              aria-label={q}
              title={q}
              className="text-xs mr-2 mb-1 px-2 py-1 border rounded hover:bg-gray-100 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t flex gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question..."
          className="flex-1 border px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-maroon text-sm"
        />
        <button
          onClick={() => handleSend()}
          aria-label="Send message"
          title="Send message"
          disabled={sending || !input.trim()}
          className="bg-maroon text-white px-3 rounded disabled:opacity-50 hover:bg-maroon-dark transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
