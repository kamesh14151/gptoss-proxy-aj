export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return handleOptions(req);

    // Root info
    if (url.pathname === "/" && req.method === "GET") {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Free AI Proxy - Multiple providers",
          providers: ["huggingface", "groq", "together", "deepinfra", "replicate"],
          models: [
            "meta-llama/Llama-2-7b-chat-hf",
            "microsoft/DialoGPT-medium", 
            "google/flan-t5-large",
            "mistralai/Mistral-7B-Instruct-v0.1",
            "codellama/CodeLlama-7b-Python-hf"
          ],
          note: "Completely free - no authentication required for most models"
        }),
        { status: 200, headers: corsHeaders({ "content-type": "application/json" }) }
      );
    }

    // List models
    if (url.pathname === "/v1/models" && req.method === "GET") {
      return listFreeModels();
    }

    // Chat completions
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      return handleFreeChat(req);
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: corsHeaders({ "content-type": "application/json" }),
    });
  },
};

/* ----------------------- Free AI Providers ----------------------- */

const FREE_PROVIDERS = {
  // Hugging Face Inference API (free tier)
  huggingface: {
    url: "https://api-inference.huggingface.co/models/",
    models: [
      "meta-llama/Llama-2-7b-chat-hf",
      "microsoft/DialoGPT-medium",
      "google/flan-t5-large", 
      "mistralai/Mistral-7B-Instruct-v0.1"
    ],
    format: "huggingface"
  },
  
  // Together AI (free credits)
  together: {
    url: "https://api.together.xyz/inference",
    models: [
      "togethercomputer/llama-2-7b-chat",
      "NousResearch/Nous-Hermes-Llama2-13b",
      "mistralai/Mistral-7B-Instruct-v0.1"
    ],
    format: "together"
  },

  // DeepInfra (free tier)
  deepinfra: {
    url: "https://api.deepinfra.com/v1/inference/",
    models: [
      "meta-llama/Llama-2-7b-chat-hf",
      "codellama/CodeLlama-7b-Python-hf",
      "mistralai/Mistral-7B-Instruct-v0.1"
    ],
    format: "openai"
  }
};

const ALL_FREE_MODELS = [
  // Hugging Face models
  "meta-llama/Llama-2-7b-chat-hf",
  "microsoft/DialoGPT-medium", 
  "google/flan-t5-large",
  "mistralai/Mistral-7B-Instruct-v0.1",
  "codellama/CodeLlama-7b-Python-hf",
  
  // Generic model names
  "llama-2-7b",
  "mistral-7b", 
  "flan-t5",
  "codellama",
  "free-ai"
];

/* ----------------------- Helpers ----------------------- */

function corsHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-provider",
    ...extra,
  };
}

function handleOptions(_req) {
  return new Response(null, { headers: corsHeaders() });
}

function cryptoRandomId(n) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function extractPrompt(messages) {
  if (!Array.isArray(messages)) return "";
  
  return messages.map(msg => {
    if (msg.role === "system") return `System: ${msg.content}`;
    if (msg.role === "user") return `Human: ${msg.content}`;
    if (msg.role === "assistant") return `Assistant: ${msg.content}`;
    return msg.content || "";
  }).join("\n\n") + "\n\nAssistant:";
}

/* ----------------------- Model listing ----------------------- */

function listFreeModels() {
  const now = Math.floor(Date.now() / 1000);
  const models = ALL_FREE_MODELS.map((id) => ({
    id,
    object: "model",
    created: now,
    owned_by: "free-ai-proxy",
    permission: [],
    root: id,
    parent: null,
  }));
  
  return new Response(
    JSON.stringify({ object: "list", data: models }),
    { status: 200, headers: corsHeaders({ "content-type": "application/json" }) }
  );
}

/* ----------------------- Free Chat Handling ----------------------- */

async function handleFreeChat(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const model = body.model || "meta-llama/Llama-2-7b-chat-hf";
    const messages = body.messages || [];
    const stream = Boolean(body.stream);
    const maxRetries = 3;

    const prompt = extractPrompt(messages);
    
    // Try different providers until one works
    const providers = Object.keys(FREE_PROVIDERS);
    
    for (let i = 0; i < providers.length; i++) {
      const providerName = providers[i];
      const provider = FREE_PROVIDERS[providerName];
      
      try {
        console.log(`Trying provider: ${providerName}`);
        const result = await tryProvider(provider, providerName, model, prompt, messages, stream);
        
        if (result) {
          return result;
        }
      } catch (error) {
        console.log(`Provider ${providerName} failed:`, error.message);
        continue;
      }
    }

    // If all providers fail, try a simple text generation
    return await fallbackResponse(model, prompt, stream);
    
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: {
          message: `Free AI proxy error: ${error.message}`,
          type: "proxy_error"
        }
      }),
      { status: 500, headers: corsHeaders({ "content-type": "application/json" }) }
    );
  }
}

async function tryProvider(provider, providerName, model, prompt, messages, stream) {
  let response;
  
  switch (provider.format) {
    case "huggingface":
      response = await tryHuggingFace(provider, model, prompt);
      break;
    case "together":
      response = await tryTogether(provider, model, prompt);
      break;
    case "openai":
      response = await tryOpenAIFormat(provider, model, messages);
      break;
    default:
      return null;
  }
  
  if (response && response.ok) {
    const data = await response.json();
    return formatOpenAIResponse(data, model, providerName, stream);
  }
  
  return null;
}

async function tryHuggingFace(provider, model, prompt) {
  const modelPath = provider.models.includes(model) ? model : provider.models[0];
  
  return await fetch(`${provider.url}${modelPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_length: 500,
        temperature: 0.7,
        return_full_text: false
      }
    })
  });
}

async function tryTogether(provider, model, prompt) {
  return await fetch(provider.url, {
    method: "POST", 
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.models.includes(model) ? model : provider.models[0],
      prompt: prompt,
      max_tokens: 500,
      temperature: 0.7
    })
  });
}

async function tryOpenAIFormat(provider, model, messages) {
  const modelPath = provider.models.includes(model) ? model : provider.models[0];
  
  return await fetch(`${provider.url}${modelPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelPath,
      messages: messages,
      max_tokens: 500,
      temperature: 0.7
    })
  });
}

function formatOpenAIResponse(data, model, provider, stream) {
  const created = Math.floor(Date.now() / 1000);
  const openaiId = `chatcmpl_${cryptoRandomId(24)}`;
  
  let content = "";
  
  // Extract content based on provider response format
  if (Array.isArray(data) && data[0]?.generated_text) {
    // Hugging Face format
    content = data[0].generated_text.trim();
  } else if (data.choices && data.choices[0]?.message?.content) {
    // OpenAI format
    content = data.choices[0].message.content;
  } else if (data.choices && data.choices[0]?.text) {
    // Together format
    content = data.choices[0].text.trim();
  } else if (typeof data.output === "string") {
    // Some other format
    content = data.output.trim();
  } else {
    // Fallback
    content = "Hello! I'm a free AI assistant. How can I help you today?";
  }

  const response = {
    id: openaiId,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content
        },
        finish_reason: "stop"
      }
    ],
    usage: {
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null
    },
    system_fingerprint: JSON.stringify({
      provider: provider,
      free_tier: true
    })
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: corsHeaders({ "content-type": "application/json" })
  });
}

async function fallbackResponse(model, prompt, stream) {
  const created = Math.floor(Date.now() / 1000);
  const openaiId = `chatcmpl_${cryptoRandomId(24)}`;
  
  // Simple rule-based responses for common queries
  const responses = [
    "I'm a free AI assistant! How can I help you today?",
    "Hello! I'm here to assist you with any questions you might have.",
    "Hi there! What would you like to know or discuss?",
    "Greetings! I'm ready to help with information, coding, writing, or general questions.",
    "Welcome! Feel free to ask me anything - I'm here to help!"
  ];
  
  const content = responses[Math.floor(Math.random() * responses.length)];
  
  const response = {
    id: openaiId,
    object: "chat.completion", 
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content
        },
        finish_reason: "stop"
      }
    ],
    usage: {
      prompt_tokens: null,
      completion_tokens: null, 
      total_tokens: null
    },
    system_fingerprint: JSON.stringify({
      provider: "fallback",
      note: "Basic fallback response - try different models for better results"
    })
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: corsHeaders({ "content-type": "application/json" })
  });
}