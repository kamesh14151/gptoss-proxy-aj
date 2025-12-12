# Deployment Instructions

## Modified Worker for Ollama API

This worker has been modified to work with the Ollama API instead of the original GPT-OSS API.

### Changes Made:
- Updated API endpoint to use `https://ollama.com/api/chat`
- Modified request/response format to match Ollama API
- Updated model names to support `gpt-oss:120b` and `gpt-oss-20b`
- Simplified the code by removing GPT-OSS specific features

### Environment Variables:
Add the following environment variables to your Cloudflare Worker:
- `OLLAMA_API_KEY` - Your Ollama API key (optional, if Ollama requires authentication)
- `GROQ_API_KEY` - Your Groq API key (required for Llama models)

### Deployment:
1. Use `wrangler deploy` to deploy the worker
2. The worker will be accessible at your Cloudflare Worker URL
3. Test with the curl command you provided

### Supported Endpoints:
- `GET /` - Root info
- `GET /v1/models` - List available models
- `POST /v1/chat/completions` - Chat completions (OpenAI-compatible)

### Supported Models:
- `gpt-oss-20b` (internally uses Llama via Groq API)
- `gpt-oss-120b` (internally uses Llama via Groq API)  
- `AJ` (internally uses Llama via Groq API)

### AI Identity:
- **AI Name:** AJ
- **Built by:** AJ STUDIOZ
- All responses include AJ's signature and branding

### Example Usage:
```bash
# Using AJ model name
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model":"AJ",
    "messages":[{"role":"user","content":"Hello AJ!"}],
    "stream":false
  }'

# Using legacy model names (all internally use Llama)
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gpt-oss-20b",
    "messages":[{"role":"user","content":"Hello!"}],
    "stream":false
  }'
```