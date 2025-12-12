# Deployment Instructions

## Modified Worker for Ollama API

This worker has been modified to work with the Ollama API instead of the original GPT-OSS API.

### Changes Made:
- Updated API endpoint to use `https://ollama.com/api/chat`
- Modified request/response format to match Ollama API
- Updated model names to support `gpt-oss:120b` and `gpt-oss-20b`
- Simplified the code by removing GPT-OSS specific features

### Environment Variables:
Add the following environment variable to your Cloudflare Worker:
- `OLLAMA_API_KEY` - Your Ollama API key (optional, if Ollama requires authentication)

### Deployment:
1. Use `wrangler deploy` to deploy the worker
2. The worker will be accessible at your Cloudflare Worker URL
3. Test with the curl command you provided

### Supported Endpoints:
- `GET /` - Root info
- `GET /v1/models` - List available models
- `POST /v1/chat/completions` - Chat completions (OpenAI-compatible)

### Supported Models:
- `gpt-oss-20b` (maps to `gpt-oss-20b` in Ollama)
- `gpt-oss-120b` (maps to `gpt-oss:120b` in Ollama)

### Example Usage:
```bash
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gpt-oss-20b",
    "messages":[{"role":"user","content":"Hello!"}],
    "stream":false
  }'
```