import type { ConversationTurn, SavedRecipe, StreamMeta } from "@/types";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function getAuthHeader(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
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

  const response = await fetch(`${API_URL}/query/stream`, {
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
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    let eventType = "message";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        // Preserve model-emitted spaces; only drop the single optional SSE space after "data:".
        const rawData = line.slice(5);
        const data = rawData.startsWith(" ") ? rawData.slice(1) : rawData;
        if (eventType === "chunk") onChunk(data);
        else if (eventType === "done") onDone(JSON.parse(data) as StreamMeta);
        else if (eventType === "error") throw new Error(data);
        eventType = "message";
      }
    }
  }
}

export async function fetchCookwareCatalog(): Promise<string[]> {
  try {
    const res = await fetch(`${API_URL}/cookware`);
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
    const res = await fetch(`${API_URL}/profile/cookware`, { headers });
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
    await fetch(`${API_URL}/profile/cookware`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ cookware: items }),
    });
  } catch (error) {
    console.error("saveCookwareProfile failed:", error);
  }
}

export async function getSavedRecipes(): Promise<SavedRecipe[]> {
  const headers = await getAuthHeader();
  if (!headers.Authorization) return [];
  const res = await fetch(`${API_URL}/recipes`, { headers });
  if (!res.ok) return [];
  const data = await res.json();
  return data.recipes as SavedRecipe[];
}

export async function saveRecipe(recipe: Omit<SavedRecipe, "id" | "user_id" | "created_at">): Promise<string> {
  const headers = await getAuthHeader();
  const res = await fetch(`${API_URL}/recipes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(recipe),
  });
  if (!res.ok) throw new Error("Failed to save recipe");
  const data = await res.json();
  return data.id as string;
}

export async function deleteRecipe(id: string): Promise<void> {
  const headers = await getAuthHeader();
  await fetch(`${API_URL}/recipes/${id}`, { method: "DELETE", headers });
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
  const res = await fetch(`${API_URL}/recipe/import`, {
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
  const res = await fetch(`${API_URL}/recipe/scale`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ingredients, original_servings, target_servings }),
  });
  if (!res.ok) throw new Error("Could not scale recipe");
  return res.json();
}

export async function searchRecipes(q: string): Promise<{ results: { id: number; title: string; image: string; source_url: string; total_time: number }[] }> {
  const res = await fetch(`${API_URL}/recipe/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error("Search failed");
  return res.json();
}

export async function getRecipeDetail(id: number): Promise<ImportedRecipe> {
  const res = await fetch(`${API_URL}/recipe/detail/${id}`);
  if (!res.ok) throw new Error("Could not fetch recipe details");
  return res.json() as Promise<ImportedRecipe>;
}