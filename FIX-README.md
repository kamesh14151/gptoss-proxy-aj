# GPT-OSS Proxy Fix - Authentication Required

## Issue Description

The GPT-OSS API now requires Hugging Face authentication. When you call the API without proper authentication, you get an empty response because the upstream service returns a "Sign in to continue" widget instead of AI-generated content.

**Symptom:**
```json
{
  "id": "chatcmpl_...",
  "object": "chat.completion", 
  "choices": [{
    "message": {
      "role": "assistant",
      "content": ""  // Empty content!
    }
  }]
}
```

## Root Cause

GPT-OSS now requires users to authenticate with Hugging Face. The original proxy code doesn't handle this authentication requirement, so it receives authentication prompts instead of actual AI responses.

## Solution

Use the fixed worker (`worker-fixed.js`) that includes:

1. **Proper authentication handling** via Hugging Face tokens
2. **Better error detection** for authentication issues
3. **Clear error messages** when authentication fails
4. **Multiple authentication methods**

## Setup Instructions

### Method 1: Environment Variable (Recommended)

1. Get a Hugging Face token from https://huggingface.co/settings/tokens
2. Deploy with the token as an environment variable:

```bash
# Set the token as a secret
wrangler secret put HF_TOKEN
# Enter your HF token when prompted

# Deploy with the fixed worker
wrangler deploy -c wrangler-fixed.toml
```

### Method 2: Header-based Authentication

Pass the token in each request:

```bash
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-HF-Token: your_hugging_face_token_here" \
  -d '{"model":"gpt-oss-20b","messages":[{"role":"user","content":"Hello!"}],"stream":false}'
```

### Method 3: Authorization Header

```bash
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_hugging_face_token_here" \
  -d '{"model":"gpt-oss-20b","messages":[{"role":"user","content":"Hello!"}],"stream":false}'
```

## Testing the Fix

### Before (Original Worker)
```json
{
  "choices": [{"message": {"content": ""}}]  // Empty!
}
```

### After (Fixed Worker)
```json
{
  "choices": [{"message": {"content": "Hello! How can I help you today?"}}]  // Actual response!
}
```

## Error Handling

The fixed worker provides clear error messages:

### No Authentication
```json
{
  "error": {
    "type": "authentication_required",
    "message": "GPT-OSS now requires Hugging Face authentication. Please provide a valid HF token via 'X-HF-Token' header or set HF_TOKEN environment variable.",
    "code": "auth_required"
  }
}
```

### Invalid Token
```json
{
  "error": "Upstream 401: Unauthorized"
}
```

## Files Changed

- `worker-fixed.js` - Updated worker with authentication support
- `wrangler-fixed.toml` - Configuration for environment variables
- This README with setup instructions

## Quick Deploy

1. Replace your current `worker.js` with `worker-fixed.js`
2. Get a Hugging Face token
3. Set it as an environment variable: `wrangler secret put HF_TOKEN`
4. Deploy: `wrangler deploy`

## Authentication Methods Priority

The worker checks for authentication in this order:
1. `HF_TOKEN` environment variable (recommended for production)
2. `X-HF-Token` header (good for testing)
3. `Authorization: Bearer` header (standard format)

## Python Example with Authentication

```python
import requests
import json

# Method 1: Using header
headers = {
    "Content-Type": "application/json",
    "X-HF-Token": "your_hf_token_here"
}

# Method 2: Using Authorization header  
headers = {
    "Content-Type": "application/json", 
    "Authorization": "Bearer your_hf_token_here"
}

payload = {
    "model": "gpt-oss-20b",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": False
}

response = requests.post(
    "https://your-worker.workers.dev/v1/chat/completions",
    headers=headers,
    json=payload
)

print(response.json())
```

The fix ensures you get actual AI responses instead of empty content!