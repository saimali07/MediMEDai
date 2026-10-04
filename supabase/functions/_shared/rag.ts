// Retrieval over knowledge_chunks using Postgres full-text search (Groq has no embedding model).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface Chunk { id: number; source: string; url: string; content: string; rank: number }

/** Returns relevant reference chunks, or [] when nothing matches (the model is then told so). */
export async function retrieveContext(admin: SupabaseClient, query: string, k = 4): Promise<Chunk[]> {
  const q = query.trim().slice(0, 1500);
  if (!q) return [];
  try {
    const { data, error } = await admin.rpc("search_chunks", {
      q,
      k,
      min_rank: Number(Deno.env.get("RAG_MIN_RANK") ?? 0.05),
    });
    if (error || !Array.isArray(data)) return [];
    return data as Chunk[];
  } catch {
    return []; // retrieval is best-effort; the assessment then states that no references were found
  }
}

export function formatContext(chunks: Chunk[]): string {
  if (!chunks.length) return "NONE FOUND — do not cite any source.";
  return chunks.map((c, i) => `[${i + 1}] ${c.source} (${c.url})\n${c.content}`).join("\n\n");
}
