# Deployment Guide

This repo can be deployed as two services:

- Frontend: Vite static app
- Backend: FastAPI app in `ai_backend`

## Required environment variables

Frontend:

- `VITE_AI_BACKEND_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (optional if same as anon key)

Backend:

- `CHAT_RESPONSE_MODE=dataset_only` for free dataset-only mode, or change if you want LLM-backed responses
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `OLLAMA_BASE_URL` if using Ollama
- `OLLAMA_MODEL` if using Ollama
- `OPENAI_API_KEY` if using OpenAI-compatible mode

## Render

This repo includes `render.yaml`.

Steps:

1. Push the repo to GitHub.
2. In Render, create a new Blueprint instance from the repo.
3. Fill in the environment variables marked with `sync: false`.
4. Deploy both services.

Backend health endpoint:

- `/health`

## Railway

Railway is easiest with two services from the same repo.

Backend service:

- Root directory: `ai_backend`
- Builder: Dockerfile
- Dockerfile path: `ai_backend/Dockerfile`

Frontend service:

- Builder: Dockerfile
- Dockerfile path: `Dockerfile.frontend`
- Set build args or environment variables for:
  - `VITE_AI_BACKEND_URL`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`

If you prefer Railway static hosting alternatives, you can deploy the frontend separately on Vercel/Netlify and keep the backend on Railway.

## DigitalOcean App Platform

This repo includes `.do/app.yaml`.

Steps:

1. Create a new app from GitHub.
2. Point it at `mohannad-121/fit_coach_ai`.
3. Import `.do/app.yaml`.
4. Fill in all secret environment variables before deploy.

## Notes

- The frontend is a single page app, so the nginx config in `deploy/nginx.conf` rewrites all routes to `index.html`.
- The backend must run from the `ai_backend` directory so local imports like `from ai_engine import AIEngine` resolve correctly.