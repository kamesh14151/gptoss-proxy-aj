export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return handleOptions(req);

    // root info
    if (url.pathname === "/" && req.method === "GET") {
      return new Response(
        JSON.stringify({
          success: true,
          discord: "https://discord.gg/cwDTVKyKJz",
          website: "https://ish.junioralive.in",
          repo: "https://github.com/junioralive/gptoss-proxy",
        }),
        { status: 200, headers: corsHeaders({ "content-type": "application/json" }) }
      );
    }

    // OpenAI-like: list models
    if (url.pathname === "/v1/models" && req.method === "GET") {
      return listModels();
    }

    // OpenAI-compatible chat completions (single endpoint)
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      return openAICompatible(req, env);
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: corsHeaders({ "content-type": "application/json" }),
    });
  },
};

/* ----------------------- constants ----------------------- */

const OLLAMA_URL = "https://ollama.com/api/chat";
const SUPPORTED_MODELS = new Set(["gpt-oss:120b", "gpt-oss-20b"]);



/* ----------------------- helpers ----------------------- */

function corsHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers":
      // added x-show-reasoning to allow client override
      "content-type, x-reasoning-effort, x-gptoss-thread-id, x-gptoss-user-id, x-show-reasoning, authorization",
    "access-control-expose-headers": "x-gptoss-user-id, x-gptoss-thread-id",
    ...extra,
  };
}

function handleOptions(_req) {
  return new Response(null, { headers: corsHeaders() });
}



function sseResponseHeaders() {
  return {
    ...corsHeaders(),
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  };
}

function cryptoRandomId(n) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}



/* ----------------------- /v1/models ----------------------- */

function listModels() {
  const now = Math.floor(Date.now() / 1000);
  const models = [...SUPPORTED_MODELS].map((id) => ({
    id,
    object: "model",
    created: now,
    owned_by: "gpt-oss",
    permission: [],
    root: id,
    parent: null,
  }));
  return new Response(
    JSON.stringify({ object: "list", data: models }),
    { status: 200, headers: corsHeaders({ "content-type": "application/json" }) }
  );
}

/* --------------- /v1/chat/completions (OpenAI) --------------- */

async function openAICompatible(req, env) {
  const body = await req.json().catch(() => ({}));
  let model = (body && body.model) || "gpt-oss:120b";
  const stream = Boolean(body && body.stream);
  const messages = (body && Array.isArray(body.messages) && body.messages) || [];

  // Map OpenAI model names to Ollama model names
  if (model === "gpt-oss-120b") model = "gpt-oss:120b";
  if (model === "gpt-oss-20b") model = "gpt-oss:20b";

  if (!SUPPORTED_MODELS.has(model)) {
    return new Response(
      JSON.stringify({
        error: { message: `Unsupported model: ${model}`, supported: [...SUPPORTED_MODELS] },
      }),
      { status: 400, headers: corsHeaders({ "content-type": "application/json" }) }
    );
  }

  // Prepare Ollama API request body
  const ollamaBody = JSON.stringify({
    model: model,
    messages: messages,
    stream: stream
  });

  const headers = {
    "Content-Type": "application/json"
  };
  
  // Add Authorization header if OLLAMA_API_KEY is available in environment
  if (env && env.OLLAMA_API_KEY) {
    headers["Authorization"] = `Bearer ${env.OLLAMA_API_KEY}`;
  }

  const upstream = await fetch(OLLAMA_URL, {
    method: "POST",
    headers,
    body: ollamaBody,
  });

  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: `Upstream ${upstream.status}: ${await upstream.text()}` }),
      { status: 502, headers: corsHeaders({ "content-type": "application/json" }) }
    );
  }

  const created = Math.floor(Date.now() / 1000);
  const openaiId = `chatcmpl_${cryptoRandomId(24)}`;

  if (!stream) {
    const ollamaResponse = await upstream.json();
    
    // Convert Ollama response to OpenAI format
    const resp = {
      id: openaiId,
      object: "chat.completion",
      created,
      model: body.model || "gpt-oss-120b", // Return original model name
      choices: [
        {
          index: 0,
          message: { 
            role: "assistant", 
            content: ollamaResponse.message?.content || "" 
          },
          finish_reason: "stop",
        },
      ],
      usage: { 
        prompt_tokens: ollamaResponse.prompt_eval_count || null, 
        completion_tokens: ollamaResponse.eval_count || null, 
        total_tokens: (ollamaResponse.prompt_eval_count || 0) + (ollamaResponse.eval_count || 0) || null 
      },
      system_fingerprint: JSON.stringify({
        gptoss_thread_id: `thr_${cryptoRandomId(8)}`,
        reasoning_joined: ""
      }),
    };
    return new Response(JSON.stringify(resp), {
      status: 200,
      headers: corsHeaders({ "content-type": "application/json" }),
    });
  }

  // streaming transform (Ollama streaming -> OpenAI SSE)
  const streamOut = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      // initial empty delta
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            id: openaiId,
            object: "chat.completion.chunk",
            created,
            model: body.model || "gpt-oss-120b", // Return original model name
            choices: [{ index: 0, delta: {}, finish_reason: null }],
          })}\n\n`
        )
      );

      let buffer = "";
      const reader = upstream.body.getReader();
      let isFinished = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let nl;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);

            if (!line) continue;

            let ollamaChunk;
            try {
              ollamaChunk = JSON.parse(line);
            } catch {
              continue;
            }

            // Handle Ollama streaming response format
            if (ollamaChunk.message && ollamaChunk.message.content) {
              const chunk = {
                id: openaiId,
                object: "chat.completion.chunk",
                created,
                model: body.model || "gpt-oss-120b",
                choices: [{ 
                  index: 0, 
                  delta: { content: ollamaChunk.message.content }, 
                  finish_reason: null 
                }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }

            // Check if done
            if (ollamaChunk.done === true) {
              const end = {
                id: openaiId,
                object: "chat.completion.chunk",
                created,
                model: body.model || "gpt-oss-120b",
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(end)}\n\n`));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              isFinished = true;
              break;
            }
          }
        }

        // Send finish if not already sent
        if (!isFinished) {
          const end = {
            id: openaiId,
            object: "chat.completion.chunk",
            created,
            model: body.model || "gpt-oss-120b",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(end)}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }
      } catch (e) {
        console.error("Streaming error:", e);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(streamOut, {
    status: 200,
    headers: sseResponseHeaders(),
  });
}


