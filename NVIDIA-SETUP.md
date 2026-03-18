# NVIDIA NeMo / NIM Free API Setup

## Get Free API Key

1. Go to https://build.nvidia.com/
2. Sign up / Login with NVIDIA account
3. Click on a model (e.g., "Llama 3.1 Nemotron 70B")
4. Click "Get API Key"
5. Copy your key (starts with `nvapi-...`)

## Set in Render

Go to: Render Dashboard → hostclaw-api → Environment

Add:
```
NVIDIA_API_KEY=nvapi-your-key-here
```

## Available Free Models

| Model | Tokens | Use Case |
|-------|--------|----------|
| Nemotron-70B | 32K | Best for coding/math |
| Llama 3.1 70B | 128K | General purpose |
| Llama 3.1 405B | 128K | Most powerful |
| Mixtral 8x22B | 65K | Mixture of experts |

## Test the API

```bash
curl https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Authorization: Bearer $NVIDIA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nvidia/llama-3.1-nemotron-70b-instruct",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 1024
  }'
```

## Usage Limits

- **Free tier**: 1,000 requests/day
- **Rate limit**: 20 requests/minute
- **No credit card required**

## Switch from OpenAI

Update your code to use NVIDIA provider:
```javascript
const provider = require('./config/providers/nvidia');
const response = await provider.chat(messages, model, apiKey);
```

Or set as default in database:
```sql
UPDATE users SET default_provider = 'nvidia' WHERE id = 'your-user-id';
```
