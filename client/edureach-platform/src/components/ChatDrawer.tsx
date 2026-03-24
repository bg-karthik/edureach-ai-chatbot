import { useState, useRef, useEffect } from "react";
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
  const { user } = useAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load chat
  useEffect(() => {
    const saved = localStorage.getItem("chat");

    if (saved) {
      setMessages(JSON.parse(saved));
    } else {
      setMessages([
        {
          id: 1,
          text: `Hi ${
            user?.name?.split(" ")[0] || "there"
          }! 👋 I'm EduReach Bot. Ask me anything!`,
          sender: "bot",
        },
      ]);
    }
  }, [user?.name]);

  // Save chat
  useEffect(() => {
    localStorage.setItem("chat", JSON.stringify(messages));
  }, [messages]);

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto focus
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleSend = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText || sending) return;

    const userMsg: Message = {
      id: Date.now(),
      text: messageText,
      sender: "user",
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      await new Promise((res) => setTimeout(res, 500));

      const data = await sendMessage(messageText);

      const botMsg: Message = {
        id: Date.now() + 1,
        text: data.message,
        sender: "bot",
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          text: "Sorry, something went wrong. Please try again.",
          sender: "bot",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed bottom-24 right-6 z-50 w-[380px] h-[520px] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border">

      {/* Header */}
      <div className="bg-maroon px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="text-white w-5 h-5" />
          <div>
            <h3 className="text-white text-sm font-semibold">
              EduReach Bot • {user?.name?.split(" ")[0]}
            </h3>
            <p className="text-white/70 text-xs">Ask me anything</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              setMessages([
                {
                  id: Date.now(),
                  text: "Chat cleared. Ask me anything!",
                  sender: "bot",
                },
              ])
            }
            aria-label="Clear chat"
            title="Clear chat"
            className="text-white text-xs"
          >
            Clear
          </button>

          <button
            onClick={onClose}
            aria-label="Minimize chat"
            title="Minimize chat"
            className="text-white"
          >
            <Minus />
          </button>

          <button
            onClick={onClose}
            aria-label="Close chat"
            title="Close chat"
            className="text-white"
          >
            <X />
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
              className="text-xs mr-2 mb-1 px-2 py-1 border rounded"
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
          className="flex-1 border px-2 py-1 rounded"
        />
        <button
          onClick={() => handleSend()}
          aria-label="Send message"
          title="Send message"
          className="bg-maroon text-white px-3 rounded"
        >
          <Send />
        </button>
      </div>
    </div>
  );
}