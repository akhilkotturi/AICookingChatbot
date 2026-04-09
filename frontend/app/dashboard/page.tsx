"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Message, ConversationTurn, SavedRecipe, Panel, Theme } from "@/types";
import {
  streamQuery, getSavedRecipes, saveRecipe, deleteRecipe,
  getCookwareProfile, saveCookwareProfile, fetchCookwareCatalog,
  importRecipe, scaleRecipe, searchRecipes, getRecipeDetail, analyzeImage, type ImportedRecipe,
} from "@/lib/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MessageSquare, BookOpen, Utensils, Moon, Sun, LogOut, Send, Square, Bookmark, Trash2, Camera } from "lucide-react";

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

const CHAT_SESSIONS_KEY_PREFIX = "mise_chat_sessions_v2";
const CONTEXT_WINDOW_OPTIONS = [6, 12, 20, 30];

type PersistedMessage = Omit<Message, "timestamp"> & { timestamp: string };
type PersistedChatSession = {
  id: string;
  title: string;
  updatedAt: string;
  messages: PersistedMessage[];
};

function formatAssistantMarkdown(text: string): string {
  let out = text;

  // 1a. In the opening block (before first ##), split camelCase junctions so
  //     "RecipePasta carbonara..." → "Recipe\n\nPasta carbonara..."
  //     This handles the LLM gluing title text directly to the intro sentence.
  const firstHeadingIdx = out.indexOf("\n## ");
  const openingEnd = firstHeadingIdx > -1 ? firstHeadingIdx : Math.min(out.length, 300);
  const openingFixed = out.slice(0, openingEnd).replace(/([a-z])([A-Z])/g, "$1\n\n$2");
  out = openingFixed + out.slice(openingEnd);

  // 1b. Promote bare title (no # prefix) that sits before ## sections.
  if (!out.startsWith("#") && /\n##? /.test(out)) {
    out = out.replace(/^([^\n#][^\n]+)\n/, "# $1\n\n");
  }

  // 2. Heading glued directly to preceding text without any newline: "oil## Method" → "oil\n\n## Method"
  out = out.replace(/([^\n# ])(#{1,6} )/g, "$1\n\n$2");

  // 3. Ensure blank line BEFORE headings (has newline but not blank line).
  out = out.replace(/([^\n])\n(#{1,6} )/g, "$1\n\n$2");

  // 3b. Heading name glued directly to list content with NO newline: "## Method1. " or "## Tips> "
  out = out.replace(/(#{1,6} [A-Za-z][A-Za-z ]*)(\d+\. |> )/g, "$1\n\n$2");

  // 4. Split glued list items — LLM sometimes joins them as "word- Next item" with no newline.
  //    Match a non-space/non-newline/non-hyphen char immediately before "- " to avoid false positives.
  out = out.replace(/([^ \n\t-])- ([A-Z0-9])/g, "$1\n- $2");

  // 5. After an Ingredients/Tips/Method heading, if the first line of content has no list marker, add one.
  //    Handles: "## Ingredients\n250g..." → "## Ingredients\n\n- 250g..."
  out = out.replace(/(##\s*(?:Ingredients)\s*\n+)(?![-*\d#\n>])/gi, "$1- ");

  // 6. Ensure blank line after heading before content (one \n → two \n).
  out = out.replace(/(#{1,6} [^\n]+)\n(?!\n)/g, "$1\n\n");

  // 7. Normalize bold-as-heading section names.
  out = out.replace(
    /\n?\*\*(Ingredients|Method|Instructions|Tips|Steps|Best Substitute|How To Use It|What You Can Make|What Else You.d Need):\*\*/gi,
    "\n\n## $1"
  );

  // 8. Split glued numbered steps: "sentence.2. Next" → "sentence.\n2. Next"
  out = out.replace(/([.!?])\s*(\d+\.\s)/g, "$1\n$2");

  // 9. Collapse 3+ blank lines.
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
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
  const [previousChats, setPreviousChats] = useState<PersistedChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [contextWindowTurns, setContextWindowTurns] = useState(12);
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
  const [viewingRecipe, setViewingRecipe] = useState<SavedRecipe | null>(null);

  // Cook mode
  const [cookModeRecipe, setCookModeRecipe] = useState<SavedRecipe | null>(null);
  const [cookStep, setCookStep] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Vision
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function getChatStorageKey(): string {
    const userKey = safeUser.id || safeUser.email || "guest";
    return `${CHAT_SESSIONS_KEY_PREFIX}:${userKey}`;
  }

  function readPersistedChats(): PersistedChatSession[] {
    try {
      const raw = localStorage.getItem(getChatStorageKey());
      if (!raw) return [];
      const parsed = JSON.parse(raw) as PersistedChatSession[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writePersistedChats(chats: PersistedChatSession[]) {
    localStorage.setItem(getChatStorageKey(), JSON.stringify(chats));
  }

  useEffect(() => {
    const saved = localStorage.getItem("theme") as Theme | null;
    if (saved) applyTheme(saved);

    const chats = readPersistedChats();
    setPreviousChats(chats);

    // Auto-restore the latest chat on login/reload for continuity.
    if (chats.length > 0 && messages.length === 1) {
      const latest = chats[0];
      const restored: Message[] = latest.messages.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }));
      setMessages([WELCOME, ...restored]);
      setCurrentChatId(latest.id);
    }

    loadData();
  }, [safeUser.id, safeUser.email]);

  useEffect(() => {
    const serializable = messages
      .filter((m) => m.id !== "welcome" && !m.isStreaming)
      .map((m): PersistedMessage => ({ ...m, timestamp: m.timestamp.toISOString() }));

    if (serializable.length === 0) return;

    const sessionId = currentChatId ?? `chat_${Date.now()}`;
    if (!currentChatId) setCurrentChatId(sessionId);

    const firstUser = serializable.find((m) => m.role === "user")?.content?.trim();
    const title = firstUser ? firstUser.slice(0, 56) : "Cooking Chat";
    const updatedAt = new Date().toISOString();

    setPreviousChats((prev) => {
      const next = [
        { id: sessionId, title, updatedAt, messages: serializable },
        ...prev.filter((c) => c.id !== sessionId),
      ]
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, 20);

      writePersistedChats(next);
      return next;
    });
  }, [messages, currentChatId]);

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
      .slice(-contextWindowTurns)
      .map(m => ({ role: m.role, content: m.content })),
    [messages, contextWindowTurns]
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

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageLoading(true);
    setImageError(null);

    try {
      const { suggested_query, ingredients } = await analyzeImage(file);
      // Put the suggested query in the input box
      // User can edit it before sending or just hit send
      setInput(suggested_query);
      setActivePanel("chat");
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Could not analyze image.");
    } finally {
      setImageLoading(false);
      // Reset so same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m));
  }

  function handleLoadPreviousChat(chatId?: string) {
    try {
      const chats = readPersistedChats();
      if (chats.length === 0) return;
      const target = chatId ? chats.find((c) => c.id === chatId) : chats[0];
      if (!target) return;
      const restored: Message[] = target.messages.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }));
      setMessages([WELCOME, ...restored]);
      setCurrentChatId(target.id);
      setActivePanel("chat");
      setStreamError(null);
    } catch (error) {
      console.error("Failed to load previous chat:", error);
    }
  }

  function handleStartNewChat() {
    setMessages([WELCOME]);
    setInput("");
    setStreamError(null);
    setCurrentChatId(null);
  }

  function handleDeletePreviousChat(chatId: string) {
    const next = previousChats.filter((chat) => chat.id !== chatId);
    setPreviousChats(next);
    writePersistedChats(next);

    if (currentChatId === chatId) {
      if (next.length > 0) {
        handleLoadPreviousChat(next[0].id);
      } else {
        handleStartNewChat();
      }
    }
  }

  async function handleSaveRecipe(msg: Message) {
    setSavingRecipeId(msg.id);
    const formatted = formatAssistantMarkdown(msg.content);
    const titleMatch = formatted.match(/^#{1,3}\s+(.+)/m);
    const title = titleMatch?.[1]?.replace(/[*_]/g, "").trim().slice(0, 80) || "Saved Recipe";
    try {
      const id = await saveRecipe({
        title,
        content: formatted,
        cookware_used: msg.meta?.cookware_in_use || [],
        tags: msg.meta?.question_type ? [msg.meta.question_type] : [],
      });
      const newRecipe: SavedRecipe = {
        id, title, content: formatted,
        user_id: safeUser.id,
        cookware_used: msg.meta?.cookware_in_use || [],
        tags: msg.meta?.question_type ? [msg.meta.question_type] : [],
        created_at: new Date().toISOString(),
      };
      setSavedRecipes(prev => [newRecipe, ...prev]);
      setSaveError(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save recipe.");
    } finally { setSavingRecipeId(null); }
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
    // Always normalize content before cook mode so parseCookSteps can find ## Method
    const normalized = recipe.content.startsWith("#")
      ? recipe.content
      : formatAssistantMarkdown(recipe.content);
    setCookModeRecipe({ ...recipe, content: normalized });
    setCookStep(0);
    setTimerSeconds(null);
    setTimerRunning(false);
  }

  function parseCookSteps(content: string): string[] {
    // Extract only the Method/Instructions block so tips/ingredients don't bleed in.
    const instructionsBlock = content.match(/(?:^|\n)##?\s*(Method|Instructions)\s*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i)?.[2] ?? content;

    // Split on numbered markers (1. or 1)) and capture everything up to the next marker.
    // This preserves multi-line steps.
    const parts = instructionsBlock.split(/^\s*\d+[.)]\s+/m);
    const numbered = parts.slice(1).map(s => s.trim()).filter(Boolean);
    if (numbered.length > 0) return numbered;

    // Fallback: bullet list items (single-line only).
    const bullets = Array.from(
      instructionsBlock.matchAll(/^\s*[-*]\s+(.+)$/gm),
      (m) => m[1].trim()
    );
    if (bullets.length > 0) return bullets;

    // Last resort: split by blank lines.
    const paragraphs = instructionsBlock.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
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

  function buildAskAboutPrompt(recipe: SavedRecipe): string {
    const maxQueryLength = 980; // Keep below backend max_length=1000 with a little margin.
    const header = `I saved this recipe titled \"${recipe.title}\".\n\nRecipe:\n`;
    const footer = "\n\nPlease explain it step-by-step, suggest improvements, and answer questions about substitutions and timing.";
    const budget = Math.max(0, maxQueryLength - header.length - footer.length);
    const snippet = recipe.content.length > budget
      ? `${recipe.content.slice(0, Math.max(0, budget - 30))}\n\n[Recipe truncated for context]`
      : recipe.content;
    return `${header}${snippet}${footer}`;
  }

  const filteredCatalog = catalog.filter(i => i.toLowerCase().includes(cookwareSearch.toLowerCase()));

  const navItems: { panel: Panel; label: string; icon: React.ReactNode }[] = [
    { panel: "chat", label: "Chat", icon: <MessageSquare size={15} /> },
    { panel: "recipes", label: "Recipes", icon: <BookOpen size={15} /> },
    { panel: "cookware", label: "Cookware", icon: <Utensils size={15} /> },
    { panel: "import", label: "Import", icon: <Bookmark size={15} /> },
  ];

  // Cook mode overlay
  if (cookModeRecipe) {
    const steps = parseCookSteps(cookModeRecipe.content);
    const ingredientsMarkdown = extractIngredientsMarkdown(cookModeRecipe.content);
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

      {/* ── RECIPE DETAIL MODAL ── */}
      {viewingRecipe && (
        <div
          onClick={() => setViewingRecipe(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="recipe-modal"
          >
            {/* Modal header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "20px", gap: "16px" }}>
              <div>
                <h2 className="font-serif" style={{ fontSize: "1.4rem", fontStyle: "italic", margin: "0 0 4px" }}>{viewingRecipe.title}</h2>
                <div style={{ fontSize: "0.8rem", color: "var(--text-faint)" }}>{new Date(viewingRecipe.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</div>
              </div>
              <button onClick={() => setViewingRecipe(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "1.4rem", lineHeight: 1, padding: "0 4px", flexShrink: 0 }}>×</button>
            </div>

            {/* Rendered content */}
            <div className="prose recipe-modal-prose" style={{ flex: 1, overflowY: "auto" }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{viewingRecipe.content.startsWith("#") ? viewingRecipe.content : formatAssistantMarkdown(viewingRecipe.content)}</ReactMarkdown>
            </div>

            {/* Footer actions */}
            <div style={{ display: "flex", gap: "8px", paddingTop: "20px", borderTop: "1px solid var(--border)", marginTop: "20px" }}>
              <button onClick={() => { handleCookMode(viewingRecipe); setViewingRecipe(null); }} className="btn btn-primary btn-sm">Cook</button>
              <button
                onClick={() => { setViewingRecipe(null); setActivePanel("chat"); handleSend(buildAskAboutPrompt(viewingRecipe)); }}
                className="btn btn-secondary btn-sm"
              >
                Ask about it
              </button>
              {viewingRecipe.source_url && (
                <a href={viewingRecipe.source_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }}>Source ↗</a>
              )}
            </div>
          </div>
        </div>
      )}

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
            <img src="/logo.png" alt="Mise en Place" style={{ width: "28px", height: "28px", objectFit: "contain" }} />
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

        {/* Chat threads */}
        <div style={{ padding: "8px", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "6px" }}>
          <button onClick={handleStartNewChat} className="btn btn-secondary btn-sm" style={{ width: "100%", justifyContent: "center" }}>
            New chat
          </button>
          <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", padding: "4px 4px 2px" }}>
            Previous Chats
          </div>
          <div style={{ maxHeight: "180px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px", paddingRight: "2px" }}>
            {previousChats.length === 0 ? (
              <div style={{ fontSize: "0.78rem", color: "var(--text-faint)", padding: "4px" }}>No previous chats yet.</div>
            ) : (
              previousChats.map((chat) => (
                <div
                  key={chat.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    background: currentChatId === chat.id ? "var(--accent-light)" : "transparent",
                    borderRadius: "var(--radius-sm)",
                  }}
                  title={chat.title}
                >
                  <button
                    onClick={() => handleLoadPreviousChat(chat.id)}
                    className="btn btn-ghost btn-sm"
                    style={{
                      justifyContent: "flex-start",
                      flex: 1,
                      minWidth: 0,
                      color: currentChatId === chat.id ? "var(--accent)" : "var(--text-muted)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {chat.title}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeletePreviousChat(chat.id);
                    }}
                    className="btn btn-ghost btn-sm"
                    style={{
                      padding: "6px",
                      minWidth: "30px",
                      color: "var(--text-faint)",
                      flexShrink: 0,
                    }}
                    aria-label={`Delete chat ${chat.title}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

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
                  <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
                    {previousChats.length > 0 && (
                      <button onClick={() => handleLoadPreviousChat()} className="btn btn-secondary btn-sm">
                        Previous chat
                      </button>
                    )}
                    <button onClick={handleStartNewChat} className="btn btn-ghost btn-sm">
                      New chat
                    </button>
                  </div>
                  {previousChats.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "14px" }}>
                      {previousChats.slice(0, 3).map((chat) => (
                        <button
                          key={chat.id}
                          onClick={() => handleLoadPreviousChat(chat.id)}
                          className="btn btn-ghost btn-sm"
                          style={{ justifyContent: "flex-start" }}
                        >
                          {chat.title}
                        </button>
                      ))}
                    </div>
                  )}
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

            {/* Save error */}
            {saveError && (
              <div style={{ margin: "0 32px", padding: "10px 14px", background: "var(--accent-light)", color: "var(--accent)", borderRadius: "var(--radius)", fontSize: "0.875rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Could not save recipe: {saveError}</span>
                <button onClick={() => setSaveError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontWeight: 700 }}>×</button>
              </div>
            )}

            {/* Stream error */}
            {streamError && (
              <div style={{ margin: "0 32px", padding: "10px 14px", background: "var(--accent-light)", color: "var(--accent)", borderRadius: "var(--radius)", fontSize: "0.875rem" }}>
                {streamError}
              </div>
            )}

            {/* Input */}
            <div style={{ padding: "20px 32px 24px", background: "var(--bg-card)", borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-faint)" }}>
                  Context window
                </div>
                <select
                  value={contextWindowTurns}
                  onChange={(e) => setContextWindowTurns(parseInt(e.target.value, 10))}
                  className="input"
                  style={{ width: "120px", padding: "6px 8px", fontSize: "0.78rem" }}
                >
                  {CONTEXT_WINDOW_OPTIONS.map((n) => (
                    <option key={n} value={n}>Last {n} msgs</option>
                  ))}
                </select>
              </div>
              <div className="chat-input-wrap">
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImageUpload}
                  style={{ display: "none" }}
                />

                {/* Camera button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={imageLoading || isStreaming}
                  className="btn btn-ghost btn-sm btn-icon"
                  title="Analyze fridge photo"
                  style={{ flexShrink: 0, color: "var(--text-muted)" }}
                >
                  {imageLoading ? (
                    <span
                      className="auth-spinner"
                      style={{
                        width: "14px",
                        height: "14px",
                        borderColor: "var(--text-muted)",
                        borderTopColor: "transparent",
                      }}
                    />
                  ) : (
                    <Camera size={16} />
                  )}
                </button>

                <textarea
                  ref={textareaRef}
                  className="chat-textarea"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend(input);
                    }
                  }}
                  placeholder="Ask anything about cooking… or upload a fridge photo"
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

              {/* Error message below input */}
              {imageError && (
                <div style={{
                  fontSize: "0.75rem",
                  color: "var(--accent)",
                  marginTop: "4px",
                }}>
                  {imageError}
                </div>
              )}

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
                    </div>
                    {recipe.cookware_used && recipe.cookware_used.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "12px" }}>
                        {recipe.cookware_used.slice(0, 3).map(c => (
                          <span key={c} className="badge badge-olive" style={{ fontSize: "0.7rem" }}>{c}</span>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: "8px", marginTop: "auto", paddingTop: "8px" }}>
                      <button onClick={() => setViewingRecipe(recipe)} className="btn btn-secondary btn-sm">View</button>
                      <button onClick={() => handleCookMode(recipe)} className="btn btn-primary btn-sm">Cook</button>
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
