import type { ConversationTurn, SavedRecipe, StreamMeta } from "@/types";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_URL_FALLBACK = API_URL.includes("localhost")
  ? API_URL.replace("localhost", "127.0.0.1")
  : null;

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, init);
  } catch (error) {
    // Some local setups resolve localhost to IPv6 while backend listens on 127.0.0.1.
    if (API_URL_FALLBACK && error instanceof TypeError) {
      return fetch(`${API_URL_FALLBACK}${path}`, init);
    }
    throw error;
  }
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  console.log("[auth] session present:", !!session, "token prefix:", session?.access_token?.slice(0, 20));
  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` };
  }
  return {};
}

export async function streamQuery(
  query: string,
  conversation_history: ConversationTurn[],
  user_cookware: string[],
  onChunk: (text: string) => void,
  onDone: (meta: StreamMeta) => void,
  signal?: AbortSignal
): Promise<void> {
  const authHeaders = await getAuthHeader();

  const response = await apiFetch(`/query/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ query, conversation_history, user_cookware }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Backend error: ${response.status}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by a blank line. Each event can contain
    // multiple `data:` lines, which must be joined with newlines.
    const normalized = buffer.replace(/\r\n/g, "\n");
    const rawEvents = normalized.split("\n\n");
    buffer = rawEvents.pop() ?? "";

    for (const rawEvent of rawEvents) {
      let eventType = "message";
      const dataParts: string[] = [];

      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const rawData = line.slice(5);
          dataParts.push(rawData.startsWith(" ") ? rawData.slice(1) : rawData);
        }
      }

      if (dataParts.length === 0) continue;
      const data = dataParts.join("\n");

      if (eventType === "chunk") onChunk(data);
      else if (eventType === "done") onDone(JSON.parse(data) as StreamMeta);
      else if (eventType === "error") throw new Error(data);
    }
  }
}

export async function fetchCookwareCatalog(): Promise<string[]> {
  try {
    const res = await apiFetch(`/cookware`);
    if (!res.ok) throw new Error("Failed to fetch cookware catalog");
    const data = await res.json();
    return data.cookware as string[];
  } catch (error) {
    console.error("fetchCookwareCatalog failed:", error);
    return [];
  }
}

export async function getCookwareProfile(): Promise<string[]> {
  try {
    const headers = await getAuthHeader();
    if (!headers.Authorization) return [];
    const res = await apiFetch(`/profile/cookware`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return data.cookware as string[];
  } catch (error) {
    console.error("getCookwareProfile failed:", error);
    return [];
  }
}

export async function saveCookwareProfile(items: string[]): Promise<void> {
  try {
    const headers = await getAuthHeader();
    await apiFetch(`/profile/cookware`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ cookware: items }),
    });
  } catch (error) {
    console.error("saveCookwareProfile failed:", error);
  }
}

export async function getSavedRecipes(): Promise<SavedRecipe[]> {
  try {
    const headers = await getAuthHeader();
    if (!headers.Authorization) return [];
    const res = await apiFetch(`/recipes`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return data.recipes as SavedRecipe[];
  } catch (error) {
    console.error("getSavedRecipes failed:", error);
    return [];
  }
}

export async function saveRecipe(recipe: Omit<SavedRecipe, "id" | "user_id" | "created_at">): Promise<string> {
  const headers = await getAuthHeader();
  const res = await apiFetch(`/recipes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(recipe),
  });
  if (!res.ok) {
    let detail = "Failed to save recipe";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string" && data.detail.trim()) {
        detail = data.detail;
      }
    } catch {
      // Ignore JSON parse errors and keep a generic fallback message.
    }
    throw new Error(`Failed to save recipe (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return data.id as string;
}

export async function deleteRecipe(id: string): Promise<void> {
  const headers = await getAuthHeader();
  await apiFetch(`/recipes/${id}`, { method: "DELETE", headers });
}

export interface ImportedRecipe {
  title: string;
  source_url: string;
  servings: number;
  total_time: number | null;
  image: string | null;
  ingredients: { raw: string; name: string }[];
  instructions: string[];
  cookware: string[];
}

export async function importRecipe(url: string): Promise<ImportedRecipe> {
  const headers = await getAuthHeader();
  const res = await apiFetch(`/recipe/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error("Could not import recipe from that URL");
  return res.json() as Promise<ImportedRecipe>;
}

export async function scaleRecipe(
  ingredients: { raw: string; name: string }[],
  original_servings: number,
  target_servings: number
): Promise<{ ingredients: { raw: string; scaled_raw: string; name: string }[]; scale_factor: number }> {
  const res = await apiFetch(`/recipe/scale`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ingredients, original_servings, target_servings }),
  });
  if (!res.ok) throw new Error("Could not scale recipe");
  return res.json();
}

export async function searchRecipes(q: string): Promise<{ results: { id: number; title: string; image: string; source_url: string; total_time: number }[] }> {
  const res = await apiFetch(`/recipe/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error("Search failed");
  return res.json();
}

export async function getRecipeDetail(id: number): Promise<ImportedRecipe> {
  const res = await apiFetch(`/recipe/detail/${id}`);
  if (!res.ok) throw new Error("Could not fetch recipe details");
  return res.json() as Promise<ImportedRecipe>;
}