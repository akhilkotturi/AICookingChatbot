"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { Bot, ChefHat, SendHorizontal, Sparkles, User } from "lucide-react";

import { streamQuery, type StreamMeta } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Role = "user" | "assistant";

interface Message {
  id: string;
  role: Role;
  content: string;
  meta?: StreamMeta;
}

const STARTER_PROMPTS = [
  "Suggest a quick healthy breakfast",
  "Plan a vegetarian dinner for 2",
  "What can I cook with potatoes and eggs?",
];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I’m your Cooking AI assistant. Ask me for recipes, substitutions, cookware steps, or meal planning ideas.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !isStreaming, [input, isStreaming]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (!viewportRef.current) return;
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    });
  };

  const handleSend = async (text: string) => {
    const query = text.trim();
    if (!query || isStreaming) return;

    setError(null);
    setInput("");

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: query,
    };

    const assistantId = `assistant-${Date.now()}`;

    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setIsStreaming(true);
    scrollToBottom();

    try {
      await streamQuery(
        query,
        (chunk) => {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: `${message.content}${chunk}` }
                : message,
            ),
          );
          scrollToBottom();
        },
        (meta) => {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId ? { ...message, meta } : message,
            ),
          );
        },
      );
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unknown error";
      setError(message);
      setMessages((current) =>
        current.map((entry) =>
          entry.id === assistantId
            ? {
                ...entry,
                content:
                  entry.content.trim().length > 0
                    ? entry.content
                    : "I hit an issue while generating a response. Please try again.",
              }
            : entry,
        ),
      );
    } finally {
      setIsStreaming(false);
      scrollToBottom();
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await handleSend(input);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <Card className="mb-4 border-zinc-200 bg-zinc-50 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <CardHeader className="gap-2 px-4 sm:px-6">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-zinc-900 p-1.5 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900">
                <ChefHat className="size-4" />
              </div>
              <CardTitle className="text-xl tracking-tight sm:text-2xl">Cooking AI Chatbot</CardTitle>
            </div>
            <CardDescription>
              Ask for recipes, ingredient substitutions, cookware guidance, and step-by-step help.
            </CardDescription>
          </CardHeader>
        </Card>

        <section className="mb-4 flex flex-wrap gap-2">
          {STARTER_PROMPTS.map((prompt) => (
            <Button
              key={prompt}
              type="button"
              onClick={() => handleSend(prompt)}
              disabled={isStreaming}
              variant="outline"
              size="sm"
              className="rounded-full"
            >
              <Sparkles className="size-3.5" />
              {prompt}
            </Button>
          ))}
        </section>

        <Card className="flex min-h-0 flex-1 overflow-hidden py-0">
          <CardContent ref={viewportRef} className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
            {messages.map((message) => {
              const isUser = message.role === "user";

              return (
                <article
                  key={message.id}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-[75%]",
                      isUser
                        ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-200 dark:text-zinc-900"
                        : "border border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100",
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs opacity-80">
                      {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
                      <span>{isUser ? "You" : "Assistant"}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{message.content || (isStreaming ? "Thinking…" : "")}</p>

                    {!isUser && message.meta && (
                      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                        {message.meta.scope && (
                          <Badge variant="outline" className="rounded-full">
                            Scope: {message.meta.scope}
                          </Badge>
                        )}
                        {message.meta.question_type && (
                          <Badge variant="outline" className="rounded-full">
                            Type: {message.meta.question_type}
                          </Badge>
                        )}
                        {message.meta.cookware_in_use?.map((item) => (
                          <Badge
                            key={`${message.id}-${item}`}
                            variant="outline"
                            className="rounded-full"
                          >
                            {item}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </CardContent>

          <div className="border-t border-zinc-200 p-3 sm:p-4 dark:border-zinc-800">
            <form onSubmit={onSubmit} className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask your cooking question..."
                rows={2}
                className="min-h-12 flex-1 resize-none rounded-xl"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (canSend) {
                      void handleSend(input);
                    }
                  }
                }}
              />
              <Button
                type="submit"
                disabled={!canSend}
                className="h-12 rounded-xl px-4"
              >
                <SendHorizontal className="size-4" />
                {isStreaming ? "Sending..." : "Send"}
              </Button>
            </form>

            {error && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                Error: {error}
              </p>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}
