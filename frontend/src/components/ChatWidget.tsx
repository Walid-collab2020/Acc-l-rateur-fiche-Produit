"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import api, { productsApi } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [productId, setProductId] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.list().then((r) => r.data),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await api.post<{ response: string }>("/chat/message", {
        message: text,
        product_id: productId,
        history: messages.slice(-10),
      });
      setMessages([...newMessages, { role: "assistant", content: res.data.response }]);
    } catch {
      setMessages([
        ...newMessages,
        { role: "assistant", content: "Erreur de connexion au serveur. Vérifiez que le backend est démarré." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const clear = () => setMessages([]);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-[#A100FF] hover:bg-[#7700CC] text-white shadow-lg flex items-center justify-center transition-colors"
        title="KELIA Assistant"
        style={{ borderRadius: 0 }}
      >
        {open ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-96 h-[520px] bg-white shadow-2xl border border-[#E0E0E0] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#A100FF] text-white">
            <div>
              <div className="font-semibold text-sm">KELIA Assistant</div>
              <div className="text-xs text-[#E5B3FF]">Posez vos questions sur les produits</div>
            </div>
            <button onClick={clear} className="text-[#E5B3FF] hover:text-white text-xs underline">
              Effacer
            </button>
          </div>

          {/* Product selector */}
          <div className="px-3 py-2 border-b border-[#E0E0E0] bg-[#F2F2F2]">
            <select
              value={productId ?? ""}
              onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : null)}
              className="w-full text-xs border border-[#E0E0E0] px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-[#A100FF]"
              style={{ borderRadius: 0 }}
            >
              <option value="">Contexte : tous les produits</option>
              {products?.map((p) => (
                <option key={p.id} value={p.id}>
                  BOSS {p.boss_number}{p.name ? ` — ${p.name}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-[#6A6A6A] text-xs mt-8">
                <div className="text-2xl mb-2">💬</div>
                <div>Bonjour ! Je suis KELIA Assistant.</div>
                <div className="mt-1">Sélectionnez un produit pour poser des questions précises.</div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                    m.role === "user"
                      ? "bg-[#A100FF] text-white"
                      : "bg-[#F2F2F2] text-black"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-[#F2F2F2] px-4 py-2">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-[#6A6A6A] rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-[#6A6A6A] rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-[#6A6A6A] rounded-full animate-bounce [animation-delay:300ms]" />
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-2 border-t border-[#E0E0E0] flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Votre question... (Entrée pour envoyer)"
              rows={2}
              className="flex-1 resize-none text-sm border border-[#E0E0E0] px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#A100FF]"
              style={{ borderRadius: 0 }}
              disabled={loading}
            />
            <button
              onClick={send}
              disabled={!input.trim() || loading}
              className="mb-0.5 w-9 h-9 bg-[#A100FF] hover:bg-[#7700CC] disabled:bg-[#E0E0E0] text-white flex items-center justify-center transition-colors flex-shrink-0"
              style={{ borderRadius: 0 }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
