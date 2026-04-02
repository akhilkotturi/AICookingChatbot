export type MessageRole = "user" | "assistant";

export interface StreamMeta {
  scope: string | null;
  question_type: string | null;
  cookware_in_use: string[] | null;
  missing_cookware: string[] | null;
  is_recipe: boolean | null;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  meta?: StreamMeta;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface ConversationTurn {
  role: MessageRole;
  content: string;
}

export interface SavedRecipe {
  id: string;
  user_id: string;
  title: string;
  content: string;
  source_url?: string;
  cookware_used?: string[];
  servings?: number;
  tags?: string[];
  created_at: string;
}

export type Theme = "light" | "dark";
export type Panel = "chat" | "recipes" | "cookware" | "import";