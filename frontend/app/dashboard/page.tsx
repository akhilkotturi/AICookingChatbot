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
import { MessageSquare, BookOpen, Utensils, Moon, Sun, LogOut, Send, Square, Bookmark } from "lucide-react";

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

function formatAssistantMarkdown(text: string): string {
  let formatted = text;

  // If model starts with "Title This...", promote title and split intro paragraph.
  formatted = formatted.replace(
    /^([A-Z][A-Za-z0-9'&(),:\-]*(?:\s+[A-Z][A-Za-z0-9'&(),:\-]*){1,10})\s+(This|A|An)\b/,
    "## $1\n\n$2"
  );

  // Fallback: handle plain first lines like "Quick Pasta Carbonara This ..." or "... It's ...".
  formatted = formatted.replace(
    /^(?![#>\-*])(\*\*)?([A-Z][A-Za-z0-9'&(),:\- ]{6,90}?)(\*\*)?\s+(This|It(?:'|’)s)\b/,
    (_m, _b1, title, _b2, lead) => `## ${title.trim()}\n\n${lead}`
  );

  // Split common heading markers onto their own lines.
  formatted = formatted.replace(/\s*(#{1,6}\s)/g, "\n\n$1");

  // Normalize common section labels regardless of model style.
  formatted = formatted.replace(/\s*(\*\*(?:Ingredients|Method|Instructions|Tips):\*\*)/gi, "\n\n$1\n");
  formatted = formatted.replace(/\s*(#{1,6}\s*(?:Ingredients|Method|Instructions|Tips)\b:?)/gi, "\n\n$1\n");

  // Ensure heading-to-list transitions are line-broken.
  formatted = formatted.replace(/(\*\*(?:Method|Instructions):\*\*)\s*(\d+\.\s+)/gi, "$1\n$2");
  formatted = formatted.replace(/(#{1,6}\s*(?:Method|Instructions)\b:?)[ \t]*(\d+\.\s+)/gi, "$1\n$2");
  formatted = formatted.replace(/(\*\*Tips:\*\*)\s*(>\s+)/gi, "$1\n$2");
  formatted = formatted.replace(/(#{1,6}\s*Tips\b:?)[ \t]*(>\s+)/gi, "$1\n$2");

  // Handle plain-text section labels glued to numbered steps, e.g. "Method1.".
  formatted = formatted.replace(/\b(Method|Instructions)\s*(\d+\.\s+)/gi, "\n\n## $1\n$2");

  // Split numbered steps when they are glued to punctuation, e.g. "draining.2.".
  formatted = formatted.replace(/([.!?])\s*(\d+\.\s+)/g, "$1\n$2");

  // Split bullet/numbered list markers onto their own lines.
  formatted = formatted.replace(/\s*(-\s+)/g, "\n$1");
  formatted = formatted.replace(/\s+(\d+\.\s+)/g, "\n$1");

  // Add space where stream chunks accidentally glued words together.
  formatted = formatted.replace(/([a-z0-9])([A-Z])/g, "$1 $2");

  // Keep whitespace compact without losing intentional line breaks.
  formatted = formatted.replace(/\n{3,}/g, "\n\n");

  return formatted.trim();
}

interface Props {
  user?: { id: string; email: string; name?: string };
}

export function DashboardClient({ user }: Props) {
  const safeUser = user ?? { id: "", email: "" };
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
  const [importUrl, setImportUrl] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
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
          if (s === null || s <= 1) { setTimerRunning(false); clearInterval(timerRef.current!); return 0; }
          return s - 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  async function loadData() {
    try {
      const [recipes, cw, cat] = await Promise.all([getSavedRecipes(), getCookwareProfile(), fetchCookwareCatalog()]);
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

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: query, timestamp: new Date() };
    const asstId = `a-${Date.now()}`;
    const asstMsg: Message = { id: asstId, role: "assistant", content: "", timestamp: new Date(), isStreaming: true };

    setMessages(prev => [...prev, userMsg, asstMsg]);
    setIsStreaming(true);
    abortRef.current = new AbortController();

    try {
      await streamQuery(
        query,
        history(),
        cookware,
        (chunk) => setMessages(prev => prev.map(m => m.id === asstId ? { ...m, content: m.content + chunk } : m)),
        (meta) => setMessages(prev => prev.map(m => m.id === asstId ? { ...m, meta, isStreaming: false } : m)),
        abortRef.current.signal,
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setStreamError(err instanceof Error ? err.message : "Unknown error");
      setMessages(prev => prev.map(m => m.id === asstId ? { ...m, content: m.content || "Something went wrong. Please try again.", isStreaming: false } : m));
    } finally {
      setIsStreaming(false);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m));
  }

  async function handleSaveRecipe(msg: Message) {
    setSavingRecipeId(msg.id);
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
        id, title, content: msg.content,
        user_id: safeUser.id,
        cookware_used: msg.meta?.cookware_in_use || [],
        tags: msg.meta?.question_type ? [msg.meta.question_type] : [],
        created_at: new Date().toISOString(),
      };
      setSavedRecipes(prev => [newRecipe, ...prev]);
    } catch (e) { console.error(e); }
    finally { setSavingRecipeId(null); }
  }

  async function handleDeleteRecipe(id: string) {
    await deleteRecipe(id);
    setSavedRecipes(prev => prev.filter(r => r.id !== id));
  }

  async function handleImportRecipe() {
    const url = importUrl.trim();
    if (!url) return;
    setImportLoading(true);
    setImportError(null);
    setImportSuccess(null);
    setImportedRecipe(null);
    setScaledIngredients(null);
    try {
      const recipe = await importRecipe(url);
      setImportedRecipe(recipe);
      setImportServings(recipe.servings);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not import recipe.");
    } finally {
      setImportLoading(false);
    }
  }

  async function handleSaveImported() {
    if (!importedRecipe) return;
    const displayIngredients = scaledIngredients || importedRecipe.ingredients;
    const ingredients = displayIngredients
      .map(i => `- ${"scaled_raw" in i ? (i as { scaled_raw: string }).scaled_raw : i.raw}`)
      .join("\n");
    const instructions = importedRecipe.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const content = [
      `# ${importedRecipe.title}`,
      "",
      `**Servings:** ${importServings}`,
      importedRecipe.total_time ? `**Time:** ${importedRecipe.total_time} minutes` : "",
      "",
      "## Ingredients",
      "",
      ingredients || "- Ingredients not available",
      "",
      "## Method",
      "",
      instructions || "1. Instructions not available",
    ].filter(Boolean).join("\n");
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
        user_id: safeUser.id,
        title: importedRecipe.title,
        content,
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
      setImportSuccess("Recipe saved to your library!");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not save recipe.");
    }
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

  function handleCookMode(recipe: SavedRecipe) {
    setCookModeRecipe(recipe);
    setCookStep(0);
    setTimerSeconds(null);
    setTimerRunning(false);
  }

  function parseCookSteps(content: string): string[] {
    const lines = content.split("\n");
    const steps: string[] = [];
    for (const line of lines) {
      const match = line.match(/^\d+\.\s+(.+)/);
      if (match) steps.push(match[1].trim());
    }
    return steps.length > 0 ? steps : [content];
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

  const filteredCatalog = catalog.filter(i => i.toLowerCase().includes(cookwareSearch.toLowerCase()));

  const navItems: { panel: Panel; label: string; icon: React.ReactNode }[] = [
    { panel: "chat",     label: "Chat",     icon: <MessageSquare size={15} /> },
    { panel: "recipes",  label: "Recipes",  icon: <BookOpen size={15} /> },
    { panel: "cookware", label: "Cookware", icon: <Utensils size={15} /> },
    { panel: "import",   label: "Import",   icon: <Bookmark size={15} /> },
  ];

  // Cook mode overlay
  if (cookModeRecipe) {
    const steps = parseCookSteps(cookModeRecipe.content);
    const currentStep = steps[cookStep] || "";
    const detectedTime = parseStepTime(currentStep);

    return (
      <div style={{ position: "fixed", inset: 0, background: "var(--bg)", zIndex: 100, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-card)" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "2px" }}>Cook Mode</div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: "1.1rem", fontStyle: "italic" }}>{cookModeRecipe.title}</div>
          </div>
          <button onClick={() => setCookModeRecipe(null)} className="btn btn-ghost btn-sm">Exit</button>
        </div>

        {/* Progress */}
        <div style={{ height: "4px", background: "var(--border)" }}>
          <div style={{ height: "100%", background: "var(--accent)", width: `${((cookStep + 1) / steps.length) * 100}%`, transition: "width 0.3s ease" }} />
        </div>

        {/* Step */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", maxWidth: "600px", margin: "0 auto", width: "100%" }}>
          <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginBottom: "24px" }}>
            Step {cookStep + 1} of {steps.length}
          </div>
          <div style={{ fontSize: "1.25rem", lineHeight: "1.7", textAlign: "center", color: "var(--text)", marginBottom: "40px" }}>
            {currentStep}
          </div>

          {/* Timer */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", marginBottom: "40px" }}>
            {timerSeconds !== null && (
              <div style={{ fontSize: "2.5rem", fontFamily: "var(--font-serif)", color: timerSeconds === 0 ? "var(--olive)" : "var(--accent)" }}>
                {timerSeconds === 0 ? "Done!" : formatTime(timerSeconds)}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px" }}>
              {detectedTime && timerSeconds === null && (
                <button className="btn btn-secondary btn-sm" onClick={() => setTimerSeconds(detectedTime)}>
                  Set {Math.floor(detectedTime / 60)}min timer
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

          {/* Navigation */}
          <div style={{ display: "flex", gap: "12px" }}>
            <button className="btn btn-secondary" onClick={() => { setCookStep(s => Math.max(0, s - 1)); setTimerSeconds(null); setTimerRunning(false); }} disabled={cookStep === 0}>
              Previous
            </button>
            <button className="btn btn-primary" onClick={() => { setCookStep(s => Math.min(steps.length - 1, s + 1)); setTimerSeconds(null); setTimerRunning(false); }} disabled={cookStep === steps.length - 1}>
              {cookStep === steps.length - 1 ? "Finished" : "Next step"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 39 }} />
      )}

      {/* Sidebar */}
      <aside style={{
        width: "240px", minWidth: "240px", background: "var(--bg-card)",
        borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column",
        height: "100vh", position: "fixed", left: 0, top: 0, zIndex: 40,
        transform: sidebarOpen ? "translateX(0)" : undefined,
      }}>
        {/* Logo */}
        <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "1.4rem" }}>🍳</span>
            <span className="font-serif" style={{ fontSize: "1.0rem", fontStyle: "italic", color: "var(--text)" }}>Mise en Place</span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: "12px 8px" }}>
          {navItems.map(item => (
            <button
              key={item.panel}
              onClick={() => { setActivePanel(item.panel); setSidebarOpen(false); }}
              className="btn btn-ghost"
              style={{
                width: "100%",
                justifyContent: "flex-start",
                borderRadius: "var(--radius-sm)",
                marginBottom: "2px",
                padding: "10px 12px",
                background: activePanel === item.panel ? "var(--accent-light)" : "transparent",
                color: activePanel === item.panel ? "var(--accent)" : "var(--text-muted)",
                fontWeight: activePanel === item.panel ? 500 : 400,
                borderLeft: activePanel === item.panel ? "3px solid var(--accent)" : "3px solid transparent",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", marginRight: "8px" }}>{item.icon}</span>
              {item.label}
              {item.panel === "recipes" && savedRecipes.length > 0 && (
                <span className="badge badge-neutral" style={{ marginLeft: "auto", padding: "1px 7px", fontSize: "0.7rem" }}>{savedRecipes.length}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Kitchen section */}
        {cookware.length > 0 && (
          <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", marginTop: "4px" }}>
            <div style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "6px" }}>
              YOUR KITCHEN
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", color: "var(--text-muted)" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--olive)", display: "inline-block", flexShrink: 0 }} />
              {cookware.length} items ready
            </div>
          </div>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Bottom */}
        <div style={{ padding: "12px 8px", borderTop: "1px solid var(--border)" }}>
          {/* User pill */}
          <div style={{
            padding: "7px 12px",
            background: "var(--bg-subtle)",
            borderRadius: "var(--radius-sm)",
            marginBottom: "6px",
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {safeUser.name || safeUser.email || "Signed in user"}
          </div>

          <button
            onClick={() => applyTheme(theme === "light" ? "dark" : "light")}
            className="btn btn-ghost btn-sm"
            style={{ width: "100%", justifyContent: "flex-start", marginBottom: "2px" }}
          >
            {theme === "light" ? <><Moon size={14} /> Dark mode</> : <><Sun size={14} /> Light mode</>}
          </button>
          <button onClick={handleSignOut} className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start", color: "var(--text-faint)" }}>
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div style={{ marginLeft: "240px", flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>

        {/* Mobile header */}
        <div style={{ display: "none", padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }} className="mobile-header">
          <button onClick={() => setSidebarOpen(true)} className="btn btn-ghost btn-icon">☰</button>
        </div>

        {/* ── CHAT PANEL ── */}
        {activePanel === "chat" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Messages */}
            <div className="chat-area">
              {/* Empty state */}
              {messages.length === 1 && (
                <div style={{ padding: "0 0 36px" }}>
                  <div
                    className="font-serif"
                    style={{
                      fontSize: "2rem",
                      fontStyle: "italic",
                      color: "var(--text)",
                      marginBottom: "8px",
                      lineHeight: 1.2,
                    }}
                  >
                    Bonjour, {safeUser.name?.split(" ")[0] || "chef"}.
                  </div>
                  <div style={{ fontSize: "1rem", color: "var(--text-muted)", marginBottom: "24px" }}>
                    What are we cooking today?
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {STARTERS.map(s => (
                      <button key={s} onClick={() => handleSend(s)} className="btn btn-secondary btn-sm" style={{ borderRadius: "99px" }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.filter(m => m.id !== "welcome").map((msg, i) => {
                if (msg.role === "user") {
                  return (
                    <div
                      key={msg.id}
                      className="animate-fade-up"
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        marginBottom: "16px",
                        animationDelay: `${i * 0.02}s`,
                      }}
                    >
                      <div style={{
                        background: "var(--text)",
                        color: "var(--bg)",
                        borderRadius: "20px 20px 4px 20px",
                        padding: "11px 18px",
                        maxWidth: "65%",
                        fontSize: "0.9375rem",
                        lineHeight: 1.6,
                        boxShadow: "var(--shadow-sm)",
                      }}>
                        {msg.content}
                      </div>
                    </div>
                  );
                }

                // Assistant message
                return (
                  <div
                    key={msg.id}
                    className="animate-fade-up"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      marginBottom: "32px",
                      width: "100%",
                      animationDelay: `${i * 0.02}s`,
                    }}
                  >
                    <div className="msg-ai-label">Mise en Place</div>

                    {/* Typing indicator */}
                    {msg.isStreaming && msg.content === "" && (
                      <div style={{ display: "flex", gap: "4px", padding: "4px 0" }}>
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                      </div>
                    )}

                    {/* Content */}
                    {msg.content && (
                      <div className="prose" style={{ width: "100%", maxWidth: "100%" }}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            table: ({ children }) => (
                              <div style={{ overflowX: "auto", margin: "0.75em 0" }}>
                                <table>{children}</table>
                              </div>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote>{children}</blockquote>
                            ),
                          }}
                        >{formatAssistantMarkdown(msg.content)}</ReactMarkdown>
                      </div>
                    )}

                    {/* Meta badges */}
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

                    {/* Save recipe button */}
                    {msg.meta?.is_recipe && !msg.isStreaming && (
                      <div style={{ marginTop: "10px", display: "flex", gap: "8px" }}>
                        <button
                          onClick={() => handleSaveRecipe(msg)}
                          disabled={savingRecipeId === msg.id}
                          className="btn btn-secondary btn-sm"
                        >
                          <Bookmark size={13} />
                          {savingRecipeId === msg.id ? "Saving…" : "Save recipe"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Error */}
            {streamError && (
              <div style={{ margin: "0 32px", padding: "10px 14px", background: "var(--accent-light)", color: "var(--accent)", borderRadius: "var(--radius)", fontSize: "0.875rem" }}>
                {streamError}
              </div>
            )}

            {/* Input */}
            <div style={{ padding: "20px 32px 24px", background: "var(--bg-card)", borderTop: "1px solid var(--border)" }}>
              <div className="chat-input-wrap">
                <textarea
                  ref={textareaRef}
                  className="chat-textarea"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(input); } }}
                  placeholder="Ask anything about cooking…"
                  rows={2}
                />
                {isStreaming ? (
                  <button onClick={handleStop} className="btn btn-secondary btn-sm" style={{ borderRadius: "12px", padding: "8px 14px", flexShrink: 0 }}>
                    <Square size={14} />
                    Stop
                  </button>
                ) : (
                  <button onClick={() => handleSend(input)} disabled={!input.trim()} className="btn btn-primary btn-sm" style={{ borderRadius: "12px", padding: "8px 14px", flexShrink: 0 }}>
                    <Send size={14} />
                    Send
                  </button>
                )}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-faint)", marginTop: "8px", display: "flex", alignItems: "center", gap: "4px" }}>
                Enter to send · Shift+Enter for new line
                {cookware.length > 0 && (
                  <span style={{ marginLeft: "8px", color: "var(--olive)" }}>· {cookware.length} cookware items in profile</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── RECIPES PANEL ── */}
        {activePanel === "recipes" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
            <h2 className="font-serif" style={{ fontSize: "1.5rem", fontStyle: "italic", marginBottom: "20px" }}>Saved Recipes</h2>
            {savedRecipes.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>📖</div>
                <p>No saved recipes yet. Ask me for a recipe and hit Save.</p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "16px" }}>
                {savedRecipes.map(recipe => (
                  <div key={recipe.id} className="card" style={{ padding: "20px" }}>
                    <h3 className="font-serif" style={{ fontSize: "1.1rem", fontStyle: "italic", margin: "0 0 8px", color: "var(--text)" }}>
                      {recipe.title}
                    </h3>
                    <div style={{ fontSize: "0.8125rem", color: "var(--text-faint)", marginBottom: "12px" }}>
                      {new Date(recipe.created_at).toLocaleDateString()}
                    </div>
                    {recipe.cookware_used && recipe.cookware_used.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "12px" }}>
                        {recipe.cookware_used.slice(0, 3).map(c => (
                          <span key={c} className="badge badge-olive" style={{ fontSize: "0.7rem" }}>{c}</span>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => handleCookMode(recipe)} className="btn btn-primary btn-sm">Cook</button>
                      <button onClick={() => { setActivePanel("chat"); handleSend(`Tell me more about: ${recipe.title}`); }} className="btn btn-secondary btn-sm">Ask about it</button>
                      <button onClick={() => handleDeleteRecipe(recipe.id)} className="btn btn-ghost btn-sm" style={{ marginLeft: "auto", color: "var(--text-faint)" }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── COOKWARE PANEL ── */}
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
              placeholder="Search cookware…"
              className="input"
              style={{ marginBottom: "16px" }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "24px" }}>
              {filteredCatalog.map(item => (
                <button
                  key={item}
                  onClick={() => setCookware(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item])}
                  className={`cookware-chip ${cookware.includes(item) ? "selected" : ""}`}
                >
                  {cookware.includes(item) && <span>✓</span>}
                  {item}
                </button>
              ))}
            </div>
            <button
              onClick={() => saveCookwareProfile(cookware)}
              className="btn btn-primary"
            >
              Save profile
            </button>
          </div>
        )}

        {/* ── IMPORT PANEL ── */}
        {activePanel === "import" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "24px", maxWidth: "760px" }}>
            <h2 className="font-serif" style={{ fontSize: "1.5rem", fontStyle: "italic", marginBottom: "8px" }}>Import a Recipe</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9375rem", marginBottom: "20px" }}>
              Paste any recipe URL — AllRecipes, NYT Cooking, Serious Eats, BBC Good Food, and 300+ other sites.
            </p>

            {/* URL import */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "8px" }}>
              <input
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleImportRecipe()}
                placeholder="https://www.allrecipes.com/recipe/..."
                className="input"
                style={{ flex: 1 }}
              />
              <button onClick={handleImportRecipe} disabled={importLoading || !importUrl.trim()} className="btn btn-primary">
                {importLoading ? "Loading…" : "Import"}
              </button>
            </div>

            {importError && (
              <div style={{ padding: "10px 14px", background: "var(--accent-light)", color: "var(--accent)", borderRadius: "var(--radius)", fontSize: "0.875rem", marginBottom: "12px" }}>
                {importError}
              </div>
            )}
            {importSuccess && (
              <div style={{ padding: "10px 14px", background: "var(--olive-light)", color: "var(--olive)", borderRadius: "var(--radius)", fontSize: "0.875rem", marginBottom: "12px" }}>
                {importSuccess}
              </div>
            )}

            {/* Search divider */}
            {!importedRecipe && (
              <>
                <div className="divider" style={{ margin: "20px 0" }}>or search Spoonacular</div>
                <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSearch()}
                    placeholder="Search for a recipe…"
                    className="input"
                    style={{ flex: 1 }}
                  />
                  <button onClick={handleSearch} disabled={searchLoading || !searchQuery.trim()} className="btn btn-secondary">
                    {searchLoading ? "Searching…" : "Search"}
                  </button>
                </div>

                {searchResults.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "12px" }}>
                    {searchResults.map(r => (
                      <div
                        key={r.id}
                        className="card"
                        style={{ padding: 0, overflow: "hidden", cursor: "pointer" }}
                        onClick={() => handleSelectSearchResult(r.id)}
                      >
                        {r.image && <img src={r.image} alt={r.title} style={{ width: "100%", height: "120px", objectFit: "cover" }} />}
                        <div style={{ padding: "10px 12px" }}>
                          <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--text)", marginBottom: "4px", lineHeight: 1.3 }}>{r.title}</div>
                          {r.total_time > 0 && <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{r.total_time} min</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Recipe preview */}
            {importedRecipe && (
              <div className="card" style={{ padding: "24px", marginTop: "8px" }}>
                {/* Header */}
                <div style={{ display: "flex", gap: "20px", marginBottom: "20px", flexWrap: "wrap" }}>
                  {importedRecipe.image && (
                    <img src={importedRecipe.image} alt={importedRecipe.title} style={{ width: "150px", height: "110px", objectFit: "cover", borderRadius: "var(--radius)" }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <h3 className="font-serif" style={{ fontSize: "1.25rem", fontStyle: "italic", margin: "0 0 8px" }}>{importedRecipe.title}</h3>
                    <div style={{ display: "flex", gap: "14px", fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "10px" }}>
                      {importedRecipe.total_time && <span>{importedRecipe.total_time} min</span>}
                      <span>{importedRecipe.source_url.replace(/https?:\/\/(www\.)?/, "").split("/")[0]}</span>
                    </div>
                    {importedRecipe.cookware.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {importedRecipe.cookware.map(c => <span key={c} className="badge badge-olive">{c}</span>)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Servings adjuster */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px", padding: "10px 16px", background: "var(--bg-subtle)", borderRadius: "var(--radius)" }}>
                  <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Servings:</span>
                  <button onClick={() => handleScale(Math.max(1, importServings - 1))} className="btn btn-ghost btn-sm" style={{ padding: "4px 10px" }}>−</button>
                  <span style={{ fontWeight: 600, minWidth: "24px", textAlign: "center" }}>{importServings}</span>
                  <button onClick={() => handleScale(importServings + 1)} className="btn btn-ghost btn-sm" style={{ padding: "4px 10px" }}>+</button>
                  {importServings !== importedRecipe.servings && (
                    <span style={{ fontSize: "0.8125rem", color: "var(--olive)" }}>Scaled from {importedRecipe.servings}</span>
                  )}
                </div>

                {/* Ingredients */}
                <div className="prose" style={{ marginBottom: "16px" }}>
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
                    {importedRecipe.instructions.map((step, i) => <li key={i}>{step}</li>)}
                  </ol>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <button onClick={handleSaveImported} className="btn btn-primary">Save to library</button>
                  <button
                    onClick={() => handleCookMode({
                      id: "preview", title: importedRecipe.title,
                      content: importedRecipe.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n"),
                      user_id: safeUser.id, created_at: new Date().toISOString(),
                    })}
                    className="btn btn-secondary"
                  >
                    Cook now
                  </button>
                  <button
                    onClick={() => { setImportedRecipe(null); setImportUrl(""); setScaledIngredients(null); setImportSuccess(null); }}
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
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return <DashboardClient />;
}
