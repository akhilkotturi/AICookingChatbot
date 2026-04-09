"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Message, ConversationTurn, SavedRecipe, Panel, Theme } from "@/types";
import {
  streamQuery, getSavedRecipes, saveRecipe, deleteRecipe,
  getCookwareProfile, saveCookwareProfile, fetchCookwareCatalog,
  importRecipe, scaleRecipe, searchRecipes, getRecipeDetail, type ImportedRecipe,
} from "@/lib/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content: "Welcome to your kitchen. Ask me about recipes, ingredients, techniques, or meal planning — I'll remember our conversation as we go.",
  timestamp: new Date(),
};

const STARTERS = [
  "Quick pasta carbonara recipe",
  "What can I make with chicken and lemon?",
  "How do I make croissants from scratch?",
  "Spicy Thai basil stir-fry",
];

interface Props {
  user: { id: string; email: string; name?: string };
}

export function DashboardClient({ user }: Props) {
  const router = useRouter();

  // UI
  const [activePanel, setActivePanel] = useState<Panel>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");

  // Chat
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Data
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipe[]>([]);
  const [cookware, setCookware] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [cookwareSearch, setCookwareSearch] = useState("");
  const [savingRecipeId, setSavingRecipeId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Import panel
  const [importUrl, setImportUrl] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedRecipe, setImportedRecipe] = useState<ImportedRecipe | null>(null);
  const [importServings, setImportServings] = useState(4);
  const [scaledIngredients, setScaledIngredients] = useState<{ raw: string; scaled_raw: string; name: string }[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: number; title: string; image: string; source_url: string; total_time: number }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Cook mode
  const [cookModeRecipe, setCookModeRecipe] = useState<SavedRecipe | null>(null);
  const [cookStep, setCookStep] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("theme") as Theme | null;
    if (saved) applyTheme(saved);
    loadData();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (timerRunning && timerSeconds !== null && timerSeconds > 0) {
      timerRef.current = setInterval(() => {
        setTimerSeconds(s => {
          if (s === null || s <= 1) {
            setTimerRunning(false);
            clearInterval(timerRef.current!);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  async function loadData() {
    try {
      const [recipes, cw, cat] = await Promise.all([
        getSavedRecipes(),
        getCookwareProfile(),
        fetchCookwareCatalog(),
      ]);
      setSavedRecipes(recipes);
      setCookware(cw);
      setCatalog(cat);
    } catch (e) { console.error(e); }
  }

  function applyTheme(t: Theme) {
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("theme", t);
  }

  const history = useCallback((): ConversationTurn[] =>
    messages
      .filter(m => m.id !== "welcome" && !m.isStreaming)
      .map(m => ({ role: m.role, content: m.content })),
    [messages]
  );

  async function handleSend(text: string) {
    const query = text.trim();
    if (!query || isStreaming) return;
    setStreamError(null);
    setInput("");
    setActivePanel("chat");

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: query,
      timestamp: new Date(),
    };
    const asstId = `a-${Date.now()}`;
    const asstMsg: Message = {
      id: asstId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isStreaming: true,
    };

    setMessages(prev => [...prev, userMsg, asstMsg]);
    setIsStreaming(true);
    abortRef.current = new AbortController();

    try {
      await streamQuery(
        query,
        history(),
        cookware,
        (chunk) => setMessages(prev => prev.map(m =>
          m.id === asstId ? { ...m, content: m.content + chunk } : m
        )),
        (meta) => setMessages(prev => prev.map(m =>
          m.id === asstId ? { ...m, meta, isStreaming: false } : m
        )),
        abortRef.current.signal,
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setStreamError(err instanceof Error ? err.message : "Unknown error");
      setMessages(prev => prev.map(m =>
        m.id === asstId
          ? { ...m, content: m.content || "Something went wrong. Please try again.", isStreaming: false }
          : m
      ));
    } finally {
      setIsStreaming(false);
      // Safety net: if done event never fired, clear the streaming flag
      setMessages(prev => prev.map(m =>
        m.id === asstId && m.isStreaming ? { ...m, isStreaming: false } : m
      ));
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m));
  }

  async function handleSaveRecipe(msg: Message) {
    setSavingRecipeId(msg.id);
    setSaveError(null);
    const titleMatch = msg.content.match(/#{1,3}\s+(.+)/);
    const title = titleMatch?.[1]?.replace(/[*_]/g, "").trim().slice(0, 80) || "Saved Recipe";
    try {
      const id = await saveRecipe({
        title,
        content: msg.content,
        cookware_used: msg.meta?.cookware_in_use || [],
        tags: msg.meta?.question_type ? [msg.meta.question_type] : [],
      });
      const newRecipe: SavedRecipe = {
        id,
        title,
        content: msg.content,
        user_id: user.id,
        cookware_used: msg.meta?.cookware_in_use || [],
        tags: msg.meta?.question_type ? [msg.meta.question_type] : [],
        created_at: new Date().toISOString(),
      };
      setSavedRecipes(prev => [newRecipe, ...prev]);
    } catch (e) {
      console.error(e);
      setSaveError(e instanceof Error ? e.message : "Failed to save recipe");
    } finally { setSavingRecipeId(null); }
  }

  async function handleDeleteRecipe(id: string) {
    await deleteRecipe(id);
    setSavedRecipes(prev => prev.filter(r => r.id !== id));
  }

  function handleCookMode(recipe: SavedRecipe) {
    setCookModeRecipe(recipe);
    setCookStep(0);
    setTimerSeconds(null);
    setTimerRunning(false);
  }

  function parseCookSteps(content: string): string[] {
    const instructionsBlock = content.match(/(?:^|\n)##?\s*(Method|Instructions)\s*\n([\s\S]*)/i)?.[2] ?? content;

    const numbered = Array.from(
      instructionsBlock.matchAll(/^\s*\d+[.)]\s+(.+)$/gm),
      (m) => m[1].trim()
    );
    if (numbered.length > 0) return numbered;

    const bullets = Array.from(
      instructionsBlock.matchAll(/^\s*[-*]\s+(.+)$/gm),
      (m) => m[1].trim()
    );
    if (bullets.length > 0) return bullets;

    const paragraphs = instructionsBlock
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    return paragraphs.length > 0 ? paragraphs : [content.trim()];
  }

  function extractIngredientsMarkdown(content: string): string | null {
    const match = content.match(/(?:^|\n)##?\s*Ingredients\s*\n([\s\S]*?)(?=\n##?\s|$)/i);
    if (!match) return null;

    const block = match[1].trim();
    if (!block) return null;

    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => (line.startsWith("-") || line.startsWith("*") ? line : `- ${line}`));

    return lines.join("\n");
  }

  function parseStepTime(step: string): number | null {
    const match = step.match(/(\d+)\s*(?:to\s*\d+\s*)?minutes?/i);
    return match ? parseInt(match[1]) * 60 : null;
  }

  function formatTime(s: number): string {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function handleImport() {
    if (!importUrl.trim()) return;
    setImportLoading(true);
    setImportError(null);
    setImportedRecipe(null);
    setScaledIngredients(null);
    try {
      const recipe = await importRecipe(importUrl.trim());
      setImportedRecipe(recipe);
      setImportServings(recipe.servings);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImportLoading(false);
    }
  }

  async function handleScale(targetServings: number) {
    if (!importedRecipe) return;
    setImportServings(targetServings);
    if (targetServings === importedRecipe.servings) {
      setScaledIngredients(null);
      return;
    }
    try {
      const result = await scaleRecipe(importedRecipe.ingredients, importedRecipe.servings, targetServings);
      setScaledIngredients(result.ingredients);
    } catch (e) { console.error(e); }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    try {
      const result = await searchRecipes(searchQuery);
      setSearchResults(result.results);
    } catch (e) { console.error(e); }
    finally { setSearchLoading(false); }
  }

  async function handleSelectSearchResult(id: number) {
    setImportLoading(true);
    setImportError(null);
    setImportedRecipe(null);
    setScaledIngredients(null);
    try {
      const recipe = await getRecipeDetail(id);
      setImportedRecipe(recipe);
      setImportServings(recipe.servings);
      setImportUrl(recipe.source_url || "");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Could not load recipe");
    } finally {
      setImportLoading(false);
    }
  }

  async function handleSaveImported() {
    if (!importedRecipe) return;
    const ingredients = (scaledIngredients || importedRecipe.ingredients)
      .map(i => ("scaled_raw" in i ? i.scaled_raw : i.raw))
      .join("\n");
    const content = `# ${importedRecipe.title}\n\n**Servings:** ${importServings}${importedRecipe.total_time ? `\n**Time:** ${importedRecipe.total_time} minutes` : ""}\n\n## Ingredients\n\n${ingredients}\n\n## Instructions\n\n${importedRecipe.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
    try {
      const id = await saveRecipe({
        title: importedRecipe.title,
        content,
        source_url: importedRecipe.source_url,
        cookware_used: importedRecipe.cookware,
        servings: importServings,
        tags: ["imported"],
      });
      const newRecipe: SavedRecipe = {
        id,
        title: importedRecipe.title,
        content,
        user_id: user.id,
        source_url: importedRecipe.source_url,
        cookware_used: importedRecipe.cookware,
        servings: importServings,
        tags: ["imported"],
        created_at: new Date().toISOString(),
      };
      setSavedRecipes(prev => [newRecipe, ...prev]);
      setImportedRecipe(null);
      setImportUrl("");
      setScaledIngredients(null);
      setActivePanel("recipes");
    } catch (e) { console.error(e); }
  }

  const filteredCatalog = catalog.filter(i =>
    i.toLowerCase().includes(cookwareSearch.toLowerCase())
  );

  const navItems: { panel: Panel; label: string }[] = [
    { panel: "chat",     label: "Chat"     },
    { panel: "recipes",  label: "Recipes"  },
    { panel: "import",   label: "Import"   },
    { panel: "cookware", label: "Cookware" },
  ];

  // Cook mode overlay
  if (cookModeRecipe) {
    const steps = parseCookSteps(cookModeRecipe.content);
    const ingredientsMarkdown = extractIngredientsMarkdown(cookModeRecipe.content);
    const currentStep = steps[cookStep] || "";
    const detectedTime = parseStepTime(currentStep);

    return (
      <div style={{ position: "fixed", inset: 0, background: "var(--bg)", zIndex: 100, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-card)" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "2px" }}>Cook Mode</div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: "1.1rem", fontStyle: "italic" }}>{cookModeRecipe.title}</div>
          </div>
          <button onClick={() => setCookModeRecipe(null)} className="btn btn-ghost btn-sm">Exit</button>
        </div>

        <div style={{ height: "4px", background: "var(--border)" }}>
          <div style={{ height: "100%", background: "var(--accent)", width: `${((cookStep + 1) / steps.length) * 100}%`, transition: "width 0.3s ease" }} />
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", maxWidth: "600px", margin: "0 auto", width: "100%" }}>
          {ingredientsMarkdown && (
            <div className="card" style={{ width: "100%", padding: "14px 16px", marginBottom: "18px", maxHeight: "180px", overflowY: "auto" }}>
              <div style={{ fontSize: "0.78rem", letterSpacing: "0.02em", color: "var(--text-muted)", marginBottom: "8px" }}>
                Ingredients (with amounts)
              </div>
              <div className="prose" style={{ maxWidth: "100%" }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{ingredientsMarkdown}</ReactMarkdown>
              </div>
            </div>
          )}
          <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginBottom: "24px" }}>
            Step {cookStep + 1} of {steps.length}
          </div>
          <div className="prose" style={{ width: "100%", maxWidth: "100%", fontSize: "1.05rem", lineHeight: 1.75, marginBottom: "40px" }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentStep}</ReactMarkdown>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", marginBottom: "40px" }}>
            {timerSeconds !== null && (
              <div style={{ fontSize: "2.5rem", fontFamily: "var(--font-serif)", color: timerSeconds === 0 ? "var(--olive)" : "var(--accent)" }}>
                {timerSeconds === 0 ? "Done!" : formatTime(timerSeconds)}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px" }}>
              {detectedTime && timerSeconds === null && (
                <button className="btn btn-secondary btn-sm" onClick={() => setTimerSeconds(detectedTime)}>
                  Set {Math.floor(detectedTime / 60)} min timer
                </button>
              )}
              {timerSeconds !== null && timerSeconds > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={() => setTimerRunning(r => !r)}>
                  {timerRunning ? "Pause" : "Start"}
                </button>
              )}
              {timerSeconds !== null && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setTimerSeconds(null); setTimerRunning(false); }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            <button
              className="btn btn-secondary"
              onClick={() => { setCookStep(s => Math.max(0, s - 1)); setTimerSeconds(null); setTimerRunning(false); }}
              disabled={cookStep === 0}
            >
              Previous
            </button>
            <button
              className="btn btn-primary"
              onClick={() => { setCookStep(s => Math.min(steps.length - 1, s + 1)); setTimerSeconds(null); setTimerRunning(false); }}
              disabled={cookStep === steps.length - 1}
            >
              {cookStep === steps.length - 1 ? "Finished" : "Next step"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 39 }}
        />
      )}

      {/* Sidebar */}
      <aside style={{
        width: "220px", minWidth: "220px", background: "var(--bg-card)",
        borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column",
        height: "100vh", position: "fixed", left: 0, top: 0, zIndex: 40,
      }}>
        <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid var(--border)" }}>
          <span className="font-serif" style={{ fontSize: "1.1rem", fontStyle: "italic", color: "var(--text)" }}>
            Mise en Place
          </span>
        </div>

        <nav style={{ flex: 1, padding: "12px 8px" }}>
          {navItems.map(item => (
            <button
              key={item.panel}
              onClick={() => { setActivePanel(item.panel); setSidebarOpen(false); }}
              className="btn btn-ghost"
              style={{
                width: "100%", justifyContent: "flex-start",
                borderRadius: "var(--radius-sm)", marginBottom: "2px",
                padding: "10px 12px",
                background: activePanel === item.panel ? "var(--accent-light)" : "transparent",
                color: activePanel === item.panel ? "var(--accent)" : "var(--text-muted)",
                fontWeight: activePanel === item.panel ? 500 : 400,
              }}
            >
              {item.label}
              {item.panel === "recipes" && savedRecipes.length > 0 && (
                <span className="badge badge-neutral" style={{ marginLeft: "auto", padding: "1px 7px", fontSize: "0.7rem" }}>
                  {savedRecipes.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div style={{ padding: "12px 8px", borderTop: "1px solid var(--border)" }}>
          <button
            onClick={() => applyTheme(theme === "light" ? "dark" : "light")}
            className="btn btn-ghost btn-sm"
            style={{ width: "100%", justifyContent: "flex-start", marginBottom: "4px" }}
          >
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
          <div style={{ padding: "8px 12px", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            {user.name || user.email}
          </div>
          <button
            onClick={handleSignOut}
            className="btn btn-ghost btn-sm"
            style={{ width: "100%", justifyContent: "flex-start", color: "var(--text-faint)" }}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div style={{ marginLeft: "220px", flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>

        {/* Chat panel */}
        {activePanel === "chat" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 24px 0" }}>
              {messages.length === 1 && (
                <div style={{ marginBottom: "32px" }}>
                  <h2 className="font-serif" style={{ fontSize: "1.5rem", fontStyle: "italic", color: "var(--text)", marginBottom: "16px" }}>
                    What are we cooking?
                  </h2>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {STARTERS.map(s => (
                      <button key={s} onClick={() => handleSend(s)} className="btn btn-secondary btn-sm" style={{ borderRadius: "99px" }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={msg.id}
                  className="animate-fade-up"
                  style={{
                    marginBottom: "24px",
                    display: "flex",
                    justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                    animationDelay: `${i * 0.02}s`,
                  }}
                >
                  {msg.role === "user" ? (
                    <div style={{
                      maxWidth: "75%",
                      background: "var(--text)",
                      color: "var(--bg)",
                      borderRadius: "20px 20px 4px 20px",
                      padding: "11px 18px",
                      fontSize: "0.9375rem",
                      lineHeight: 1.6,
                      boxShadow: "var(--shadow-sm)",
                    }}>
                      {msg.content}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", maxWidth: "640px", width: "100%" }}>
                      <div className="msg-ai-label">Mise en Place</div>
                      <div style={{ width: "100%" }}>
                        {msg.isStreaming && msg.content === "" && (
                          <div style={{ display: "flex", gap: "4px", padding: "4px 0" }}>
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                          </div>
                        )}

                        {msg.content && (
                          <div className="prose">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                          </div>
                        )}

                        {msg.meta && !msg.isStreaming && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "12px" }}>
                            {msg.meta.question_type && (
                              <span className="badge badge-neutral">{msg.meta.question_type.replace("_", " ")}</span>
                            )}
                            {msg.meta.cookware_in_use?.map(c => (
                              <span key={c} className="badge badge-olive">{c}</span>
                            ))}
                            {msg.meta.missing_cookware?.map(c => (
                              <span key={c} className="badge badge-gold">Missing: {c}</span>
                            ))}
                          </div>
                        )}

                        {msg.meta?.is_recipe && !msg.isStreaming && (
                          <div style={{ marginTop: "12px" }}>
                            <button
                              onClick={() => handleSaveRecipe(msg)}
                              disabled={savingRecipeId === msg.id}
                              className="btn btn-secondary btn-sm"
                            >
                              {savingRecipeId === msg.id ? "Saving..." : "Save recipe"}
                            </button>
                            {saveError && savingRecipeId !== msg.id && (
                              <span style={{ marginLeft: "10px", fontSize: "0.8rem", color: "var(--color-error, #e53e3e)" }}>
                                {saveError}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {streamError && (
              <div style={{ margin: "0 24px", padding: "10px 14px", background: "var(--accent-light)", color: "var(--accent)", borderRadius: "var(--radius)", fontSize: "0.875rem" }}>
                {streamError}
              </div>
            )}

            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", background: "var(--bg-card)" }}>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend(input);
                    }
                  }}
                  placeholder="Ask anything about cooking..."
                  rows={2}
                  style={{
                    flex: 1, resize: "none", padding: "10px 14px",
                    background: "var(--bg)", border: "1.5px solid var(--border)",
                    borderRadius: "var(--radius)", fontFamily: "var(--font-sans)",
                    fontSize: "0.9375rem", color: "var(--text)", outline: "none",
                    transition: "border-color 0.2s",
                  }}
                  onFocus={e => e.target.style.borderColor = "var(--accent)"}
                  onBlur={e => e.target.style.borderColor = "var(--border)"}
                />
                {isStreaming ? (
                  <button onClick={handleStop} className="btn btn-secondary" style={{ height: "44px" }}>Stop</button>
                ) : (
                  <button onClick={() => handleSend(input)} disabled={!input.trim()} className="btn btn-primary" style={{ height: "44px" }}>Send</button>
                )}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-faint)", marginTop: "6px" }}>
                Enter to send · Shift+Enter for new line
                {cookware.length > 0 && (
                  <span style={{ marginLeft: "12px", color: "var(--olive)" }}>
                    {cookware.length} cookware items in your profile
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Recipes panel */}
        {activePanel === "recipes" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
            <h2 className="font-serif" style={{ fontSize: "1.5rem", fontStyle: "italic", marginBottom: "20px" }}>Saved Recipes</h2>
            {savedRecipes.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
                <p>No saved recipes yet. Ask me for a recipe and hit Save, or import one from a URL.</p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "16px" }}>
                {savedRecipes.map(recipe => (
                  <div
                    key={recipe.id}
                    className="card"
                    style={{
                      padding: "20px",
                      display: "flex",
                      flexDirection: "column",
                      minHeight: "190px",
                    }}
                  >
                    <h3 className="font-serif" style={{ fontSize: "1.1rem", fontStyle: "italic", margin: "0 0 8px", color: "var(--text)" }}>
                      {recipe.title}
                    </h3>
                    <div style={{ fontSize: "0.8125rem", color: "var(--text-faint)", marginBottom: "12px" }}>
                      {new Date(recipe.created_at).toLocaleDateString()}
                      {recipe.tags?.includes("imported") && (
                        <span className="badge badge-neutral" style={{ marginLeft: "8px", fontSize: "0.7rem" }}>imported</span>
                      )}
                    </div>
                    {recipe.cookware_used && recipe.cookware_used.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "12px" }}>
                        {recipe.cookware_used.slice(0, 3).map(c => (
                          <span key={c} className="badge badge-olive" style={{ fontSize: "0.7rem" }}>{c}</span>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: "8px", marginTop: "auto", paddingTop: "8px" }}>
                      <button onClick={() => handleCookMode(recipe)} className="btn btn-primary btn-sm">Cook</button>
                      <button
                        onClick={() => { setActivePanel("chat"); handleSend(`Tell me more about: ${recipe.title}`); }}
                        className="btn btn-secondary btn-sm"
                      >
                        Ask about it
                      </button>
                      <button
                        onClick={() => handleDeleteRecipe(recipe.id)}
                        className="btn btn-ghost btn-sm"
                        style={{ marginLeft: "auto", color: "var(--text-faint)" }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Import panel */}
        {activePanel === "import" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
            <h2 className="font-serif" style={{ fontSize: "1.5rem", fontStyle: "italic", marginBottom: "8px" }}>Import a Recipe</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9375rem", marginBottom: "24px" }}>
              Paste any recipe URL — AllRecipes, NYT Cooking, Serious Eats, BBC Good Food, and 300+ other sites.
            </p>

            <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
              <input
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleImport()}
                placeholder="https://www.allrecipes.com/recipe/..."
                className="input"
                style={{ flex: 1 }}
              />
              <button onClick={handleImport} disabled={importLoading || !importUrl.trim()} className="btn btn-primary">
                {importLoading ? "Importing..." : "Import"}
              </button>
            </div>

            {importError && (
              <div style={{ padding: "12px 14px", background: "var(--accent-light)", color: "var(--accent)", borderRadius: "var(--radius)", fontSize: "0.875rem", marginBottom: "16px" }}>
                {importError}
              </div>
            )}

            <div className="divider" style={{ marginBottom: "20px" }}>or search</div>

            <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder="Search for a recipe..."
                className="input"
                style={{ flex: 1 }}
              />
              <button onClick={handleSearch} disabled={searchLoading || !searchQuery.trim()} className="btn btn-secondary">
                {searchLoading ? "Searching..." : "Search"}
              </button>
            </div>

            {searchResults.length > 0 && !importedRecipe && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px", marginBottom: "24px" }}>
                {searchResults.map(r => (
                  <div
                    key={r.id}
                    className="card"
                    style={{ padding: 0, overflow: "hidden", cursor: "pointer" }}
                    onClick={() => handleSelectSearchResult(r.id)}
                  >
                    {r.image && (
                      <img src={r.image} alt={r.title} style={{ width: "100%", height: "130px", objectFit: "cover" }} />
                    )}
                    <div style={{ padding: "12px" }}>
                      <div style={{ fontSize: "0.875rem", fontWeight: 500, marginBottom: "4px", color: "var(--text)" }}>{r.title}</div>
                      {r.total_time && (
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{r.total_time} min</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {importedRecipe && (
              <div className="card" style={{ padding: "24px" }}>
                <div style={{ display: "flex", gap: "20px", marginBottom: "20px", flexWrap: "wrap" }}>
                  {importedRecipe.image && (
                    <img
                      src={importedRecipe.image}
                      alt={importedRecipe.title}
                      style={{ width: "160px", height: "120px", objectFit: "cover", borderRadius: "var(--radius)" }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <h3 className="font-serif" style={{ fontSize: "1.3rem", fontStyle: "italic", margin: "0 0 8px" }}>
                      {importedRecipe.title}
                    </h3>
                    <div style={{ display: "flex", gap: "16px", fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "12px" }}>
                      {importedRecipe.total_time && <span>{importedRecipe.total_time} min</span>}
                      <span>{importedRecipe.source_url.replace(/https?:\/\/(www\.)?/, "").split("/")[0]}</span>
                    </div>
                    {importedRecipe.cookware.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {importedRecipe.cookware.map(c => (
                          <span key={c} className="badge badge-olive">{c}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Serving adjuster */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px", padding: "12px 16px", background: "var(--bg-subtle)", borderRadius: "var(--radius)" }}>
                  <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Servings:</span>
                  <button onClick={() => handleScale(Math.max(1, importServings - 1))} className="btn btn-ghost btn-sm" style={{ padding: "4px 10px" }}>-</button>
                  <span style={{ fontWeight: 600, minWidth: "24px", textAlign: "center" }}>{importServings}</span>
                  <button onClick={() => handleScale(importServings + 1)} className="btn btn-ghost btn-sm" style={{ padding: "4px 10px" }}>+</button>
                  {importServings !== importedRecipe.servings && (
                    <span style={{ fontSize: "0.8125rem", color: "var(--olive)" }}>
                      Scaled from {importedRecipe.servings}
                    </span>
                  )}
                </div>

                {/* Ingredients */}
                <div className="prose" style={{ marginBottom: "20px" }}>
                  <h2>Ingredients</h2>
                  <ul>
                    {(scaledIngredients || importedRecipe.ingredients).map((ing, i) => (
                      <li key={i}>{"scaled_raw" in ing ? (ing as { scaled_raw: string }).scaled_raw : ing.raw}</li>
                    ))}
                  </ul>
                </div>

                {/* Instructions */}
                <div className="prose" style={{ marginBottom: "24px" }}>
                  <h2>Method</h2>
                  <ol>
                    {importedRecipe.instructions.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>

                <div style={{ display: "flex", gap: "10px" }}>
                  <button onClick={handleSaveImported} className="btn btn-primary">Save to library</button>
                  <button
                    onClick={() => handleCookMode({
                      id: "preview",
                      title: importedRecipe.title,
                      content: importedRecipe.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n"),
                      user_id: user.id,
                      created_at: new Date().toISOString(),
                    })}
                    className="btn btn-secondary"
                  >
                    Cook now
                  </button>
                  <button
                    onClick={() => { setImportedRecipe(null); setImportUrl(""); setScaledIngredients(null); }}
                    className="btn btn-ghost"
                    style={{ marginLeft: "auto" }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Cookware panel */}
        {activePanel === "cookware" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <h2 className="font-serif" style={{ fontSize: "1.5rem", fontStyle: "italic" }}>Your Cookware</h2>
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>{cookware.length} selected</span>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9375rem", marginBottom: "20px" }}>
              Select what you have. Every recipe will be checked against this list.
            </p>
            <input
              value={cookwareSearch}
              onChange={e => setCookwareSearch(e.target.value)}
              placeholder="Search cookware..."
              className="input"
              style={{ marginBottom: "16px" }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "24px" }}>
              {filteredCatalog.map(item => (
                <button
                  key={item}
                  onClick={() => setCookware(prev =>
                    prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]
                  )}
                  className={`cookware-chip ${cookware.includes(item) ? "selected" : ""}`}
                >
                  {cookware.includes(item) && <span>&#10003;</span>}
                  {item}
                </button>
              ))}
            </div>
            <button onClick={() => saveCookwareProfile(cookware)} className="btn btn-primary">
              Save profile
            </button>
          </div>
        )}
      </div>
    </div>
  );
}