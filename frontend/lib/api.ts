const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface ChatRequest {
    query: string;
}

export interface ChatResponse {
    result: string;
    cookware_in_use: string[] | null;
    scope: string;
    question_type: string | null;
}

export interface StreamMeta {
    scope: string | null;
    question_type: string | null;
    cookware_in_use: string[] | null;
    debug_trace?: string[] | null;
}

/** Non-streaming POST /query (kept for compatibility / testing). */
export async function sendQuery(query: string): Promise<ChatResponse> {
    const response = await fetch(`${API_URL}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
    });

    if (!response.ok) {
        throw new Error(`Backend error: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

/**
 * Streaming POST /query/stream via SSE.
 *
 * Calls `onChunk` for each token fragment, then `onDone` with final metadata.
 * Throws on network or server errors.
 */
export async function streamQuery(
    query: string,
    onChunk: (text: string) => void,
    onDone: (meta: StreamMeta) => void,
): Promise<void> {
    const response = await fetch(`${API_URL}/query/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
    });

    if (!response.ok) {
        throw new Error(`Backend error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "message";

        for (const line of lines) {
            if (line.startsWith("event:")) {
                eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
                const data = line.slice(5).trim();

                if (eventType === "chunk") {
                    onChunk(data);
                } else if (eventType === "done") {
                    onDone(JSON.parse(data) as StreamMeta);
                } else if (eventType === "error") {
                    throw new Error(data);
                }

                eventType = "message";
            }
        }
    }
}
