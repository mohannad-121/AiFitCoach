# Hosted Ollama Setup

This project can use Ollama for normal gym conversation replies while keeping dataset/training-based plan generation.

Recommended hosting model:

- Run `ollama` and `ai_backend` on the same VM or VPS.
- Use a provider with enough RAM for `qwen3:8b`.
- Keep the frontend hosted separately if you want.

## Recommended providers

- DigitalOcean Droplet
- Hetzner Cloud
- a GPU or high-memory VM on another provider

Render is fine for the frontend and a lightweight backend, but it is not a good place to host `qwen3:8b` itself.

## Local/VM compose setup

Use [deploy/ollama-compose.yml](deploy/ollama-compose.yml).

Create a `.env` file next to the compose file with:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Then run:

```bash
docker compose -f deploy/ollama-compose.yml up -d
docker exec -it fitcoach-ollama ollama pull qwen3:8b
```

Backend health check:

```bash
curl http://127.0.0.1:8000/health
```

Expected important fields:

- `provider: ollama`
- `model: qwen3:8b`
- `chat_response_mode: llm`

## Behavior after this setup

- Normal fitness chat replies: Ollama `qwen3:8b`
- Workout and nutrition plans: training pipeline + all indexed datasets

## Render-specific note

If you keep the backend on Render, use an externally hosted Ollama endpoint and set:

```env
CHAT_RESPONSE_MODE=llm
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://your-ollama-host:11434
OLLAMA_MODEL=qwen3:8b
TRAINING_PIPELINE_ENABLED=0
```

That setup keeps Render as an API layer only. The model should live on another machine.