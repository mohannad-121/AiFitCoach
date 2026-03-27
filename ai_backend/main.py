from __future__ import annotations

import os
import logging
import re
import json
import uuid
import shutil
import asyncio
import math
from functools import lru_cache
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

from ai_engine import AIEngine
from data_catalog import DataCatalog
from domain_router import DomainRouter
from dataset_registry import DatasetRegistry
from knowledge_engine import KnowledgeEngine
from llm_client import LLMClient
from logic_engine import evaluate_logic_metrics
from memory_system import MemorySystem
from moderation_layer import ModerationLayer
from persistent_rag_store import PersistentRagStore
from predict import predict_goal, predict_plan_intent, predict_success
from response_datasets import ResponseDatasets
from dataset_paths import resolve_dataset_root, resolve_derived_root
from rag_context import RagContextBuilder
from supabase_context import SupabaseContextRepository
from voice.stt import WhisperSTT
from voice.tts import LocalTTS, TTSError
from voice.voice_pipeline import VoicePipeline, VoicePipelineError, VoicePipelineResult
from nlp_utils import (
    extract_first_int,
    fuzzy_contains_any,
    fuzzy_token_match,
    normalize_text,
    repair_mojibake as nlp_repair_mojibake,
    repair_mojibake_deep,
    tokenize,
)


app = FastAPI(title="AI Fitness Coach Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger(__name__)

load_dotenv(override=True)

BACKEND_DIR = Path(__file__).resolve().parent
STATIC_DIR = BACKEND_DIR / "static"
STATIC_AUDIO_DIR = STATIC_DIR / "audio"
STATIC_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Initialize Multi-Dataset Training Pipeline
training_pipeline = None
training_pipeline_task = None


def _training_pipeline_enabled() -> bool:
    configured = os.getenv("TRAINING_PIPELINE_ENABLED")
    if configured is not None:
        return configured.lower() not in {"0", "false", "no", "off"}

    # Render free instances are memory-constrained; keep the API responsive by
    # skipping the heavy background training pipeline unless explicitly enabled.
    if os.getenv("RENDER"):
        return False

    return True


def _initialize_training_pipeline_sync() -> None:
    global training_pipeline
    try:
        from training_pipeline import TrainingPipeline
        from dataset_paths import resolve_dataset_root

        logger.info("Initializing multi-dataset training pipeline...")

        dataset_root = resolve_dataset_root()
        model_cache_path = BACKEND_DIR / "models" / "training_cache"

        pipeline = TrainingPipeline(dataset_root, model_cache_path)

        # Try to load cached models (fast)
        if pipeline.load_cached_models():
            logger.info("Loaded cached training models")
        else:
            # Train if no cache (slow, one-time)
            logger.info("Training on 50+ datasets in the background")
            pipeline.train()
            logger.info("Training complete! Models will be cached for next startup")

        summary = pipeline.get_summary()
        logger.info("Training Pipeline Ready:")
        logger.info(f"   - Datasets: {summary['dataset_summary']['total_datasets']}")
        logger.info(f"   - Records: {summary['dataset_summary']['total_records']:,}")
        logger.info(f"   - Exercises: {summary['training_summary']['exercises_count']}")
        logger.info(f"   - Foods: {summary['training_summary']['foods_count']}")
        training_pipeline = pipeline

    except Exception as e:
        logger.warning(f"Training pipeline initialization failed: {e}")
        logger.info("Continuing without multi-dataset training (fallback to standard recommender)")
        training_pipeline = None

@app.on_event("startup")
async def initialize_training_pipeline():
    """Initialize multi-dataset training system in the background on startup."""
    global training_pipeline, training_pipeline_task
    if not _training_pipeline_enabled():
        logger.info("Training pipeline disabled by TRAINING_PIPELINE_ENABLED")
        training_pipeline = None
        return
    if training_pipeline_task is not None and not training_pipeline_task.done():
        logger.info("Training pipeline initialization already running")
        return

    logger.info("Scheduling training pipeline initialization in the background")
    training_pipeline_task = asyncio.create_task(asyncio.to_thread(_initialize_training_pipeline_sync))


class ChatRequest(BaseModel):
    message: str
    user_id: Optional[str] = None
    conversation_id: Optional[str] = None
    language: Optional[str] = "en"
    stream: Optional[bool] = False
    user_profile: Optional[Dict[str, Any]] = None
    tracking_summary: Optional[Dict[str, Any]] = None
    recent_messages: Optional[list[Dict[str, Any]]] = None
    plan_snapshot: Optional[Dict[str, Any]] = None
    website_context: Optional[Dict[str, Any]] = None


def _repair_mojibake(text: str) -> str:
    return nlp_repair_mojibake(text)


class ChatResponse(BaseModel):
    reply: str
    conversation_id: str
    language: str
    action: Optional[str] = None
    data: Optional[Dict[str, Any]] = None

    @field_validator("reply", mode="before")
    @classmethod
    def _normalize_reply_text(cls, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        return _repair_mojibake(value)

    @field_validator("data", mode="before")
    @classmethod
    def _normalize_data_payload(cls, value: Any) -> Any:
        return repair_mojibake_deep(value)


class VoiceChatResponse(BaseModel):
    transcript: str
    reply: str
    audio_path: str
    conversation_id: str
    language: str
    action: Optional[str] = None
    data: Optional[Dict[str, Any]] = None

    @field_validator("reply", mode="before")
    @classmethod
    def _normalize_voice_reply_text(cls, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        return _repair_mojibake(value)

    @field_validator("data", mode="before")
    @classmethod
    def _normalize_voice_data_payload(cls, value: Any) -> Any:
        return repair_mojibake_deep(value)


class TextToSpeechRequest(BaseModel):
    text: str
    language: str = "en"


class TextToSpeechResponse(BaseModel):
    audio_path: str
    language: str


class PlanActionRequest(BaseModel):
    user_id: Optional[str] = None
    conversation_id: Optional[str] = None


class GoalPredictionRequest(BaseModel):
    age: Optional[float] = 0.0
    gender: Optional[str] = "Other"
    weight_kg: Optional[float] = 0.0
    height_m: Optional[float] = None
    height_cm: Optional[float] = None
    bmi: Optional[float] = 0.0
    fat_percentage: Optional[float] = 0.0
    workout_frequency_days_week: Optional[float] = 0.0
    experience_level: Optional[float] = 0.0
    calories_burned: Optional[float] = 0.0
    avg_bpm: Optional[float] = 0.0


class SuccessPredictionRequest(BaseModel):
    age: Optional[float] = 0.0
    gender: Optional[str] = "Other"
    membership_type: Optional[str] = "Unknown"
    workout_type: Optional[str] = "Unknown"
    workout_duration_minutes: Optional[float] = 0.0
    calories_burned: Optional[float] = 0.0
    check_in_hour: Optional[int] = 0
    check_in_time: Optional[str] = None


class LogicEvaluationRequest(BaseModel):
    start_value: Optional[float] = None
    current_value: Optional[float] = None
    target_value: Optional[float] = None
    direction: str = "decrease"
    weight_history: Optional[list[float]] = None
    previous_value: Optional[float] = None
    elapsed_weeks: float = 1.0


class PlanIntentPredictionRequest(BaseModel):
    message: str


class RagDebugQueryRequest(BaseModel):
    user_id: str
    query: str
    conversation_id: Optional[str] = None
    top_k: Optional[int] = 5


def _resolve_response_dataset_dir() -> Path:
    base_data_dir = Path(__file__).resolve().parent / "data"
    candidates = [
        base_data_dir / "week2",
        base_data_dir / "chat data",
    ]
    required_files = ("conversation_intents.json", "workout_programs.json", "nutrition_programs.json")
    for candidate in candidates:
        if all((candidate / name).exists() for name in required_files):
            return candidate
    return candidates[0]


ROUTER = DomainRouter(threshold=0.42, enable_semantic=False)
MODERATION = ModerationLayer()
LLM = LLMClient()
AI_ENGINE = AIEngine(Path(__file__).resolve().parent / "exercises.json")
CATEGORY_DATA = DataCatalog(resolve_dataset_root(), resolve_derived_root())
RAG_CONTEXT_BUILDER = RagContextBuilder(CATEGORY_DATA)
PERSISTENT_RAG = PersistentRagStore(BACKEND_DIR / "data" / "rag_store")
SUPABASE_CONTEXT = SupabaseContextRepository(
    os.getenv("VITE_SUPABASE_URL", ""),
    os.getenv("SUPABASE_SERVICE_ROLE_KEY", "") or os.getenv("VITE_SUPABASE_ANON_KEY", ""),
)
NUTRITION_KB = KnowledgeEngine(Path(__file__).resolve().parent / "knowledge" / "dataforproject.txt")
RESPONSE_DATASET_DIR = _resolve_response_dataset_dir()
RESPONSE_DATASETS = ResponseDatasets(RESPONSE_DATASET_DIR)


def _resolve_chat_response_mode() -> str:
    configured = os.getenv('CHAT_RESPONSE_MODE', 'auto').strip().lower()
    if configured in {'dataset_only', 'hybrid', 'llm', 'smart'}:
        return configured
    if configured == 'auto':
        return 'hybrid' if getattr(LLM, 'active_provider', '') in {'openai', 'ollama'} else 'dataset_only'
    return 'dataset_only'


CHAT_RESPONSE_MODE = _resolve_chat_response_mode()


def _conversation_replies_should_use_llm() -> bool:
    return CHAT_RESPONSE_MODE in {'llm', 'smart'}


def _rag_namespace_for_user(user_id: str | None) -> str:
    normalized = _normalize_user_id(user_id)
    return f"user_context_{normalized}"


def _json_text(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)


def _build_app_knowledge_documents(website_context: Optional[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(website_context, dict) or not website_context:
        return []

    docs: list[dict[str, Any]] = []
    pages = website_context.get("pages") if isinstance(website_context.get("pages"), dict) else {}
    for page_key, page_value in pages.items():
        docs.append(
            {
                "id": f"page_{page_key}",
                "text": f"App page {page_key}: {_json_text(page_value)}",
                "metadata": {"kind": "app_page", "page": page_key},
            }
        )

    for key in ("onboarding_flow", "profile_page", "workouts_page", "schedule_page", "ai_coach_capabilities"):
        if key in website_context:
            docs.append(
                {
                    "id": f"app_{key}",
                    "text": f"App knowledge {key}: {_json_text(website_context.get(key))}",
                    "metadata": {"kind": "app_knowledge", "section": key},
                }
            )
    return docs


def _build_user_rag_documents(
    user_id: str,
    profile: dict[str, Any],
    tracking_summary: Optional[dict[str, Any]],
    plan_snapshot: Optional[dict[str, Any]],
    recent_messages: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    docs.append(
        {
            "id": f"{user_id}_profile",
            "text": f"User profile: {_json_text(profile)}",
            "metadata": {"kind": "profile"},
        }
    )

    if tracking_summary:
        docs.append(
            {
                "id": f"{user_id}_tracking_summary",
                "text": f"Tracking summary: {_json_text(tracking_summary)}",
                "metadata": {"kind": "tracking_summary"},
            }
        )

        progress_metrics = tracking_summary.get("progress_metrics") if isinstance(tracking_summary.get("progress_metrics"), dict) else {}
        if progress_metrics:
            docs.append(
                {
                    "id": f"{user_id}_progress_metrics",
                    "text": f"Progress metrics: {_json_text(progress_metrics)}",
                    "metadata": {"kind": "progress_metrics"},
                }
            )

        for index, plan in enumerate((tracking_summary.get("active_plan_details") or [])[:8]):
            docs.append(
                {
                    "id": f"{user_id}_active_plan_{index}",
                    "text": f"Active plan detail: {_json_text(plan)}",
                    "metadata": {"kind": "active_plan_detail", "index": index},
                }
            )

        for kind, values in (
            ("workout_note", tracking_summary.get("recent_workout_notes") or []),
            ("nutrition_note", tracking_summary.get("recent_nutrition_notes") or []),
            ("mood_note", tracking_summary.get("recent_moods") or []),
        ):
            for index, value in enumerate(values[:10]):
                text = str(value or "").strip()
                if not text:
                    continue
                docs.append(
                    {
                        "id": f"{user_id}_{kind}_{index}",
                        "text": f"{kind.replace('_', ' ')}: {text}",
                        "metadata": {"kind": kind, "index": index},
                    }
                )

        for index, activity in enumerate((tracking_summary.get("recent_activity") or [])[:10]):
            docs.append(
                {
                    "id": f"{user_id}_activity_{index}",
                    "text": f"Recent activity: {_json_text(activity)}",
                    "metadata": {"kind": "recent_activity", "index": index},
                }
            )

    if plan_snapshot:
        docs.append(
            {
                "id": f"{user_id}_plan_snapshot",
                "text": f"Plan snapshot: {_json_text(plan_snapshot)}",
                "metadata": {"kind": "plan_snapshot"},
            }
        )

    if recent_messages:
        for index, msg in enumerate(recent_messages[-8:]):
            role = str(msg.get("role") or "unknown")
            content = str(msg.get("content") or "").strip()
            if not content:
                continue
            docs.append(
                {
                    "id": f"{user_id}_recent_message_{index}",
                    "text": f"Recent {role} message: {content}",
                    "metadata": {"kind": "recent_message", "role": role, "index": index},
                }
            )

    return docs


def _refresh_persistent_rag_context(
    user_id: str,
    profile: dict[str, Any],
    tracking_summary: Optional[dict[str, Any]],
    plan_snapshot: Optional[dict[str, Any]],
    website_context: Optional[dict[str, Any]],
    recent_messages: Optional[list[dict[str, Any]]] = None,
) -> None:
    try:
        app_docs = _build_app_knowledge_documents(website_context)
        if app_docs:
            PERSISTENT_RAG.upsert_documents("app_knowledge", app_docs, replace=True)

        user_docs = _build_user_rag_documents(user_id, profile, tracking_summary, plan_snapshot, recent_messages)
        if user_docs:
            PERSISTENT_RAG.upsert_documents(_rag_namespace_for_user(user_id), user_docs, replace=True)
    except Exception as exc:
        logger.warning("Failed refreshing persistent RAG context: %s", exc)


def _merge_recent_messages(
    database_messages: Optional[list[dict[str, Any]]],
    request_messages: Optional[list[dict[str, Any]]],
) -> list[dict[str, str]]:
    merged: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in _normalize_recent_messages(database_messages) + _normalize_recent_messages(request_messages):
        role = str(item.get("role") or "").strip().lower()
        content = _repair_mojibake(str(item.get("content") or "").strip())
        if role not in {"user", "assistant"} or not content:
            continue
        key = (role, content)
        if key in seen:
            continue
        seen.add(key)
        merged.append({"role": role, "content": content})
    return merged[-12:]


def _load_database_context(user_id: str, conversation_id: Optional[str]) -> dict[str, Any]:
    if not SUPABASE_CONTEXT.enabled:
        return {"enabled": False}
    try:
        return SUPABASE_CONTEXT.load_user_context(user_id, conversation_id)
    except Exception as exc:
        logger.warning("Database-backed context load failed for %s: %s", user_id, exc)
        return {"enabled": False, "error": str(exc)}


def _format_rag_hits_for_debug(user_id: str, query: str, top_k: int = 5) -> list[dict[str, Any]]:
    formatted: list[dict[str, Any]] = []
    for hit in _persistent_rag_hits(user_id, query, top_k=top_k):
        formatted.append(
            {
                "namespace": hit.get("namespace"),
                "id": hit.get("id"),
                "score": hit.get("score"),
                "metadata": repair_mojibake_deep(hit.get("metadata") or {}),
                "text": _repair_mojibake(str(hit.get("text") or "")),
            }
        )
    return formatted


def _persistent_rag_hits(user_id: str, query: str, top_k: int = 3) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for namespace in (_rag_namespace_for_user(user_id), "app_knowledge"):
        for hit in PERSISTENT_RAG.search(namespace, query, top_k=top_k):
            hit_with_namespace = dict(hit)
            hit_with_namespace["namespace"] = namespace
            hits.append(hit_with_namespace)
    hits.sort(key=lambda item: float(item.get("score", 0.0)), reverse=True)
    return hits[: max(1, top_k * 2)]


PLAN_OPTION_PAGE_SIZE = 5
PLAN_OPTION_POOL_TARGET = 500


def _dataset_short_reply_allowed(user_input: str) -> bool:
    return len(normalize_text(user_input).split()) <= 4


def _in_domain_or_strong_fitness_query(user_input: str, language: str) -> bool:
    in_domain, _score = ROUTER.is_in_domain(user_input, language=language)
    if (not in_domain) and _contains_any(user_input, STRONG_DOMAIN_KEYWORDS):
        in_domain = True
    return in_domain


def _looks_like_contextual_followup(user_input: str) -> bool:
    normalized = normalize_text(user_input)
    if not normalized:
        return False

    followup_phrases = {
        "tell me more",
        "tell me more about",
        "more about",
        "what about",
        "can you explain",
        "explain more",
        "i want",
        "i want you",
        "can you help",
        "should i",
        "is it good",
        "is that good",
        "before workout",
        "after workout",
        "قبل التمرين",
        "بعد التمرين",
        "احكيلي اكثر",
        "احكيلي أكثر",
        "زيدني",
        "شو رأيك",
        "ممكن تشرح",
        "بدي",
        "بدي اياك",
    }
    return _contains_phrase(normalized, followup_phrases)


def _recent_history_is_fitness_related(
    recent_messages: Optional[list[dict[str, Any]]],
    memory: Optional[MemorySystem],
) -> bool:
    history: list[dict[str, Any]] = []
    if recent_messages:
        history = _normalize_recent_messages(recent_messages)[-6:]
    elif memory is not None:
        history = memory.get_conversation_history()[-6:]

    for msg in reversed(history):
        content = str(msg.get("content", "")).strip()
        if not content:
            continue
        if _contains_any(content, STRONG_DOMAIN_KEYWORDS | NUTRITION_KB_KEYWORDS | PROGRESS_KEYWORDS):
            return True
    return False


def _contextual_followup_reply(
    user_input: str,
    language: str,
    recent_messages: Optional[list[dict[str, Any]]],
    memory: Optional[MemorySystem],
) -> Optional[str]:
    if not _looks_like_contextual_followup(user_input):
        return None
    if not _recent_history_is_fitness_related(recent_messages, memory):
        return None

    normalized = normalize_text(user_input)
    if _contains_phrase(normalized, {"i want", "i want you", "help me", "can you help", "بدي", "ساعدني", "ممكن تساعدني"}):
        return _lang_reply(
            language,
            "Absolutely. Tell me what you want help with right now: training, nutrition, fat loss, muscle gain, or fixing your current plan.",
            "بالتأكيد. أخبرني الآن في ماذا تريد المساعدة: التمرين، التغذية، خسارة الدهون، زيادة العضلات، أم تعديل خطتك الحالية.",
            "أكيد. احكيلي هسا شو بدك مساعدة فيه: تمرين، تغذية، تنزيل دهون، زيادة عضل، أو تعديل خطتك الحالية.",
        )

    if _contains_phrase(normalized, {"tell me more", "tell me more about", "more about", "what about", "can you explain", "explain more", "احكيلي اكثر", "احكيلي أكثر", "شو رأيك"}):
        return _lang_reply(
            language,
            "Sure. Mention the food, exercise, or goal you want to go deeper on, and I will explain it in a gym-focused way.",
            "بالتأكيد. اذكر الطعام أو التمرين أو الهدف الذي تريد التوسع فيه، وسأشرحه لك بطريقة موجهة للياقة.",
            "أكيد. احكيلي عن الأكل أو التمرين أو الهدف اللي بدك تتوسع فيه، وأنا بشرحه إلك بطريقة موجهة للجيم.",
        )

    return None


def _ollama_unavailable_reply(language: str) -> str:
    model_name = getattr(LLM, 'active_model', None) or os.getenv('OLLAMA_MODEL', 'qwen3:8b')
    return _lang_reply(
        language,
        f"Local AI is unavailable. Start Ollama and run `ollama pull {model_name}`, then retry.",
        f"الذكاء المحلي غير متاح حالياً. شغّل Ollama ثم نفّذ `ollama pull {model_name}` وبعدها أعد المحاولة.",
        f"الذكاء المحلي واقف حالياً. شغّل Ollama واعمل `ollama pull {model_name}` وجرّب مرة ثانية.",
    )
VOICE_STT = WhisperSTT(model_name=os.getenv("WHISPER_MODEL", "openai/whisper-base"))
VOICE_TTS = LocalTTS(output_dir=STATIC_AUDIO_DIR)
VOICE_PIPELINE = VoicePipeline(stt_engine=VOICE_STT, tts_engine=VOICE_TTS, llm_client=LLM)
DATASET_REGISTRY = DatasetRegistry(
    resolve_dataset_root(),
    Path(__file__).resolve().parent / "data" / "dataset_registry_index.json",
)
DATASET_REGISTRY.build_index(
    force_rebuild=os.getenv("DATASET_REGISTRY_FORCE_REBUILD", "0").lower() in {"1", "true", "yes", "on"}
)

MEMORY_SESSIONS: Dict[str, MemorySystem] = {}
PENDING_PLANS: Dict[str, Dict[str, Any]] = {}
USER_STATE: Dict[str, Dict[str, Any]] = {}

WEEK_DAYS = [
    ("Saturday", "السبت"),
    ("Sunday", "الأحد"),
    ("Monday", "الاثنين"),
    ("Tuesday", "الثلاثاء"),
    ("Wednesday", "الأربعاء"),
    ("Thursday", "الخميس"),
    ("Friday", "الجمعة"),
]

GREETING_KEYWORDS = {
    "hi",
    "hello",
    "hey",
    "Ù…Ø±Ø­Ø¨Ø§",
    "Ø§Ù‡Ù„Ø§",
    "Ù‡Ù„Ø§",
    "Ø§Ù„Ø³Ù„Ø§Ù… Ø¹Ù„ÙŠÙƒÙ…",
}

NAME_KEYWORDS = {"name", "Ø§Ø³Ù…Ùƒ", "Ø´Ùˆ Ø§Ø³Ù…Ùƒ", "Ù…ÙŠÙ† Ø§Ù†Øª"}
HOW_ARE_YOU_KEYWORDS = {"how are you", "ÙƒÙŠÙÙƒ", "Ø´Ù„ÙˆÙ†Ùƒ", "ÙƒÙŠÙ Ø­Ø§Ù„Ùƒ"}
WORKOUT_PLAN_KEYWORDS = {
    "workout plan",
    "training plan",
    "program",
    "Ø®Ø·Ø© ØªÙ…Ø§Ø±ÙŠÙ†",
    "Ø¨Ø±Ù†Ø§Ù…Ø¬ ØªÙ…Ø§Ø±ÙŠÙ†",
    "Ø¬Ø¯ÙˆÙ„ ØªÙ…Ø§Ø±ÙŠÙ†",
}
NUTRITION_PLAN_KEYWORDS = {
    "nutrition plan",
    "meal plan",
    "diet plan",
    "Ø®Ø·Ø© ØºØ°Ø§Ø¦ÙŠØ©",
    "Ø®Ø·Ø© ØªØºØ°ÙŠØ©",
    "Ø¬Ø¯ÙˆÙ„ ÙˆØ¬Ø¨Ø§Øª",
}
NUTRITION_KB_KEYWORDS = {
    "nutrition",
    "diet",
    "meal",
    "food",
    "foods",
    "ingredient",
    "calories",
    "protein",
    "carbs",
    "fat",
    "allergy",
    "allergies",
    "diabetes",
    "blood pressure",
    "cholesterol",
    "heart disease",
    "تغذية",
    "غذاء",
    "اكل",
    "وجبة",
    "وجبات",
    "سعرات",
    "بروتين",
    "كارب",
    "دهون",
    "حساسية",
    "سكري",
    "ضغط",
    "كوليسترول",
    "قلب",
    "خطة غذائية",
    "دايت",
}
PROGRESS_KEYWORDS = {"progress", "tracking", "adherence", "Ø§Ù„Ø§Ù„ØªØ²Ø§Ù…", "Ø§Ù„ØªÙ‚Ø¯Ù…", "Ø§Ù†Ø¬Ø§Ø²"}
PERFORMANCE_ANALYSIS_KEYWORDS = {
    "performance",
    "weekly performance",
    "monthly performance",
    "performance analysis",
    "rate of progress",
    "on track",
    "ahead of schedule",
    "behind schedule",
    "weeks remaining",
    "timeline",
    "remaining time",
    "time to goal",
    "remaining weeks",
    "progress percentage",
    "how am i progressing",
    "how was my progress",
    "how was my performance",
    "how did i do",
    "how am i doing",
    "تحليل الأداء",
    "تحليل الاداء",
    "اداء",
    "أداء",
    "اسبوعي",
    "أسبوعي",
    "شهري",
    "تحليل التقدم",
    "على المسار",
    "متقدم",
    "متأخر",
    "كم أسبوع",
    "كم اسبوع",
    "قديش ضايل",
    "كم ضايل",
    "ضايلي",
    "ضايل",
    "ضايل لهدفي",
    "كم ضايلي",
    "قديش ضايلي",
    "قديش ضل",
    "كيف تقدمي",
    "قديش تقدمي",
    "وين وصلت",
    "شو نسبة التقدم",
    "نسبة التقدم",
    "كيف كان ادائي",
    "كيف كان أدائي",
    "كيف كان تقدمي",
    "كيف ماشي",
    "شلون كان ادائي",
    "شلون كان أدائي",
}
APPROVE_KEYWORDS = {"approve", "yes", "ÙˆØ§ÙÙ‚", "Ø§Ø¹ØªÙ…Ø¯", "Ù…ÙˆØ§ÙÙ‚"}
REJECT_KEYWORDS = {"reject", "no", "Ø±ÙØ¶", "Ù„Ø§", "ØºÙŠØ± Ø§Ù„Ø®Ø·Ø©", "Ø¨Ø¯Ù„ Ø§Ù„Ø®Ø·Ø©"}
JORDANIAN_HINTS = {"Ø´Ùˆ", "Ø¨Ø¯Ùƒ", "Ù‡Ù„Ø§", "Ù„Ø³Ø§", "Ù…Ø´", "ÙƒØªÙŠØ±", "Ù…Ù†ÙŠØ­", "ØªÙ…Ø§Ù…"}


PLAN_CHOICE_KEYWORDS = {
    "choose",
    "option",
    "pick",
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    
}
PLAN_REFRESH_KEYWORDS = {"more options", "another options", "Ø®ÙŠØ§Ø±Ø§Øª Ø§ÙƒØ«Ø±", "Ø®ÙŠØ§Ø±Ø§Øª Ø£Ø®Ø±Ù‰", "ØºÙŠØ±Ù‡Ù…"}
APPROVE_KEYWORDS = APPROVE_KEYWORDS | {"accept", "okay", "ok", "Ù…Ø§Ø´ÙŠ"}
REJECT_KEYWORDS = REJECT_KEYWORDS | {"decline", "cancel"}
WORKOUT_PLAN_KEYWORDS = WORKOUT_PLAN_KEYWORDS | {"workout", "training", "routine", "\u062a\u0645\u0627\u0631\u064a\u0646", "\u0628\u0631\u0646\u0627\u0645\u062c"}
NUTRITION_PLAN_KEYWORDS = NUTRITION_PLAN_KEYWORDS | {"nutrition", "diet", "meal", "\u062a\u063a\u0630\u064a\u0629", "\u0648\u062c\u0628\u0627\u062a"}


THANKS_KEYWORDS = {
    "thanks",
    "thank you",
    "thx",
    "good job",
    "nice",
    "awesome",
    "great",
    "well done",
    "\u0634\u0643\u0631\u0627",
    "\u064a\u0633\u0644\u0645\u0648",
    "\u064a\u0639\u0637\u064a\u0643 \u0627\u0644\u0639\u0627\u0641\u064a\u0629",
    "\u0627\u062d\u0633\u0646\u062a",
    "\u0623\u062d\u0633\u0646\u062a",
}
WHO_AM_I_KEYWORDS = {
    "who am i",
    "tell me about me",
    "my info",
    "my profile",
    "\u0645\u064a\u0646 \u0627\u0646\u0627",
    "\u0645\u064a\u0646 \u0623\u0646\u0627",
    "\u0639\u0631\u0641\u0646\u064a",
    "\u0645\u0639\u0644\u0648\u0645\u0627\u062a\u064a",
    "\u0645\u0644\u0641\u064a",
}
ASK_MY_AGE_KEYWORDS = {"my age", "how old am i", "\u0643\u0645 \u0639\u0645\u0631\u064a", "\u0639\u0645\u0631\u064a"}
ASK_MY_HEIGHT_KEYWORDS = {"my height", "how tall am i", "\u0637\u0648\u0644\u064a", "\u0643\u0645 \u0637\u0648\u0644\u064a"}
ASK_MY_WEIGHT_KEYWORDS = {"my weight", "how much do i weigh", "\u0648\u0632\u0646\u064a", "\u0643\u0645 \u0648\u0632\u0646\u064a"}
ASK_MY_GOAL_KEYWORDS = {"my goal", "what is my goal", "\u0647\u062f\u0641\u064a", "\u0634\u0648 \u0647\u062f\u0641\u064a", "\u0645\u0627 \u0647\u062f\u0641\u064a"}

PROGRESS_CONCERN_KEYWORDS = {
    "no progress",
    "no change",
    "not improving",
    "plateau",
    "stuck",
    "\u0645\u0627 \u0641\u064a \u0641\u0631\u0642",
    "\u0645\u0641\u064a\u0634 \u0641\u0631\u0642",
    "\u0645\u0627 \u062a\u063a\u064a\u0631 \u062c\u0633\u0645\u064a",
    "\u062c\u0633\u0645\u064a \u0645\u0627 \u062a\u063a\u064a\u0631",
    "\u062b\u0627\u0628\u062a",
    "\u0645\u0627 \u0639\u0645 \u0628\u0646\u0632\u0644",
    "\u0645\u0627 \u0639\u0645 \u0628\u0632\u064a\u062f",
}
TROUBLESHOOT_KEYWORDS = {
    "exercise wrong",
    "wrong form",
    "bad form",
    "pain during exercise",
    "injury",
    "hurts",
    "movement is wrong",
    "\u0627\u0644\u062a\u0645\u0631\u064a\u0646 \u063a\u0644\u0637",
    "\u062d\u0631\u0643\u062a\u064a \u063a\u0644\u0637",
    "\u0628\u0648\u062c\u0639\u0646\u064a",
    "\u064a\u0648\u062c\u0639\u0646\u064a",
    "\u0627\u0635\u0627\u0628\u0629",
    "\u0625\u0635\u0627\u0628\u0629",
    "\u0623\u0644\u0645",
    "\u0648\u062c\u0639",
}
PLAN_STATUS_KEYWORDS = {
    "active plan",
    "current plan",
    "\u0647\u0644 \u0639\u0646\u062f\u064a \u062e\u0637\u0629",
    "\u0634\u0648 \u062e\u0637\u062a\u064a",
    "\u0645\u0627 \u0647\u064a \u062e\u0637\u062a\u064a",
    "\u062e\u0637\u062a\u064a \u0627\u0644\u062d\u0627\u0644\u064a\u0629",
}

# Add robust Arabic forms to avoid encoding-related misses.
GREETING_KEYWORDS = GREETING_KEYWORDS | {
    "\u0645\u0631\u062d\u0628\u0627",
    "\u0627\u0647\u0644\u0627",
    "\u0647\u0644\u0627",
    "\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u064a\u0643\u0645",
}
NAME_KEYWORDS = NAME_KEYWORDS | {
    "\u0627\u0633\u0645\u0643",
    "\u0634\u0648 \u0627\u0633\u0645\u0643",
    "\u0645\u064a\u0646 \u0627\u0646\u062a",
}
HOW_ARE_YOU_KEYWORDS = HOW_ARE_YOU_KEYWORDS | {
    "\u0643\u064a\u0641\u0643",
    "\u0634\u0644\u0648\u0646\u0643",
    "\u0643\u064a\u0641 \u062d\u0627\u0644\u0643",
}
WORKOUT_PLAN_KEYWORDS = WORKOUT_PLAN_KEYWORDS | {
    "\u062e\u0637\u0629 \u062a\u0645\u0627\u0631\u064a\u0646",
    "\u062e\u0637\u0647 \u062a\u0645\u0627\u0631\u064a\u0646",
    "\u0628\u062f\u064a \u062e\u0637\u0629 \u062a\u0645\u0627\u0631\u064a\u0646",
    "\u0627\u0639\u0637\u064a\u0646\u064a \u062e\u0637\u0629 \u062a\u0645\u0627\u0631\u064a\u0646",
    "\u0627\u0628\u063a\u0649 \u062e\u0637\u0629 \u062a\u0645\u0627\u0631\u064a\u0646",
    "\u062e\u0637\u0629 \u062a\u062f\u0631\u064a\u0628",
    "\u0628\u0631\u0646\u0627\u0645\u062c \u062a\u062f\u0631\u064a\u0628\u064a",
    "\u062c\u062f\u0648\u0644 \u062a\u062f\u0631\u064a\u0628",
    "\u0628\u062f\u064a \u062e\u0637\u0629",
    "\u0628\u062f\u064a \u0628\u0631\u0646\u0627\u0645\u062c",
    "\u0627\u0639\u0637\u064a\u0646\u064a \u0628\u0631\u0646\u0627\u0645\u062c",
    "\u0627\u0628\u063a\u0649 \u0628\u0631\u0646\u0627\u0645\u062c",
    "\u0628\u0631\u0646\u0627\u0645\u062c \u062a\u0645\u0627\u0631\u064a\u0646",
    "\u062c\u062f\u0648\u0644 \u062a\u0645\u0627\u0631\u064a\u0646",
    "\u062a\u0645\u0631\u064a\u0646",
    "\u062a\u0645\u0627\u0631\u064a\u0646",
    "\u0627\u0644\u0635\u062f\u0631",
    "\u0627\u0644\u0638\u0647\u0631",
    "\u0627\u0644\u0633\u0627\u0642",
    "\u0627\u0644\u0627\u0631\u062c\u0644",
    "\u0627\u0644\u0643\u062a\u0641",
}
NUTRITION_PLAN_KEYWORDS = NUTRITION_PLAN_KEYWORDS | {
    "\u062e\u0637\u0629 \u063a\u0630\u0627\u0626\u064a\u0629",
    "\u062e\u0637\u0629 \u062a\u063a\u0630\u064a\u0629",
    "\u062c\u062f\u0648\u0644 \u0648\u062c\u0628\u0627\u062a",
    "\u0633\u0639\u0631\u0627\u062a",
    "\u0628\u0631\u0648\u062a\u064a\u0646",
}
PROGRESS_KEYWORDS = PROGRESS_KEYWORDS | {
    "\u0627\u0644\u062a\u0632\u0627\u0645",
    "\u0627\u0644\u062a\u0642\u062f\u0645",
    "\u0627\u0646\u062c\u0627\u0632",
    "\u0645\u0627 \u0641\u064a \u0641\u0631\u0642",
    "\u0627\u062f\u0627\u0626\u064a",
    "\u0623\u062f\u0627\u0626\u064a",
    "performance",
    "my progress",
    "my performance",
}
JORDANIAN_HINTS = JORDANIAN_HINTS | {
    "\u0634\u0648",
    "\u0628\u062f\u0643",
    "\u0645\u0634",
    "\u0645\u0646\u064a\u062d",
    "\u062a\u0645\u0627\u0645",
}

STRONG_DOMAIN_KEYWORDS = {
    "workout",
    "exercise",
    "training",
    "gym",
    "muscle",
    "strength",
    "hypertrophy",
    "progressive overload",
    "overload",
    "sets",
    "reps",
    "rest time",
    "nutrition",
    "meal",
    "diet",
    "calories",
    "protein",
    "\u062a\u0645\u0631\u064a\u0646",
    "\u062a\u0645\u0627\u0631\u064a\u0646",
    "\u062a\u062f\u0631\u064a\u0628",
    "\u0627\u0644\u0635\u062f\u0631",
    "\u0639\u0636\u0644",
    "\u0639\u0636\u0644\u0627\u062a",
    "\u0642\u0648\u0629",
    "\u0636\u062e\u0627\u0645\u0629",
    "\u062d\u0645\u0644 \u062a\u062f\u0631\u064a\u062c\u064a",
    "\u0627\u0648\u0641\u0631\u0644\u0648\u062f",
    "\u0645\u062c\u0645\u0648\u0639\u0627\u062a",
    "\u062a\u0643\u0631\u0627\u0631\u0627\u062a",
    "\u063a\u0630\u0627\u0621",
    "\u062a\u063a\u0630\u064a\u0629",
    "\u0648\u062c\u0628\u0627\u062a",
    "\u0633\u0639\u0631\u0627\u062a",
    "\u0628\u0631\u0648\u062a\u064a\u0646",
    "\u0644\u064a\u0627\u0642\u0629",
}

ML_GOAL_QUERY_KEYWORDS = {
    "predict goal",
    "goal prediction",
    "predict my goal",
    "best goal for me",
    "recommended goal",
    "what goal suits me",
    "توقع الهدف",
    "تنبؤ الهدف",
    "شو الهدف المناسب",
    "اي هدف مناسب",
    "ما الهدف المناسب",
    "توقع هدفي",
}

ML_SUCCESS_QUERY_KEYWORDS = {
    "success prediction",
    "predict success",
    "success probability",
    "chance of success",
    "will i succeed",
    "am i likely to succeed",
    "نسبة النجاح",
    "احتمال النجاح",
    "توقع النجاح",
    "هل رح انجح",
    "هل سأنجح",
    "هل رح ألتزم",
    "هل سانجح",
}

ML_GENERAL_PREDICTION_KEYWORDS = {
    "predict",
    "prediction",
    "ai prediction",
    "model prediction",
    "توقع",
    "تنبؤ",
    "توقعي",
}


def _expand_keyword_set_with_repair(values: set[str]) -> set[str]:
    expanded = set(values)
    for value in list(values):
        repaired = _repair_mojibake(value)
        if repaired:
            expanded.add(repaired)
    return expanded


GREETING_KEYWORDS = _expand_keyword_set_with_repair(GREETING_KEYWORDS)
NAME_KEYWORDS = _expand_keyword_set_with_repair(NAME_KEYWORDS)
HOW_ARE_YOU_KEYWORDS = _expand_keyword_set_with_repair(HOW_ARE_YOU_KEYWORDS)
WORKOUT_PLAN_KEYWORDS = _expand_keyword_set_with_repair(WORKOUT_PLAN_KEYWORDS)
NUTRITION_PLAN_KEYWORDS = _expand_keyword_set_with_repair(NUTRITION_PLAN_KEYWORDS)
NUTRITION_KB_KEYWORDS = _expand_keyword_set_with_repair(NUTRITION_KB_KEYWORDS)
PROGRESS_KEYWORDS = _expand_keyword_set_with_repair(PROGRESS_KEYWORDS)
APPROVE_KEYWORDS = _expand_keyword_set_with_repair(APPROVE_KEYWORDS)
REJECT_KEYWORDS = _expand_keyword_set_with_repair(REJECT_KEYWORDS)
JORDANIAN_HINTS = _expand_keyword_set_with_repair(JORDANIAN_HINTS)
PLAN_CHOICE_KEYWORDS = _expand_keyword_set_with_repair(PLAN_CHOICE_KEYWORDS)
PLAN_REFRESH_KEYWORDS = _expand_keyword_set_with_repair(PLAN_REFRESH_KEYWORDS)
THANKS_KEYWORDS = _expand_keyword_set_with_repair(THANKS_KEYWORDS)
WHO_AM_I_KEYWORDS = _expand_keyword_set_with_repair(WHO_AM_I_KEYWORDS)
ASK_MY_AGE_KEYWORDS = _expand_keyword_set_with_repair(ASK_MY_AGE_KEYWORDS)
ASK_MY_HEIGHT_KEYWORDS = _expand_keyword_set_with_repair(ASK_MY_HEIGHT_KEYWORDS)
ASK_MY_WEIGHT_KEYWORDS = _expand_keyword_set_with_repair(ASK_MY_WEIGHT_KEYWORDS)
ASK_MY_GOAL_KEYWORDS = _expand_keyword_set_with_repair(ASK_MY_GOAL_KEYWORDS)
PROGRESS_CONCERN_KEYWORDS = _expand_keyword_set_with_repair(PROGRESS_CONCERN_KEYWORDS)
TROUBLESHOOT_KEYWORDS = _expand_keyword_set_with_repair(TROUBLESHOOT_KEYWORDS)
PLAN_STATUS_KEYWORDS = _expand_keyword_set_with_repair(PLAN_STATUS_KEYWORDS)
STRONG_DOMAIN_KEYWORDS = _expand_keyword_set_with_repair(STRONG_DOMAIN_KEYWORDS)
ML_GOAL_QUERY_KEYWORDS = _expand_keyword_set_with_repair(ML_GOAL_QUERY_KEYWORDS)
ML_SUCCESS_QUERY_KEYWORDS = _expand_keyword_set_with_repair(ML_SUCCESS_QUERY_KEYWORDS)
ML_GENERAL_PREDICTION_KEYWORDS = _expand_keyword_set_with_repair(ML_GENERAL_PREDICTION_KEYWORDS)

MOTIVATION_LINES = {
    "en": [
        "Your consistency lately is excellent.",
        "You are progressing step by step in the right direction.",
        "Even if progress feels slow, your discipline is working.",
        "What you are doing now will show clear results soon.",
        "Real progress starts with routine, and you are building it.",
        "You are doing better than you think.",
    ],
    "ar_fusha": [
        "\u0639\u0645\u0644\u0643 \u0645\u0645\u062a\u0627\u0632 \u0641\u064a \u0627\u0644\u0641\u062a\u0631\u0629 \u0627\u0644\u0623\u062e\u064a\u0631\u0629.",
        "\u0648\u0627\u0636\u062d \u0623\u0646\u0643 \u0645\u0644\u062a\u0632\u0645 \u0648\u062a\u062a\u0642\u062f\u0645 \u062e\u0637\u0648\u0629 \u0628\u062e\u0637\u0648\u0629.",
        "\u0623\u0646\u0627 \u0641\u062e\u0648\u0631 \u0628\u0627\u0644\u0627\u0644\u062a\u0632\u0627\u0645 \u0627\u0644\u0630\u064a \u062a\u0642\u062f\u0645\u0647.",
        "\u062d\u062a\u0649 \u0644\u0648 \u0643\u0627\u0646 \u0627\u0644\u062a\u0642\u062f\u0645 \u0628\u0637\u064a\u0626\u0627\u064b \u0641\u0623\u0646\u062a \u0639\u0644\u0649 \u0627\u0644\u0645\u0633\u0627\u0631 \u0627\u0644\u0635\u062d\u064a\u062d.",
        "\u0627\u0644\u0646\u062a\u0627\u0626\u062c \u0627\u0644\u062c\u064a\u062f\u0629 \u062a\u0628\u062f\u0623 \u0628\u0627\u0644\u0627\u0646\u0636\u0628\u0627\u0637.",
        "\u0627\u0633\u062a\u0645\u0631 \u2014 \u0623\u0646\u062a \u0645\u0627\u0634\u064d \u0628\u0634\u0643\u0644 \u0645\u0645\u062a\u0627\u0632.",
    ],
    "ar_jordanian": [
        "\u0634\u063a\u0644\u0643 \u0645\u0645\u062a\u0627\u0632 \u0628\u0627\u0644\u0641\u062a\u0631\u0629 \u0627\u0644\u0623\u062e\u064a\u0631\u0629.",
        "\u0648\u0627\u0636\u062d \u0625\u0646\u0643 \u0645\u0644\u062a\u0632\u0645 \u0648\u0639\u0645 \u062a\u062a\u0642\u062f\u0645 \u0634\u0648\u064a \u0634\u0648\u064a.",
        "\u062d\u062a\u0649 \u0644\u0648 \u0627\u0644\u062a\u0642\u062f\u0645 \u0628\u0637\u064a\u0621 \u2014 \u0625\u0646\u062a \u0645\u0627\u0634\u064a \u0635\u062d.",
        "\u0627\u0633\u062a\u0645\u0631\u060c \u0625\u0646\u062a \u0639\u0644\u0649 \u0627\u0644\u0645\u0633\u0627\u0631 \u0627\u0644\u0635\u062d.",
        "\u0627\u0644\u0646\u062a\u0627\u0626\u062c \u0628\u062f\u0647\u0627 \u0635\u0628\u0631 \u0628\u0633 \u0625\u0646\u062a \u0634\u063a\u0627\u0644 \u0635\u062d.",
        "\u0623\u0646\u0627 \u0645\u0639\u0643 \u062e\u0637\u0648\u0629 \u0628\u062e\u0637\u0648\u0629.",
    ],
}

def _normalize_user_id(user_id: Optional[str]) -> str:
    return (user_id or "anonymous").strip() or "anonymous"


def _normalize_conversation_id(conversation_id: Optional[str], user_id: str) -> str:
    return (conversation_id or f"conv_{user_id}").strip() or f"conv_{user_id}"


def _session_key(user_id: str, conversation_id: str) -> str:
    return f"{user_id}:{conversation_id}"


def _get_memory_session(user_id: str, conversation_id: str) -> MemorySystem:
    key = _session_key(user_id, conversation_id)
    if key not in MEMORY_SESSIONS:
        MEMORY_SESSIONS[key] = MemorySystem(user_id=user_id, max_short_term=10)
    return MEMORY_SESSIONS[key]


def _get_user_state(user_id: str) -> Dict[str, Any]:
    if user_id not in USER_STATE:
        USER_STATE[user_id] = {}
    return USER_STATE[user_id]


def _contains_any(text: str, keywords: set[str]) -> bool:
    return fuzzy_contains_any(text, keywords)


def _contains_phrase(text: str, phrases: set[str]) -> bool:
    normalized_text = normalize_text(text)
    if not normalized_text:
        return False
    for phrase in phrases:
        phrase_norm = normalize_text(phrase)
        if phrase_norm and phrase_norm in normalized_text:
            return True
    return False


@lru_cache(maxsize=1)
def _routing_vocab_tokens() -> tuple[str, ...]:
    keyword_sources = [
        GREETING_KEYWORDS,
        NAME_KEYWORDS,
        HOW_ARE_YOU_KEYWORDS,
        WORKOUT_PLAN_KEYWORDS,
        NUTRITION_PLAN_KEYWORDS,
        NUTRITION_KB_KEYWORDS,
        PROGRESS_KEYWORDS,
        APPROVE_KEYWORDS,
        REJECT_KEYWORDS,
        PLAN_CHOICE_KEYWORDS,
        PLAN_REFRESH_KEYWORDS,
        THANKS_KEYWORDS,
        PLAN_STATUS_KEYWORDS,
        PROGRESS_CONCERN_KEYWORDS,
        TROUBLESHOOT_KEYWORDS,
        STRONG_DOMAIN_KEYWORDS,
        ML_GOAL_QUERY_KEYWORDS,
        ML_SUCCESS_QUERY_KEYWORDS,
        ML_GENERAL_PREDICTION_KEYWORDS,
    ]

    vocab: set[str] = set()
    for source in keyword_sources:
        for item in source:
            normalized = normalize_text(item)
            if not normalized:
                continue
            for token in normalized.split():
                if len(token) >= 3:
                    vocab.add(token)
    return tuple(sorted(vocab))


def _normalize_routing_input(user_input: str) -> str:
    normalized = normalize_text(user_input)
    if not normalized:
        return ""

    vocab = _routing_vocab_tokens()
    if not vocab:
        return normalized

    corrected_tokens: list[str] = []
    changed = False
    for token in tokenize(normalized):
        if len(token) < 4 or token in vocab:
            corrected_tokens.append(token)
            continue

        best_match = None
        for candidate in vocab:
            if abs(len(candidate) - len(token)) > 2:
                continue
            if token[0] != candidate[0]:
                continue
            if len(token) >= 5 and token[-1] != candidate[-1]:
                continue
            if fuzzy_token_match(token, candidate):
                best_match = candidate
                break

        if best_match:
            corrected_tokens.append(best_match)
            if best_match != token:
                changed = True
        else:
            corrected_tokens.append(token)

    if not changed:
        return normalized
    return " ".join(corrected_tokens)


def _is_nutrition_knowledge_query(user_input: str) -> bool:
    normalized = normalize_text(user_input)
    if not normalized:
        return False
    if _contains_any(normalized, NUTRITION_KB_KEYWORDS | NUTRITION_PLAN_KEYWORDS):
        return True
    if NUTRITION_KB.ready and len(normalized.split()) <= 8:
        hits = NUTRITION_KB.search(user_input, top_k=1, max_chars=140)
        if not hits:
            return False

        top_score = _to_float(hits[0].get("score")) or 0.0
        query_tokens = tokenize(normalized)

        # Short general questions like "what's the best weather..." can share
        # one generic word with the nutrition text. Require stronger overlap.
        return top_score >= 3 and len(query_tokens) <= 5
    return False


def _is_greeting_query(user_input: str) -> bool:
    normalized = normalize_text(user_input)
    if not normalized:
        return False
    if len(normalized.split()) > 4:
        return False
    greeting_phrases = {
        "hi",
        "hello",
        "hey",
        "مرحبا",
        "اهلا",
        "هلا",
        "السلام عليكم",
        "سلام",
    }
    return _contains_phrase(normalized, greeting_phrases)


def _is_name_query(user_input: str) -> bool:
    return _contains_phrase(
        user_input,
        {
            "what is your name",
            "your name",
            "name",
            "who are you",
            "what can you do",
            "what do you do",
            "introduce yourself",
            "اسمك",
            "شو اسمك",
            "مين انت",
            "من انت",
            "شو بتعمل",
            "عرفني عنك",
        },
    )


def _is_how_are_you_query(user_input: str) -> bool:
    return _contains_phrase(
        user_input,
        {
            "how are you",
            "كيفك",
            "كيف حالك",
            "شلونك",
            "كيف الحال",
        },
    )


def _is_vague_followup_query(user_input: str) -> bool:
    normalized = normalize_text(user_input)
    if not normalized:
        return False

    vague_phrases = {
        "give me",
        "help me",
        "more",
        "another",
        "what else",
        "what now",
        "go on",
        "continue",
        "start",
        "ابدأ",
        "كمل",
        "كمان",
        "اعطيني",
        "ساعدني",
    }
    if normalized in vague_phrases:
        return True

    tokens = normalized.split()
    if len(tokens) > 3:
        return False

    vague_starters = {
        "give",
        "help",
        "suggest",
        "recommend",
        "start",
        "more",
        "another",
        "اعطيني",
        "ساعدني",
        "اقترح",
        "كمل",
    }
    return bool(tokens) and tokens[0] in vague_starters


def _is_workout_plan_request(user_input: str) -> bool:
    normalized = normalize_text(user_input)
    return (
        _contains_any(normalized, WORKOUT_PLAN_TERMS) or _contains_any(normalized, PLAN_BUILD_TERMS)
    ) and _contains_any(normalized, WORKOUT_REQUEST_TERMS)


def _is_nutrition_plan_request(user_input: str) -> bool:
    normalized = normalize_text(user_input)
    return (
        _contains_any(normalized, NUTRITION_PLAN_TERMS) or _contains_any(normalized, PLAN_BUILD_TERMS)
    ) and _contains_any(normalized, NUTRITION_REQUEST_TERMS)


def _is_generic_plan_request(user_input: str) -> bool:
    normalized = normalize_text(user_input)
    if not normalized:
        return False

    if not (_contains_any(normalized, GENERIC_PLAN_TERMS) or _contains_any(normalized, PLAN_BUILD_TERMS)):
        return False

    # Not generic if already explicit.
    if _is_workout_plan_request(user_input) or _is_nutrition_plan_request(user_input):
        return False
    return True


def _resolve_plan_type_from_message(
    user_input: str,
    recent_messages: Optional[list[dict[str, Any]]] = None,
    memory: Optional[MemorySystem] = None,
) -> tuple[Optional[str], Optional[dict[str, Any]]]:
    contextual_type = _resolve_contextual_plan_type(user_input, recent_messages, memory)
    if _is_workout_plan_request(user_input):
        return "workout", None
    if _is_nutrition_plan_request(user_input):
        return "nutrition", None
    if not _is_generic_plan_request(user_input):
        return contextual_type, None

    try:
        prediction = predict_plan_intent(user_input)
        predicted = str(prediction.get("predicted_intent", "")).strip().lower()
        confidence = _to_float(prediction.get("confidence"))
        if predicted in {"workout", "nutrition"} and (confidence is None or confidence >= 0.50):
            return predicted, prediction
    except FileNotFoundError:
        return contextual_type, None
    except Exception:
        return contextual_type, None

    return contextual_type, None


WORKOUT_PLAN_TERMS = {
    "plan",
    "program",
    "schedule",
    "weekly",
    "routine",
    "خطة",
    "خطه",
    "جدول",
    "برنامج",
    "اسبوع",
    "أسبوع",
    "روتين",
}

NUTRITION_PLAN_TERMS = {
    "plan",
    "program",
    "schedule",
    "daily",
    "routine",
    "خطة",
    "خطه",
    "جدول",
    "برنامج",
    "يومي",
    "يومية",
    "روتين",
}

GENERIC_PLAN_TERMS = WORKOUT_PLAN_TERMS | NUTRITION_PLAN_TERMS | {"بلان"}

PLAN_BUILD_TERMS = {
    "create",
    "make",
    "build",
    "generate",
    "prepare",
    "design",
    "write",
    "organize",
    "structure",
    "turn into",
    "اعمل",
    "اعمللي",
    "سوي",
    "سوّي",
    "جهز",
    "جهزلي",
    "حضّر",
    "حضر",
    "صمم",
    "رتب",
    "رتبلي",
    "رتبها",
    "حولها",
    "حوّلها",
    "اكتب",
    "ابني",
    "كون",
}

WORKOUT_REQUEST_TERMS = {
    "workout",
    "training",
    "exercise",
    "gym",
    "split",
    "session",
    "تمرين",
    "تمارين",
    "تدريب",
    "عضل",
    "عضلات",
    "حصة",
    "جلسة",
}

NUTRITION_REQUEST_TERMS = {
    "nutrition",
    "diet",
    "meal",
    "meals",
    "calories",
    "food",
    "protein",
    "macros",
    "تغذية",
    "وجبة",
    "وجبات",
    "اكل",
    "أكل",
    "طعام",
    "سعرات",
    "بروتين",
    "ماكروز",
}

PLAN_FOLLOWUP_TERMS = {
    "organize it",
    "organize it into a plan",
    "structure it",
    "make it a plan",
    "turn it into a plan",
    "put it in a schedule",
    "schedule it",
    "build it for me",
    "build a plan from it",
    "رتبها",
    "رتبلي",
    "نظمها",
    "نظملي",
    "حولها لخطة",
    "حوّلها لخطة",
    "حولها لجدول",
    "حوّلها لجدول",
    "نزّلها عالجدول",
    "نزلها عالجدول",
    "حطها بالجدول",
    "حطها عالجدول",
}


def _recent_plan_context_messages(
    recent_messages: Optional[list[dict[str, Any]]],
    memory: Optional[MemorySystem],
    limit: int = 6,
) -> list[str]:
    if recent_messages:
        history = _normalize_recent_messages(recent_messages)
        return [normalize_text(item.get("content", "")) for item in history[-limit:]]
    if memory:
        history = memory.get_conversation_history()[-limit:]
        return [normalize_text(str(item.get("content", ""))) for item in history]
    return []


def _resolve_contextual_plan_type(
    user_input: str,
    recent_messages: Optional[list[dict[str, Any]]] = None,
    memory: Optional[MemorySystem] = None,
) -> Optional[str]:
    normalized = normalize_text(user_input)
    contextual_followup = _contains_any(normalized, PLAN_FOLLOWUP_TERMS) or (
        _contains_any(normalized, PLAN_BUILD_TERMS)
        and _contains_any(normalized, {"it", "this", "that", "ها", "هي", "هذي", "هاد"})
    )
    if not normalized or not contextual_followup:
        return None

    workout_score = 0
    nutrition_score = 0
    for offset, text in enumerate(reversed(_recent_plan_context_messages(recent_messages, memory))):
        weight = max(1, 6 - offset)
        if _contains_any(text, WORKOUT_REQUEST_TERMS):
            workout_score += weight
        if _contains_any(text, NUTRITION_REQUEST_TERMS):
            nutrition_score += weight

    if workout_score == 0 and nutrition_score == 0:
        return None
    return "workout" if workout_score >= nutrition_score else "nutrition"


def _infer_goal_for_plan(profile: dict[str, Any], tracking_summary: Optional[dict[str, Any]]) -> tuple[str, Optional[float], bool]:
    explicit = _normalize_goal(profile.get("goal"))
    if explicit in {"muscle_gain", "fat_loss", "general_fitness"}:
        return explicit, None, False

    payload, _missing = _build_goal_prediction_payload(profile, tracking_summary)
    try:
        prediction = predict_goal(payload)
    except Exception:
        return "general_fitness", None, True

    predicted = _normalize_goal(prediction.get("predicted_goal"))
    confidence = None
    probs = prediction.get("probabilities") if isinstance(prediction.get("probabilities"), dict) else {}
    if predicted in probs:
        confidence = _to_float(probs.get(predicted))

    if predicted not in {"muscle_gain", "fat_loss", "general_fitness"}:
        predicted = "general_fitness"
    return predicted, confidence, True


def _has_arabic(text: str) -> bool:
    return bool(re.search(r"[\u0600-\u06FF]", text))


def _detect_language(requested_language: str, message: str, profile: dict[str, Any]) -> str:
    requested = (requested_language or "en").strip().lower()
    repaired_message = _repair_mojibake(message or "")

    # Always prioritize the actual message content so Arabic works even if UI language is English.
    if _has_arabic(repaired_message):
        preferred = str(profile.get("preferred_language", "")).lower()
        if preferred in {"ar_fusha", "ar_jordanian"}:
            return preferred

        lowered = normalize_text(repaired_message)
        if any(token in lowered for token in JORDANIAN_HINTS):
            return "ar_jordanian"
        return "ar_fusha"

    if requested in {"ar_fusha", "ar_jordanian"}:
        return requested

    if requested == "ar":
        preferred = str(profile.get("preferred_language", "")).lower()
        if preferred in {"ar_fusha", "ar_jordanian"}:
            return preferred
        return "ar_fusha"

    return "en"


def _parse_list_field(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    if isinstance(value, str):
        if not value.strip():
            return []
        split_tokens = re.split(r"[,،\n]| and | و ", _repair_mojibake(value))
        return [t.strip() for t in split_tokens if t.strip()]
    return [str(value).strip()]


def _nutrition_kb_context(user_input: str, profile: dict[str, Any], top_k: int = 3) -> str:
    if not NUTRITION_KB.ready:
        return ""
    if not _is_nutrition_knowledge_query(user_input):
        return ""

    query_parts: list[str] = [user_input]
    goal = str(profile.get("goal", "")).strip()
    if goal:
        query_parts.append(goal)

    chronic_diseases = _parse_list_field(profile.get("chronic_diseases"))
    allergies = _parse_list_field(profile.get("allergies"))
    if chronic_diseases:
        query_parts.append(" ".join(chronic_diseases))
    if allergies:
        query_parts.append(" ".join(allergies))

    query = " | ".join(part for part in query_parts if part)
    hits = NUTRITION_KB.search(query, top_k=top_k, max_chars=420)
    if not hits:
        return ""
    return "\n".join(f"- {hit['text']}" for hit in hits)


def _quick_nutrition_reply(user_input: str, language: str, profile: dict[str, Any]) -> Optional[str]:
    normalized = normalize_text(user_input)
    if not normalized:
        return None

    if _contains_any(normalized, {"banana", "bananas", "موز", "موزه", "موزة"}):
        goal = _normalize_goal(profile.get("goal") or "")
        extra_en = {
            "muscle_gain": "It works especially well before training if you need easy carbs, and even better with whey or Greek yogurt.",
            "fat_loss": "It is still fine during fat loss, just fit it into your calories and pair it with protein if you want better satiety.",
        }.get(goal, "It is especially useful before training because it gives quick carbs and is easy to digest.")
        extra_ar_fusha = {
            "muscle_gain": "وهو مناسب جدًا قبل التمرين إذا كنت تحتاج كربوهيدرات سهلة، ويصبح أفضل مع الواي أو الزبادي اليوناني.",
            "fat_loss": "وهو مناسب أيضًا أثناء خسارة الدهون، لكن أدخله ضمن سعراتك ويفضل أن تقرنه ببروتين لزيادة الشبع.",
        }.get(goal, "وهو مفيد خاصة قبل التمرين لأنه يمنحك كربوهيدرات سريعة وسهلة الهضم.")
        extra_ar_jordanian = {
            "muscle_gain": "وبفيد كثير قبل التمرين إذا بدك كربوهيدرات سهلة، وبيكون أحسن مع واي أو زبادي يوناني.",
            "fat_loss": "وبرضه مناسب بالتنشيف، بس دخّله ضمن سعراتك ويفضل تضيف معه بروتين عشان الشبع.",
        }.get(goal, "وهو مفيد خصوصًا قبل التمرين لأنه بيعطيك كربوهيدرات سريعة وسهل على الهضم.")
        return _lang_reply(
            language,
            "Banana is a good gym food. It gives you quick carbs, potassium, and easy energy. " + extra_en,
            "الموز خيار جيد للرياضة. يمنحك كربوهيدرات سريعة، وبوتاسيوم، وطاقة سهلة. " + extra_ar_fusha,
            "الموز خيار ممتاز للجيم. بعطيك كربوهيدرات سريعة، وبوتاسيوم، وطاقة سهلة. " + extra_ar_jordanian,
        )

    if not _is_nutrition_knowledge_query(user_input):
        return None

    if _contains_any(normalized, {"protein", "بروتين", "بروتينات"}):
        goal = _normalize_goal(profile.get("goal") or "")
        focus_en = {
            "bulking": "Aim for a larger portion and add carbs like oats or rice.",
            "cutting": "Keep it lean and pair it with fruit or vegetables.",
        }.get(goal, "Keep it balanced with fiber or fruit so it is easy to stick to.")
        focus_ar_fusha = {
            "bulking": "كبّر الحصة وأضف كربوهيدرات مثل الشوفان أو الأرز إذا كان هدفك بناء العضلات.",
            "cutting": "اجعلها خفيفة وقليلة الدهون مع فاكهة أو خضار إذا كان هدفك التنشيف.",
        }.get(goal, "وازنها مع ألياف أو فاكهة حتى تكون سهلة الالتزام.")
        focus_ar_jordanian = {
            "bulking": "إذا هدفك تضخيم كبّر الحصة وزيد شوفان أو رز.",
            "cutting": "إذا هدفك تنشيف خليها خفيفة مع فاكهة أو خضار.",
        }.get(goal, "وازنها مع ألياف أو فاكهة عشان تلتزم فيها بسهولة.")
        return _lang_reply(
            language,
            "Quick protein idea: Greek yogurt with whey and berries, or eggs with cottage cheese. Aim for about 25-35 g protein in one serving. " + focus_en,
            "فكرة بروتين سريعة: زبادي يوناني مع واي وبيري، أو بيض مع جبنة قريش. استهدف تقريبًا 25 إلى 35 غ بروتين في الحصة الواحدة. " + focus_ar_fusha,
            "فكرة بروتين سريعة: زبادي يوناني مع واي وتوت، أو بيض مع جبنة قريش. خليك تقريبًا بين 25 و35 غ بروتين بالوجبة. " + focus_ar_jordanian,
        )

    hits = NUTRITION_KB.search(user_input, top_k=1, max_chars=220) if NUTRITION_KB.ready else []
    if not hits:
        return None

    snippet = str(hits[0].get("text", "")).strip()
    if not snippet:
        return None

    return _lang_reply(
        language,
        f"Quick answer: {snippet}",
        f"إجابة سريعة: {snippet}",
        f"جواب سريع: {snippet}",
    )


def _normalize_goal(goal: Any) -> str:
    text = normalize_text(str(goal or ""))
    if not text:
        return ""
    if fuzzy_contains_any(
        text,
        {
            "bulking",
            "muscle gain",
            "gain muscle",
            "build muscle",
            "hypertrophy",
            "تضخيم",
            "زيادة عضل",
            "بناء عضل",
        },
    ):
        return "muscle_gain"
    if fuzzy_contains_any(
        text,
        {
            "cutting",
            "fat loss",
            "lose fat",
            "lose weight",
            "weight loss",
            "تنشيف",
            "خسارة وزن",
            "نزول وزن",
            "حرق دهون",
        },
    ):
        return "fat_loss"
    if fuzzy_contains_any(text, {"fitness", "general fitness", "health", "maintenance", "لياقة", "رشاقة", "صحة"}):
        return "general_fitness"
    if text in {"bulking", "muscle_gain", "gain muscle", "build muscle", "زيادة عضل", "بناء عضل"}:
        return "muscle_gain"
    if text in {"cutting", "fat_loss", "lose fat", "lose weight", "تنشيف", "خسارة وزن"}:
        return "fat_loss"
    if text in {"fitness", "general_fitness", "لياقة", "رشاقة"}:
        return "general_fitness"
    return text


def _dataset_text(value: Any, language: str = "en") -> str:
    if isinstance(value, dict):
        en_text = _repair_mojibake(str(value.get("en", "")).strip())
        ar_text = _repair_mojibake(str(value.get("ar", "")).strip())
        if language == "en":
            return en_text or ar_text
        return ar_text or en_text

    raw = _repair_mojibake(str(value or "").strip())
    if not raw:
        return ""

    # Many dataset fields are bilingual in one string (for example: "عربي / English").
    # Pick the segment matching the requested language to avoid mixed/gibberish-looking titles.
    parts = [p.strip(" -|\t") for p in re.split(r"\s*/\s*|\s*\|\s*", raw) if p and p.strip()]
    if len(parts) >= 2:
        if language == "en":
            english_parts = [p for p in parts if not _has_arabic(p) and re.search(r"[A-Za-z]", p)]
            if english_parts:
                return english_parts[0]
            non_arabic_parts = [p for p in parts if not _has_arabic(p)]
            if non_arabic_parts:
                return non_arabic_parts[0]
            return parts[-1]

        arabic_parts = [p for p in parts if _has_arabic(p)]
        if arabic_parts:
            return arabic_parts[0]
        return parts[0]

    if _has_arabic(raw) and re.search(r"[A-Za-z]", raw):
        dash_parts = [p.strip(" -|\t") for p in re.split(r"\s*[\u2013\u2014\-]\s*", raw) if p and p.strip()]
        if len(dash_parts) >= 2:
            if language == "en":
                for part in dash_parts:
                    if not _has_arabic(part) and re.search(r"[A-Za-z]", part):
                        return part
                return dash_parts[-1]
            for part in dash_parts:
                if _has_arabic(part):
                    return part
            return dash_parts[0]

    return raw


def _clean_language_text(value: Any, language: str, fallback: str = "") -> str:
    text = _dataset_text(value, language).strip()
    if not text:
        return fallback

    if language == "en":
        # Do not show Arabic-heavy titles in English UI; use a clear fallback instead.
        if _has_arabic(text) or not re.search(r"[A-Za-z0-9]", text):
            return fallback or text
        return text

    if language in {"ar", "ar_fusha", "ar_jordanian"}:
        if _has_arabic(text):
            return text
        alt = _dataset_text(value, "ar_fusha").strip()
        if _has_arabic(alt):
            return alt
        return fallback or text

    return text


def _dataset_goal_key(value: Any) -> str:
    if isinstance(value, dict):
        text = f"{value.get('en', '')} {value.get('ar', '')}".strip()
    else:
        text = str(value or "")
    return _normalize_goal(text)


def _dataset_level_key(value: Any) -> str:
    normalized = normalize_text(str(value or ""))
    if "beg" in normalized or "مبت" in normalized:
        return "beginner"
    if "inter" in normalized or "متوس" in normalized:
        return "intermediate"
    if "adv" in normalized or "متقد" in normalized:
        return "advanced"
    return "beginner"


def _dataset_intent_matches(user_input: str, tag: str) -> bool:
    return RESPONSE_DATASETS.matches_intent(user_input, tag)


def _dataset_intent_response(tag: str, language: str, seed: str = "") -> Optional[str]:
    response = RESPONSE_DATASETS.pick_response(tag, language=language, seed=seed)
    if not response:
        return None
    return _repair_mojibake(response)


def _smart_dataset_followup(user_input: str, language: str) -> str:
    normalized = normalize_text(user_input)
    workout_terms = {"workout", "exercise", "training", "routine", "تمرين", "تمارين", "تدريب"}
    nutrition_terms = {"nutrition", "meal", "diet", "food", "protein", "calories", "تغذية", "وجبة", "وجبات", "سعرات"}
    progress_terms = {"progress", "track", "adherence", "plateau", "tracking", "progression", "تقدم", "التزام", "متابعة"}

    if any(term in normalized for term in workout_terms):
        return _lang_reply(
            language,
            "Tell me your goal, training days, and available equipment, and I will tailor this into a sharper workout recommendation. 💪",
            "أخبرني بهدفك وعدد أيام التمرين والمعدات المتاحة لديك، وسأحوّل هذا إلى توصية تدريبية أدق. 💪",
            "احكيلي هدفك وكم يوم بتتمرن وشو المعدات عندك، وبرتبلك توصية تدريب أذكى. 💪",
        )

    if any(term in normalized for term in nutrition_terms):
        return _lang_reply(
            language,
            "If you share your goal, weight, and food preferences, I can turn this into a smarter nutrition recommendation. 🥗",
            "إذا شاركتني هدفك ووزنك وتفضيلاتك الغذائية، يمكنني تحويل هذا إلى توصية غذائية أذكى. 🥗",
            "إذا بتحكيلي هدفك ووزنك وتفضيلات أكلك، بطلعلك توصية غذائية أذكى. 🥗",
        )

    if any(term in normalized for term in progress_terms):
        return _lang_reply(
            language,
            "If you send your latest weight, adherence, and weekly activity, I can analyze your progress more intelligently. 📈",
            "إذا أرسلت وزنك الأخير ونسبة الالتزام ونشاطك الأسبوعي، يمكنني تحليل تقدمك بشكل أذكى. 📈",
            "إذا تبعثلي آخر وزن ونسبة التزامك ونشاطك بالأسبوع، بقدر أحلل تقدمك بشكل أذكى. 📈",
        )

    return _lang_reply(
        language,
        "Give me a bit more detail about your goal and situation, and I will make the answer smarter and more personalized. ✨",
        "أعطني تفاصيل أكثر عن هدفك ووضعك، وسأجعل الإجابة أذكى وأكثر تخصيصًا. ✨",
        "اعطيني تفاصيل أكثر عن هدفك ووضعك، وبخلي الجواب أذكى وأكثر تخصيص. ✨",
    )


def _smart_dataset_reply(reply: Optional[str], user_input: str, language: str) -> Optional[str]:
    if not reply:
        return reply

    clean_reply = _repair_mojibake(reply).strip()
    if not clean_reply:
        return clean_reply

    leading_emoji = "💪" if language == "en" else "✨"
    if not any(symbol in clean_reply for symbol in ("💪", "🥗", "📈", "✨", "🔥", "✅")):
        clean_reply = f"{leading_emoji} {clean_reply}"

    if len(clean_reply) < 360:
        clean_reply = f"{clean_reply}\n\n{_smart_dataset_followup(user_input, language)}"

    return clean_reply


def _dataset_conversation_reply(user_input: str, language: str) -> Optional[str]:
    # Priority order for conversational intents loaded from the provided dataset.
    ordered_tags: list[str] = [
        "greeting",
        "gratitude",
        "goodbye",
        "ask_exercise",
        "ask_muscle",
        "ask_home_workout",
        "ask_gym_workout",
        "ask_weight_loss",
        "ask_muscle_gain",
        "ask_general_fitness",
    ]
    known_tags = set(RESPONSE_DATASETS.intents.keys())
    for tag in ordered_tags:
        if tag not in known_tags:
            continue
        if _dataset_intent_matches(user_input, tag):
            return _smart_dataset_reply(_dataset_intent_response(tag, language, seed=user_input), user_input, language)

    # Include any additional tags from dataset except fallback/sample buckets.
    for tag in RESPONSE_DATASETS.intents.keys():
        if tag in set(ordered_tags) or tag in {"out_of_scope", "short_conversations"}:
            continue
        if _dataset_intent_matches(user_input, tag):
            return _smart_dataset_reply(_dataset_intent_response(tag, language, seed=user_input), user_input, language)
    return None


def _dataset_fallback_reply(language: str, seed: str = "") -> str:
    for tag in ("out_of_scope", "greeting", "gratitude", "goodbye"):
        response = _dataset_intent_response(tag, language, seed=seed)
        if response:
            return _smart_dataset_reply(response, seed or tag, language) or response
    return "Unable to respond."


def _strict_out_of_scope_reply(language: str) -> str:
    return _lang_reply(
        language,
        "This assistant is specialized only in fitness topics: workouts, nutrition, body composition, recovery, and progress tracking.",
        "هذا المساعد متخصص فقط في مواضيع اللياقة: التمارين، التغذية، تركيب الجسم، التعافي، ومتابعة التقدم.",
        "هذا المساعد متخصص بس بمواضيع اللياقة: التمارين، التغذية، تركيب الجسم، التعافي، ومتابعة التقدم.",
    )


def _generate_workout_plan_options_from_dataset(
    profile: dict[str, Any],
    language: str,
    count: int = 5,
) -> list[dict[str, Any]]:
    programs = RESPONSE_DATASETS.workout_programs
    if not isinstance(programs, list) or not programs:
        return []

    goal_key = _normalize_goal(profile.get("goal") or "general_fitness")
    level_key = str(profile.get("fitness_level", "beginner")).lower()
    if level_key not in {"beginner", "intermediate", "advanced"}:
        level_key = "beginner"

    scored_programs: list[tuple[int, dict[str, Any]]] = []
    for program in programs:
        if not isinstance(program, dict):
            continue
        score = 0
        program_goal = _dataset_goal_key(program.get("goal"))
        if program_goal == goal_key:
            score += 2
        program_level = _dataset_level_key(program.get("level"))
        if program_level == level_key:
            score += 1
        scored_programs.append((score, program))

    scored_programs.sort(key=lambda item: item[0], reverse=True)
    selected = [item[1] for item in scored_programs[: max(1, min(count, len(scored_programs)))]]

    rest_days = [d for d in profile.get("rest_days", []) if isinstance(d, str) and any(d == wd[0] for wd in WEEK_DAYS)]
    options: list[dict[str, Any]] = []

    day_lookup = {day_en.lower(): (day_en, day_ar) for day_en, day_ar in WEEK_DAYS}

    def _resolve_week_day(label: str) -> tuple[str, str] | None:
        raw = str(label or "").strip()
        if not raw:
            return None
        parts = [part.strip() for part in raw.split("/") if part.strip()]
        for part in parts:
            key = normalize_text(part)
            if key in day_lookup:
                return day_lookup[key]
        for day_en, day_ar in WEEK_DAYS:
            if normalize_text(day_en) in normalize_text(raw) or normalize_text(day_ar) in normalize_text(raw):
                return day_en, day_ar
        return None

    def _is_rest_type(text: str) -> bool:
        normalized = normalize_text(text or "")
        return any(token in normalized for token in ("rest", "راحه", "راحة"))

    def _map_exercises(raw_items: Any) -> list[dict[str, Any]]:
        mapped: list[dict[str, Any]] = []
        if not isinstance(raw_items, list):
            return mapped
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            name_en = str(item.get("name_en") or item.get("name") or item.get("name_ar") or "Exercise").strip() or "Exercise"
            name_ar = str(item.get("name_ar") or item.get("name_en") or name_en).strip() or name_en
            sets = str(item.get("sets") or "3")
            reps = str(item.get("reps") or "8-12")
            mapped.append(
                {
                    "name": name_en,
                    "nameAr": name_ar,
                    "sets": sets,
                    "reps": reps,
                    "rest_seconds": int(_to_float(item.get("rest_seconds")) or 60),
                    "notes": str(item.get("notes") or ""),
                }
            )
        return mapped

    for program in selected:
        program_days = [d for d in program.get("days", []) if isinstance(d, dict)]
        structured_program_days: list[dict[str, Any]] = []

        if program_days:
            program_days = sorted(program_days, key=lambda d: int(d.get("day_number", 0) or 0))
            for day in program_days:
                exercises = _map_exercises(day.get("exercises", []))
                day_name = _resolve_week_day(str(day.get("day") or ""))
                if not day_name:
                    continue
                structured_program_days.append(
                    {
                        "day": day_name[0],
                        "dayAr": day_name[1],
                        "focus": _dataset_text(day.get("focus"), language) or "Workout",
                        "is_rest": not exercises,
                        "exercises": exercises,
                    }
                )
        else:
            weekly_schedule = [d for d in program.get("weekly_schedule", []) if isinstance(d, dict)]
            workout_days = [d for d in program.get("workout_days", []) if isinstance(d, dict)]
            if not weekly_schedule or not workout_days:
                continue

            exercises_by_type: dict[str, list[dict[str, Any]]] = {}
            fallback_exercises: list[list[dict[str, Any]]] = []
            for wd in workout_days:
                exs = _map_exercises(wd.get("exercises", []))
                if not exs:
                    continue
                day_type = normalize_text(str(wd.get("day_type") or ""))
                if day_type:
                    exercises_by_type[day_type] = exs
                fallback_exercises.append(exs)

            if not fallback_exercises:
                continue

            fallback_idx = 0
            for day in weekly_schedule:
                day_name = _resolve_week_day(str(day.get("day") or ""))
                if not day_name:
                    continue
                day_type = normalize_text(str(day.get("type") or day.get("focus") or ""))
                is_rest = _is_rest_type(day_type)

                exercises: list[dict[str, Any]] = []
                if not is_rest:
                    focus_norm = normalize_text(str(day.get("focus") or ""))
                    matched = None
                    for key, value in exercises_by_type.items():
                        if key and key in focus_norm:
                            matched = value
                            break
                    if not matched and day_type in exercises_by_type:
                        matched = exercises_by_type[day_type]
                    if not matched:
                        matched = fallback_exercises[fallback_idx % len(fallback_exercises)]
                        fallback_idx += 1
                    exercises = deepcopy(matched)

                structured_program_days.append(
                    {
                        "day": day_name[0],
                        "dayAr": day_name[1],
                        "focus": _dataset_text(day.get("focus"), language) or ("Rest" if is_rest else "Workout"),
                        "is_rest": is_rest,
                        "exercises": exercises,
                    }
                )

        if not structured_program_days:
            continue

        training_day_count = sum(1 for d in structured_program_days if d.get("exercises"))
        if training_day_count == 0:
            continue

        days_per_week = int(program.get("days_per_week", training_day_count) or training_day_count or 3)
        days_per_week = max(1, min(7, days_per_week))

        user_days = profile.get("training_days_per_week")
        if not rest_days and isinstance(user_days, (int, float)) and int(user_days) > 0:
            days_per_week = max(1, min(7, int(user_days)))

        if not rest_days:
            rest_count = max(0, 7 - days_per_week)
            rest_days_local = [day for day, _ in WEEK_DAYS[-rest_count:]] if rest_count else []
        else:
            rest_days_local = rest_days[:]

        normalized_days: list[dict[str, Any]] = []
        for day_payload in structured_program_days:
            day_en = str(day_payload.get("day") or "").strip()
            if not day_en or day_en in rest_days_local or not day_payload.get("exercises"):
                continue
            normalized_days.append(
                {
                    "day": day_en,
                    "dayAr": str(day_payload.get("dayAr") or day_en),
                    "focus": day_payload.get("focus") or "Workout",
                    "exercises": day_payload.get("exercises", []),
                }
            )
            if len(normalized_days) >= days_per_week:
                break

        if not normalized_days:
            continue

        active_days = {day["day"] for day in normalized_days}

        title_en = (
            _dataset_text(program.get("name"), "en")
            or _dataset_text(program.get("program_name"), "en")
            or _dataset_text(program.get("program_name"), language)
            or "Workout Plan"
        )
        title_ar = (
            _dataset_text(program.get("name"), "ar_fusha")
            or _dataset_text(program.get("program_name"), "ar_fusha")
            or title_en
        )
        title_en = _clean_language_text(title_en, "en", "Workout Plan")
        title_ar = _clean_language_text(title_ar, "ar_fusha", "خطة تمارين")
        goal = _dataset_goal_key(program.get("goal")) or goal_key

        options.append(
            {
                "id": f"workout_{uuid.uuid4().hex[:10]}",
                "type": "workout",
                "title": title_en,
                "title_ar": title_ar,
                "goal": goal,
                "fitness_level": _dataset_level_key(program.get("level")),
                "rest_days": [day_en for day_en, _ in WEEK_DAYS if day_en not in active_days],
                "duration_days": 7,
                "days": normalized_days,
                "created_at": datetime.utcnow().isoformat(),
                "source": "week2_workout_programs_dataset",
            }
        )

    return options


def _generate_nutrition_plan_options_from_dataset(
    profile: dict[str, Any],
    language: str,
    count: int = 5,
) -> list[dict[str, Any]]:
    programs = RESPONSE_DATASETS.nutrition_programs
    if not isinstance(programs, list) or not programs:
        return []

    goal_key = _normalize_goal(profile.get("goal") or "general_fitness")
    current_weight = _to_float(profile.get("weight"))

    scored_programs: list[tuple[int, dict[str, Any]]] = []
    for program in programs:
        if not isinstance(program, dict):
            continue
        score = 0
        program_goal = _dataset_goal_key(program.get("goal"))
        if program_goal == goal_key:
            score += 2
        range_payload = program.get("weight_range_kg", {}) if isinstance(program.get("weight_range_kg"), dict) else {}
        min_w = _to_float(range_payload.get("min"))
        max_w = _to_float(range_payload.get("max"))
        if current_weight is not None and min_w is not None and max_w is not None and min_w <= current_weight <= max_w:
            score += 1
        scored_programs.append((score, program))

    scored_programs.sort(key=lambda item: item[0], reverse=True)
    selected = [item[1] for item in scored_programs[: max(1, min(count, len(scored_programs)))]]

    options: list[dict[str, Any]] = []
    for program in selected:
        restrictions = _build_food_restrictions(profile)
        calorie_range = program.get("calorie_range", {}) if isinstance(program.get("calorie_range"), dict) else {}
        cal_min = int(_to_float(calorie_range.get("min")) or 1800)
        cal_max = int(_to_float(calorie_range.get("max")) or max(cal_min, 2000))
        daily_calories = int(round((cal_min + cal_max) / 2))

        macro = program.get("macro_split", {}) if isinstance(program.get("macro_split"), dict) else {}
        protein_pct = _to_float(macro.get("protein_pct")) or 30.0
        carbs_pct = _to_float(macro.get("carbs_pct")) or 45.0
        fat_pct = _to_float(macro.get("fat_pct")) or 25.0

        sample_meals = [m for m in program.get("sample_meals", []) if isinstance(m, dict)]
        if not sample_meals:
            sample_meals = [{"meal_type": "Meal", "description": "Balanced meal"}]
        sample_meals = _filter_meals_by_restrictions(sample_meals, restrictions.get("tokens", set()))

        meals_per_day = int(profile.get("meals_per_day") or len(sample_meals) or 3)
        meals_per_day = max(2, min(6, meals_per_day))
        calories_per_meal = max(120, int(round(daily_calories / meals_per_day)))

        days_payload: list[dict[str, Any]] = []
        for day_en, day_ar in WEEK_DAYS:
            meals: list[dict[str, Any]] = []
            for i in range(meals_per_day):
                template = sample_meals[i % len(sample_meals)]
                meal_name_en = _dataset_text(template.get("meal_type"), "en") or f"Meal {i + 1}"
                meal_name_ar = _dataset_text(template.get("meal_type"), "ar_fusha") or meal_name_en
                meal_desc_en = _dataset_text(template.get("description"), "en")
                meal_desc_ar = _dataset_text(template.get("description"), "ar_fusha") or meal_desc_en
                meals.append(
                    {
                        "name": meal_name_en,
                        "nameAr": meal_name_ar,
                        "description": meal_desc_en,
                        "descriptionAr": meal_desc_ar,
                        "calories": str(calories_per_meal),
                        "time": f"meal_{i + 1}",
                    }
                )
            days_payload.append({"day": day_en, "dayAr": day_ar, "meals": meals})

        title_goal_en = _dataset_text(program.get("goal"), "en") or "Nutrition Plan"
        title_goal_ar = _dataset_text(program.get("goal"), "ar_fusha") or title_goal_en
        title_goal_en = _clean_language_text(title_goal_en, "en", "Nutrition")
        title_goal_ar = _clean_language_text(title_goal_ar, "ar_fusha", "تغذية")
        tips = program.get("tips", []) if isinstance(program.get("tips"), list) else []
        tips_text = " ".join(_dataset_text(tip, language) for tip in tips if str(tip).strip())
        if restrictions.get("labels"):
            tips_text = " ".join([tips_text, f"Avoid: {', '.join(restrictions['labels'])}."]).strip()
        est_protein = int(round((daily_calories * (protein_pct / 100.0)) / 4.0))

        options.append(
            {
                "id": f"nutrition_{uuid.uuid4().hex[:10]}",
                "type": "nutrition",
                "title": f"{title_goal_en} - Nutrition Plan",
                "title_ar": f"{title_goal_ar} - خطة تغذية",
                "goal": _dataset_goal_key(program.get("goal")) or goal_key,
                "daily_calories": daily_calories,
                "estimated_protein": est_protein,
                "meals_per_day": meals_per_day,
                "days": days_payload,
                "notes": tips_text,
                "macro_split": {"protein_pct": protein_pct, "carbs_pct": carbs_pct, "fat_pct": fat_pct},
                "forbidden_foods": list(restrictions.get("labels", [])),
                "created_at": datetime.utcnow().isoformat(),
                "source": "week2_nutrition_programs_dataset",
            }
        )

    return options


def _training_pipeline_ready() -> bool:
    global training_pipeline
    return training_pipeline is not None and getattr(training_pipeline, "trained", True)


def _normalize_training_schedule(schedule: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(schedule, dict):
        return {}
    normalized: dict[str, dict[str, Any]] = {}
    for key, value in schedule.items():
        if not isinstance(value, dict):
            continue
        key_text = str(key or "").strip()
        if not key_text:
            continue
        normalized[key_text.lower()] = value
    return normalized


def _normalize_training_exercises(exercises_raw: Any, default_sets: str, default_reps: str) -> list[dict[str, Any]]:
    if not isinstance(exercises_raw, list):
        return []
    exercises: list[dict[str, Any]] = []
    for item in exercises_raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("exercise") or item.get("name") or "Exercise").strip() or "Exercise"
        reps = str(item.get("reps") or default_reps)
        sets = str(item.get("sets") or default_sets)
        rest_seconds = int(_to_float(item.get("rest_seconds")) or 60)
        notes = str(item.get("why_recommended") or item.get("description") or "")
        exercises.append(
            {
                "name": name,
                "nameAr": name,
                "sets": sets,
                "reps": reps,
                "rest_seconds": rest_seconds,
                "notes": notes,
            }
        )
    return exercises


def _training_plan_to_workout_option(
    training_plan: dict[str, Any],
    profile: dict[str, Any],
    language: str,
) -> Optional[dict[str, Any]]:
    workout = training_plan.get("workout") if isinstance(training_plan, dict) else None
    if not isinstance(workout, dict):
        return None

    weekly_schedule = workout.get("weekly_schedule")
    schedule_map = _normalize_training_schedule(weekly_schedule)
    recommended = workout.get("recommended_exercises")
    recommended = [item for item in recommended if isinstance(item, dict)] if isinstance(recommended, list) else []

    default_sets = "3"
    default_reps = "8-12"
    cursor = 0
    plan_days: list[dict[str, Any]] = []
    requested_days = int(_to_float(profile.get("training_days_per_week")) or 0)
    target_training_days = max(1, min(7, requested_days)) if requested_days > 0 else 0
    if target_training_days == 0:
        detected_days = sum(
            1
            for english_day, _ in WEEK_DAYS
            if _normalize_training_exercises(
                (schedule_map.get(english_day.lower()) or {}).get("exercises", []),
                default_sets,
                default_reps,
            )
        )
        if detected_days > 0:
            target_training_days = max(1, min(7, detected_days))
        elif recommended:
            target_training_days = max(1, min(7, math.ceil(len(recommended) / 4)))
        else:
            target_training_days = 3

    for english_day, arabic_day in WEEK_DAYS:
        if len(plan_days) >= target_training_days:
            break

        payload = schedule_map.get(english_day.lower())
        focus = str(payload.get("focus") if payload else "") or "Workout"
        exercises = _normalize_training_exercises(payload.get("exercises") if payload else [], default_sets, default_reps)

        is_rest = "rest" in focus.lower() and not exercises
        if not exercises and not is_rest and recommended:
            chunk = recommended[cursor: cursor + 4]
            cursor += len(chunk)
            exercises = _normalize_training_exercises(chunk, default_sets, default_reps)
            if not exercises:
                exercises = _normalize_training_exercises(recommended[:4], default_sets, default_reps)

        if not exercises and "rest" in focus.lower():
            continue

        if not exercises:
            continue

        plan_days.append(
            {
                "day": english_day,
                "dayAr": arabic_day,
                "focus": focus,
                "exercises": exercises,
            }
        )

    active_days = {str(day.get("day") or "") for day in plan_days if day.get("exercises")}
    rest_days = [day_en for day_en, _ in WEEK_DAYS if day_en not in active_days]
    total_exercises = sum(len(day.get("exercises", [])) for day in plan_days)
    if total_exercises == 0:
        return None

    title_en = "Personalized Workout Plan"
    title_ar = "خطة تمارين مخصصة"
    if language == "ar_jordanian":
        title_ar = "خطة تمارين مخصصة"

    return {
        "id": f"workout_{uuid.uuid4().hex[:10]}",
        "type": "workout",
        "title": title_en,
        "title_ar": title_ar,
        "goal": profile.get("goal", "general_fitness"),
        "fitness_level": profile.get("fitness_level", "beginner"),
        "rest_days": rest_days,
        "duration_days": 7,
        "days": plan_days,
        "created_at": datetime.utcnow().isoformat(),
        "source": "multi_dataset_training",
    }


def _focus_keywords_for_goal(goal: str) -> list[str]:
    goal_norm = _normalize_goal(goal)
    if goal_norm == "muscle_gain":
        return ["chest", "back", "legs", "shoulders", "arms"]
    if goal_norm == "fat_loss":
        return ["full body", "cardio", "core", "legs"]
    if goal_norm == "endurance":
        return ["cardio", "legs", "core"]
    return ["full body", "chest", "back", "legs", "shoulders"]


def _pick_training_exercises_for_focus(
    exercise_pool: list[dict[str, Any]],
    focus_keywords: list[str],
    used_names: set[str],
    limit: int,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    lowered_focus = [normalize_text(item) for item in focus_keywords if item]

    def _matches(item: dict[str, Any]) -> bool:
        haystack = " ".join(
            [
                str(item.get("exercise") or ""),
                str(item.get("muscle_group") or item.get("muscle") or ""),
                str(item.get("type") or ""),
                str(item.get("why_recommended") or ""),
            ]
        )
        haystack_norm = normalize_text(haystack)
        return any(keyword in haystack_norm for keyword in lowered_focus)

    for item in exercise_pool:
        exercise_name = str(item.get("exercise") or item.get("name") or "Exercise").strip()
        if not exercise_name or exercise_name in used_names:
            continue
        if _matches(item):
            selected.append(item)
            used_names.add(exercise_name)
        if len(selected) >= limit:
            return selected

    for item in exercise_pool:
        exercise_name = str(item.get("exercise") or item.get("name") or "Exercise").strip()
        if not exercise_name or exercise_name in used_names:
            continue
        selected.append(item)
        used_names.add(exercise_name)
        if len(selected) >= limit:
            break

    return selected


def _build_training_variant_workout_option(
    profile: dict[str, Any],
    language: str,
    variant: dict[str, Any],
    exercise_pool: list[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    training_days = max(1, min(7, int(_to_float(profile.get("training_days_per_week")) or 4)))
    plan_days: list[dict[str, Any]] = []
    used_names: set[str] = set()
    per_day_limit = int(variant.get("exercise_count", 5))
    focus_cycle = variant.get("focus_cycle", [])

    for day_index, (english_day, arabic_day) in enumerate(WEEK_DAYS):
        if day_index >= training_days:
            break

        focus = focus_cycle[day_index % len(focus_cycle)] if focus_cycle else "full body"
        picked = _pick_training_exercises_for_focus(exercise_pool, [focus], used_names, per_day_limit)
        exercises = [
            {
                "name": str(item.get("exercise") or item.get("name") or "Exercise"),
                "nameAr": str(item.get("exercise") or item.get("name") or "Exercise"),
                "sets": str(item.get("sets") or variant.get("sets") or "3"),
                "reps": str(item.get("reps") or variant.get("reps") or "8-12"),
                "rest_seconds": int(_to_float(item.get("rest_seconds")) or variant.get("rest_seconds") or 60),
                "notes": str(item.get("why_recommended") or item.get("description") or ""),
            }
            for item in picked
        ]
        if not exercises:
            return None
        plan_days.append(
            {
                "day": english_day,
                "dayAr": arabic_day,
                "focus": str(variant.get("focus_titles", {}).get(focus, focus.title())),
                "exercises": exercises,
            }
        )

    return {
        "id": f"workout_{uuid.uuid4().hex[:10]}",
        "type": "workout",
        "title": str(variant.get("title") or "Training-Based Workout Plan"),
        "title_ar": str(variant.get("title_ar") or "خطة تمارين مبنية على التدريب"),
        "goal": _normalize_goal(profile.get("goal") or "general_fitness"),
        "fitness_level": str(profile.get("fitness_level") or "beginner"),
        "rest_days": [day_en for day_en, _ in WEEK_DAYS if day_en not in {day["day"] for day in plan_days}],
        "duration_days": 7,
        "days": plan_days,
        "created_at": datetime.utcnow().isoformat(),
        "source": "multi_dataset_training_variant",
        "training_variant": str(variant.get("key") or "training"),
    }


def _build_training_meals(
    sample_meal_plans: list[dict[str, Any]],
    daily_calories: int,
    meals_per_day: int,
) -> list[dict[str, Any]]:
    meals: list[dict[str, Any]] = []
    if sample_meal_plans:
        for idx, meal in enumerate(sample_meal_plans[:meals_per_day]):
            meal_type = str(meal.get("meal_type") or f"Meal {idx + 1}")
            options = meal.get("options") if isinstance(meal.get("options"), list) else []
            option = options[0] if options else {}
            name = str(option.get("name") or meal_type).strip() or meal_type
            macros = option.get("approximate_macros") if isinstance(option.get("approximate_macros"), dict) else {}
            protein = _to_float(macros.get("protein_g")) or 0
            carbs = _to_float(macros.get("carbs_g")) or 0
            fat = _to_float(macros.get("fat_g")) or 0
            calories = int(round((protein * 4) + (carbs * 4) + (fat * 9)))
            if calories <= 0 and daily_calories > 0:
                calories = int(round(daily_calories / max(1, meals_per_day)))

            meals.append(
                {
                    "name": name,
                    "nameAr": name,
                    "description": name,
                    "descriptionAr": name,
                    "calories": str(calories),
                    "protein": int(round(protein)),
                    "carbs": int(round(carbs)),
                    "fat": int(round(fat)),
                    "time": f"meal_{idx + 1}",
                }
            )

    if not meals and daily_calories > 0:
        calories_per_meal = int(round(daily_calories / max(1, meals_per_day)))
        for idx in range(meals_per_day):
            meals.append(
                {
                    "name": f"Meal {idx + 1}",
                    "nameAr": f"وجبة {idx + 1}",
                    "description": "Balanced meal",
                    "descriptionAr": "وجبة متوازنة",
                    "calories": str(calories_per_meal),
                    "protein": 0,
                    "carbs": 0,
                    "fat": 0,
                    "time": f"meal_{idx + 1}",
                }
            )
    return meals


def _training_plan_to_nutrition_option(
    training_plan: dict[str, Any],
    profile: dict[str, Any],
    language: str,
) -> Optional[dict[str, Any]]:
    nutrition = training_plan.get("nutrition") if isinstance(training_plan, dict) else None
    if not isinstance(nutrition, dict):
        return None

    daily_targets = nutrition.get("daily_targets") if isinstance(nutrition.get("daily_targets"), dict) else {}
    daily_calories = int(_to_float(daily_targets.get("calorie_target")) or 0)
    macro_targets = daily_targets.get("macro_targets") if isinstance(daily_targets.get("macro_targets"), dict) else {}
    meals_per_day = int(_to_float(daily_targets.get("meal_frequency")) or profile.get("meals_per_day") or 4)
    meals_per_day = max(2, min(6, meals_per_day))

    sample_meals = [m for m in nutrition.get("sample_meal_plans", []) if isinstance(m, dict)]
    meals = _build_training_meals(sample_meals, daily_calories, meals_per_day)

    if not meals:
        days, avg_daily_protein = _build_nutrition_days(profile, daily_calories or _calculate_calories(profile))
    else:
        days = [{"day": day_en, "dayAr": day_ar, "meals": meals} for day_en, day_ar in WEEK_DAYS]
        avg_daily_protein = int(round(sum(int(_to_float(m.get("protein")) or 0) for m in meals) / max(1, len(meals))))

    protein_g = _to_float(macro_targets.get("protein_g")) or avg_daily_protein
    carbs_g = _to_float(macro_targets.get("carbs_g")) or 0
    fat_g = _to_float(macro_targets.get("fat_g")) or 0
    total_macro_cal = (protein_g * 4) + (carbs_g * 4) + (fat_g * 9)
    macro_split = {}
    if total_macro_cal > 0:
        macro_split = {
            "protein_pct": round((protein_g * 4) / total_macro_cal * 100, 1),
            "carbs_pct": round((carbs_g * 4) / total_macro_cal * 100, 1),
            "fat_pct": round((fat_g * 9) / total_macro_cal * 100, 1),
        }

    restrictions = _build_food_restrictions(profile)

    title_en = "Personalized Nutrition Plan"
    title_ar = "خطة تغذية مخصصة"
    if language == "ar_jordanian":
        title_ar = "خطة أكل مخصصة"

    return {
        "id": f"nutrition_{uuid.uuid4().hex[:10]}",
        "type": "nutrition",
        "title": title_en,
        "title_ar": title_ar,
        "goal": profile.get("goal", "general_fitness"),
        "daily_calories": daily_calories or _calculate_calories(profile),
        "estimated_protein": int(round(protein_g or avg_daily_protein or 0)),
        "meals_per_day": meals_per_day,
        "days": days,
        "notes": "",
        "macro_split": macro_split,
        "forbidden_foods": list(restrictions.get("labels", [])),
        "created_at": datetime.utcnow().isoformat(),
        "source": "multi_dataset_training",
    }


def _build_training_variant_nutrition_option(
    profile: dict[str, Any],
    variant: dict[str, Any],
    food_pool: list[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    base_calories = _calculate_calories(profile)
    daily_calories = max(1200, int(round(base_calories + int(variant.get("calorie_shift", 0)))))
    meals_per_day = max(3, min(5, int(_to_float(profile.get("meals_per_day")) or variant.get("meals_per_day") or 4)))
    restrictions = _build_food_restrictions(profile)
    forbidden_labels = {normalize_text(label) for label in restrictions.get("labels", [])}

    filtered_foods: list[dict[str, Any]] = []
    for food in food_pool:
        name = str(food.get("name") or "").strip()
        if not name:
            continue
        if forbidden_labels and any(label in normalize_text(name) for label in forbidden_labels):
            continue
        filtered_foods.append(food)

    if not filtered_foods:
        filtered_foods = food_pool[:]
    if not filtered_foods:
        return None

    meal_templates = filtered_foods[: max(meals_per_day, 8)]
    calories_per_meal = max(150, int(round(daily_calories / max(1, meals_per_day))))
    days: list[dict[str, Any]] = []
    total_protein = 0

    for day_en, day_ar in WEEK_DAYS:
        meals: list[dict[str, Any]] = []
        for meal_index in range(meals_per_day):
            template = meal_templates[(meal_index + len(days)) % len(meal_templates)]
            protein = int(round((_to_float(template.get("protein_g")) or 20) * float(variant.get("protein_mul", 1.0))))
            carbs = int(round((_to_float(template.get("carbs_g")) or 25) * float(variant.get("carb_mul", 1.0))))
            fat = int(round((_to_float(template.get("fat_g")) or 8) * float(variant.get("fat_mul", 1.0))))
            total_protein += protein
            name = str(template.get("name") or f"Meal {meal_index + 1}")
            category = str(template.get("category") or "balanced")
            meals.append(
                {
                    "name": name,
                    "nameAr": name,
                    "description": f"{category.title()} meal with dataset-driven macros",
                    "descriptionAr": f"وجبة {category} مبنية على بيانات التدريب",
                    "calories": str(calories_per_meal),
                    "protein": protein,
                    "carbs": carbs,
                    "fat": fat,
                    "time": f"meal_{meal_index + 1}",
                }
            )
        days.append({"day": day_en, "dayAr": day_ar, "meals": meals})

    estimated_protein = int(round(total_protein / max(1, len(WEEK_DAYS))))
    macro_calories = max(1, (estimated_protein * 4) + (meals_per_day * 25 * 4) + (meals_per_day * 8 * 9))
    macro_split = {
        "protein_pct": round((estimated_protein * 4) / macro_calories * 100, 1),
        "carbs_pct": round(((meals_per_day * 25) * 4) / macro_calories * 100, 1),
        "fat_pct": round(((meals_per_day * 8) * 9) / macro_calories * 100, 1),
    }

    return {
        "id": f"nutrition_{uuid.uuid4().hex[:10]}",
        "type": "nutrition",
        "title": str(variant.get("title") or "Training-Based Nutrition Plan"),
        "title_ar": str(variant.get("title_ar") or "خطة تغذية مبنية على التدريب"),
        "goal": _normalize_goal(profile.get("goal") or "general_fitness"),
        "daily_calories": daily_calories,
        "estimated_protein": estimated_protein,
        "meals_per_day": meals_per_day,
        "days": days,
        "notes": str(variant.get("notes") or ""),
        "macro_split": macro_split,
        "forbidden_foods": list(restrictions.get("labels", [])),
        "created_at": datetime.utcnow().isoformat(),
        "source": "multi_dataset_training_variant",
        "training_variant": str(variant.get("key") or "training"),
    }


def _generate_workout_plan_options_from_training(
    profile: dict[str, Any],
    language: str,
    count: int = 5,
) -> list[dict[str, Any]]:
    if not _training_pipeline_ready():
        return []
    try:
        plan = training_pipeline.get_personalized_plan(profile)
        exercise_pool = training_pipeline.get_personalized_exercises(profile, limit=36)
    except Exception as exc:
        logger.warning("Training pipeline plan generation failed: %s", exc)
        return []

    options: list[dict[str, Any]] = []
    base_option = _training_plan_to_workout_option(plan, profile, language)
    if base_option:
        options.append(base_option)

    goal_focus = _focus_keywords_for_goal(str(profile.get("goal") or "general_fitness"))
    variants = [
        {
            "key": "strength_data",
            "title": "Data-Driven Strength Split",
            "title_ar": "خطة قوة مبنية على البيانات",
            "focus_cycle": goal_focus,
            "exercise_count": 5,
            "sets": "4",
            "reps": "6-10",
            "rest_seconds": 90,
            "focus_titles": {"full body": "Full Body", "cardio": "Conditioning", "core": "Core"},
        },
        {
            "key": "volume_data",
            "title": "Multi-Dataset Hypertrophy Plan",
            "title_ar": "خطة تضخيم متعددة البيانات",
            "focus_cycle": goal_focus[::-1] or goal_focus,
            "exercise_count": 6,
            "sets": "4",
            "reps": "8-15",
            "rest_seconds": 75,
            "focus_titles": {"full body": "Volume Session", "cardio": "Metabolic Session", "core": "Core Builder"},
        },
        {
            "key": "efficient_data",
            "title": "Efficient Equipment-Based Plan",
            "title_ar": "خطة فعالة حسب المعدات",
            "focus_cycle": ["full body", *goal_focus[:3]],
            "exercise_count": 4,
            "sets": "3",
            "reps": "10-12",
            "rest_seconds": 60,
            "focus_titles": {"full body": "Equipment-Efficient", "cardio": "Conditioning", "core": "Core"},
        },
    ]

    for variant in variants:
        option = _build_training_variant_workout_option(profile, language, variant, exercise_pool)
        if option:
            options.append(option)
        if len(options) >= count:
            break

    deduped: list[dict[str, Any]] = []
    seen_titles: set[str] = set()
    for option in options:
        title = str(option.get("title") or option.get("id") or "")
        if title in seen_titles:
            continue
        seen_titles.add(title)
        deduped.append(option)
    return deduped[:count]


def _generate_nutrition_plan_options_from_training(
    profile: dict[str, Any],
    language: str,
    count: int = 5,
) -> list[dict[str, Any]]:
    if not _training_pipeline_ready():
        return []
    try:
        plan = training_pipeline.get_personalized_plan(profile)
        food_pool = training_pipeline.get_personalized_foods(profile, limit=40)
    except Exception as exc:
        logger.warning("Training pipeline plan generation failed: %s", exc)
        return []

    options: list[dict[str, Any]] = []
    base_option = _training_plan_to_nutrition_option(plan, profile, language)
    if base_option:
        options.append(base_option)

    variants = [
        {
            "key": "balanced_data",
            "title": "Data-Driven Balanced Nutrition",
            "title_ar": "خطة تغذية متوازنة مبنية على البيانات",
            "calorie_shift": 0,
            "protein_mul": 1.0,
            "carb_mul": 1.0,
            "fat_mul": 1.0,
            "meals_per_day": 4,
            "notes": "Balanced meals built from the trained food datasets.",
        },
        {
            "key": "high_protein_data",
            "title": "High-Protein Recovery Plan",
            "title_ar": "خطة تعافي عالية البروتين",
            "calorie_shift": 80,
            "protein_mul": 1.25,
            "carb_mul": 0.95,
            "fat_mul": 0.9,
            "meals_per_day": 4,
            "notes": "Higher protein distribution for recovery and muscle retention.",
        },
        {
            "key": "lean_cut_data",
            "title": "Lean Cutting Nutrition Plan",
            "title_ar": "خطة تغذية للتنشيف الذكي",
            "calorie_shift": -180,
            "protein_mul": 1.2,
            "carb_mul": 0.8,
            "fat_mul": 0.85,
            "meals_per_day": 5,
            "notes": "Leaner calorie profile while preserving protein intake.",
        },
    ]

    for variant in variants:
        option = _build_training_variant_nutrition_option(profile, variant, food_pool)
        if option:
            options.append(option)
        if len(options) >= count:
            break

    deduped: list[dict[str, Any]] = []
    seen_titles: set[str] = set()
    for option in options:
        title = str(option.get("title") or option.get("id") or "")
        if title in seen_titles:
            continue
        seen_titles.add(title)
        deduped.append(option)
    return deduped[:count]


def _build_profile(req: ChatRequest, user_state: dict[str, Any]) -> dict[str, Any]:
    profile = dict(req.user_profile or {})
    explicit_keys = set(profile.keys())

    def _is_missing(value: Any) -> bool:
        if value is None:
            return True
        if isinstance(value, str) and not value.strip():
            return True
        if isinstance(value, list) and not value:
            return True
        return False

    tracked_keys = (
        "goal",
        "fitness_level",
        "training_days_per_week",
        "activity_level",
        "available_equipment",
        "equipment",
        "injuries",
        "dietary_preferences",
        "rest_days",
        "age",
        "weight",
        "height",
        "gender",
        "meals_per_day",
        "allergies",
        "chronic_diseases",
        "target_calories",
        "preferred_language",
    )

    if "chronicConditions" in profile and "chronic_diseases" not in profile:
        profile["chronic_diseases"] = profile.get("chronicConditions")
        explicit_keys.add("chronic_diseases")
    if "fitnessLevel" in profile and "fitness_level" not in profile:
        profile["fitness_level"] = profile.get("fitnessLevel")
        explicit_keys.add("fitness_level")
    if "trainingDaysPerWeek" in profile and "training_days_per_week" not in profile:
        profile["training_days_per_week"] = profile.get("trainingDaysPerWeek")
        explicit_keys.add("training_days_per_week")
    if "activityLevel" in profile and "activity_level" not in profile:
        profile["activity_level"] = profile.get("activityLevel")
        explicit_keys.add("activity_level")
    if "equipment" in profile and "available_equipment" not in profile:
        profile["available_equipment"] = profile.get("equipment")
        explicit_keys.add("available_equipment")
    if "dietaryPreferences" in profile and "dietary_preferences" not in profile:
        profile["dietary_preferences"] = profile.get("dietaryPreferences")
        explicit_keys.add("dietary_preferences")

    if req.user_id:
        if "id" not in profile:
            profile["id"] = req.user_id
        if "user_id" not in profile:
            profile["user_id"] = req.user_id

    for key in tracked_keys:
        if key in explicit_keys:
            continue
        if not _is_missing(profile.get(key)):
            continue
        state_value = user_state.get(key)
        if _is_missing(state_value):
            continue
        profile[key] = state_value

    if "allergies" in profile:
        profile["allergies"] = _parse_list_field(profile.get("allergies"))
    if "chronic_diseases" in profile:
        profile["chronic_diseases"] = _parse_list_field(profile.get("chronic_diseases"))
    if "dietary_preferences" in profile:
        profile["dietary_preferences"] = _parse_list_field(profile.get("dietary_preferences"))

    if "training_days_per_week" in profile:
        try:
            profile["training_days_per_week"] = int(float(profile.get("training_days_per_week") or 0))
        except (TypeError, ValueError):
            pass
    if "activity_level" in profile and isinstance(profile.get("activity_level"), str):
        profile["activity_level"] = profile.get("activity_level").strip().lower()

    profile["goal"] = _normalize_goal(profile.get("goal"))

    return profile

def _lang_reply(language: str, en: str, ar_fusha: str, ar_jordanian: Optional[str] = None) -> str:
    if language == "en":
        return _repair_mojibake(en)
    if language == "ar_fusha":
        return _repair_mojibake(ar_fusha)
    return _repair_mojibake(ar_jordanian or ar_fusha)


def _motivation_line(language: str, seed: str = "") -> str:
    lines = MOTIVATION_LINES.get(language) or MOTIVATION_LINES["en"]
    if not lines:
        return ""
    idx = abs(hash(seed or "default")) % len(lines)
    return lines[idx]


def _persist_profile_context(profile: dict[str, Any], state: dict[str, Any], explicit_keys: Optional[set[str]] = None) -> None:
    tracked_keys = (
        "name",
        "goal",
        "fitness_level",
        "training_days_per_week",
        "activity_level",
        "available_equipment",
        "equipment",
        "injuries",
        "dietary_preferences",
        "rest_days",
        "age",
        "weight",
        "height",
        "gender",
        "meals_per_day",
        "allergies",
        "chronic_diseases",
        "target_calories",
        "preferred_language",
    )
    explicit_keys = explicit_keys or set()
    for key in tracked_keys:
        value = profile.get(key)
        if key in explicit_keys:
            if value is None or (isinstance(value, str) and not value.strip()) or (isinstance(value, list) and not value):
                state.pop(key, None)
                continue
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        if isinstance(value, list) and not value:
            continue
        state[key] = value

def _profile_display_name(profile: dict[str, Any]) -> str:
    for key in ("name", "full_name", "first_name"):
        value = profile.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _profile_goal_label(goal: str, language: str) -> str:
    goal_key = str(goal or "").strip().lower()
    if goal_key == "muscle_gain":
        return _lang_reply(language, "muscle gain", "زيادة الكتلة العضلية", "زيادة العضل")
    if goal_key == "fat_loss":
        return _lang_reply(language, "fat loss", "خسارة الدهون", "تنزيل الدهون")
    if goal_key == "general_fitness":
        return _lang_reply(language, "general fitness", "اللياقة العامة", "لياقة عامة")
    return str(goal or "")


def _profile_query_reply(
    user_input: str,
    language: str,
    profile: dict[str, Any],
    tracking_summary: Optional[dict[str, Any]],
) -> Optional[str]:
    name = _profile_display_name(profile)
    goal_label = _profile_goal_label(str(profile.get("goal", "")), language)
    age = profile.get("age")
    height = profile.get("height")
    weight = profile.get("weight")
    normalized = normalize_text(user_input)

    if _contains_phrase(normalized, WHO_AM_I_KEYWORDS):
        if name:
            return _lang_reply(
                language,
                f"You are {name}. I have your profile and can coach you using your goal, body stats, and progress.",
                f"أنت {name}. لدي ملفك الشخصي، وأستطيع تدريبك وفق هدفك وقياساتك وتقدمك.",
                f"إنت {name}. عندي ملفك، وبقدر أدربك حسب هدفك وقياساتك وتقدمك.",
            )
        return _lang_reply(
            language,
            "I do not have your name yet. Add it in your profile page and I will personalize every response.",
            "لا أملك اسمك بعد. أضفه في صفحة الملف الشخصي وسأخصص كل الردود لك.",
            "لسا ما عندي اسمك. حطه بصفحة البروفايل وبخصصلك كل الردود.",
        )

    if _contains_phrase(normalized, ASK_MY_AGE_KEYWORDS):
        if age is not None:
            return _lang_reply(
                language,
                f"Your age is {age}.",
                f"عمرك هو {age}.",
                f"عمرك {age}.",
            )
        return _lang_reply(
            language,
            "I do not have your age yet. Update it in your profile and I will use it in your plans.",
            "لا أملك عمرك بعد. حدّثه في الملف الشخصي وسأستخدمه في خططك.",
            "لسا ما عندي عمرك. حدّثه بالبروفايل وبستخدمه بخططك.",
        )

    if _contains_phrase(normalized, ASK_MY_HEIGHT_KEYWORDS):
        if height is not None:
            return _lang_reply(
                language,
                f"Your height is {height} cm.",
                f"طولك هو {height} سم.",
                f"طولك {height} سم.",
            )
        return _lang_reply(
            language,
            "I do not have your height yet. Add it in your profile to make training and calories more accurate.",
            "لا أملك طولك بعد. أضفه في ملفك لتحسين دقة التدريب والسعرات.",
            "لسا ما عندي طولك. أضفه بالبروفايل عشان أدق بالتمارين والسعرات.",
        )

    if _contains_phrase(normalized, ASK_MY_WEIGHT_KEYWORDS):
        if weight is not None:
            return _lang_reply(
                language,
                f"Your weight is {weight} kg.",
                f"وزنك هو {weight} كغ.",
                f"وزنك {weight} كيلو.",
            )
        return _lang_reply(
            language,
            "I do not have your weight yet. Add it in your profile and I will tune your plan calories better.",
            "لا أملك وزنك بعد. أضفه في ملفك وسأضبط سعرات الخطة بدقة أعلى.",
            "لسا ما عندي وزنك. أضفه بالبروفايل وبضبطلك السعرات أدق.",
        )

    if _contains_phrase(normalized, ASK_MY_GOAL_KEYWORDS):
        if goal_label:
            return _lang_reply(
                language,
                f"Your current goal is {goal_label}.",
                f"هدفك الحالي هو: {goal_label}.",
                f"هدفك الحالي: {goal_label}.",
            )
        return _lang_reply(
            language,
            "Your goal is not set yet. Tell me if you want muscle gain, fat loss, or general fitness.",
            "هدفك غير محدد بعد. أخبرني: زيادة عضل أم خسارة دهون أم لياقة عامة.",
            "لسا هدفك مش محدد. احكيلي: زيادة عضل ولا تنزيل دهون ولا لياقة عامة.",
        )

    if _contains_any(normalized, {"my progress summary", "ملخص تقدمي", "ملخص التقدم"}):
        return _tracking_reply(language, tracking_summary)

    return None


def _social_reply(user_input: str, language: str, profile: dict[str, Any]) -> Optional[str]:
    normalized = normalize_text(user_input)
    name = _profile_display_name(profile)
    name_suffix = f" {name}" if name else ""

    if _dataset_intent_matches(user_input, "gratitude") or _contains_any(normalized, THANKS_KEYWORDS):
        dataset_reply = _dataset_intent_response("gratitude", language, seed=name or user_input)
        if dataset_reply:
            return dataset_reply
        return _lang_reply(
            language,
            f"Anytime{name_suffix}. Keep going and send me your next update.",
            f"على الرحب والسعة{name_suffix}. استمر وأرسل لي تحديثك التالي.",
            f"على راسي{name_suffix}. كمل وابعثلي تحديثك الجاي.",
        )

    if _dataset_intent_matches(user_input, "goodbye"):
        dataset_reply = _dataset_intent_response("goodbye", language, seed=name or user_input)
        if dataset_reply:
            return dataset_reply

    return None


def _plan_status_reply(language: str, plan_snapshot: Optional[dict[str, Any]]) -> str:
    if not plan_snapshot:
        return _lang_reply(
            language,
            "I do not have your latest plan status yet. Open your Schedule page and I can sync after your next message.",
            "Ù„Ø§ Ø£Ù…Ù„Ùƒ Ø¢Ø®Ø± Ø­Ø§Ù„Ø© Ù„Ø®Ø·Ø·Ùƒ Ø¨Ø¹Ø¯. Ø§ÙØªØ­ ØµÙØ­Ø© Ø§Ù„Ø¬Ø¯ÙˆÙ„ ÙˆØ³Ø£Ø²Ø§Ù…Ù†Ù‡Ø§ Ø¨Ø¹Ø¯ Ø±Ø³Ø§Ù„ØªÙƒ Ø§Ù„ØªØ§Ù„ÙŠØ©.",
            "Ù„Ø³Ø§ Ù…Ø§ Ø¹Ù†Ø¯ÙŠ Ø¢Ø®Ø± Ø­Ø§Ù„Ø© Ù„Ù„Ø®Ø·Ø·. Ø§ÙØªØ­ ØµÙØ­Ø© Ø§Ù„Ø¬Ø¯ÙˆÙ„ ÙˆØ¨Ø±Ø¬Ø¹ Ø¨Ø²Ø§Ù…Ù†Ù‡Ø§ Ù…Ø¹Ùƒ Ø¨Ø¹Ø¯ Ø±Ø³Ø§Ù„ØªÙƒ Ø§Ù„Ø¬Ø§ÙŠØ©.",
        )

    workout_count = int(plan_snapshot.get("active_workout_plans", 0) or 0)
    nutrition_count = int(plan_snapshot.get("active_nutrition_plans", 0) or 0)
    return _lang_reply(
        language,
        f"You currently have {workout_count} active workout plan(s) and {nutrition_count} active nutrition plan(s).",
        f"Ù„Ø¯ÙŠÙƒ Ø­Ø§Ù„ÙŠÙ‹Ø§ {workout_count} Ø®Ø·Ø© ØªÙ…Ø§Ø±ÙŠÙ† Ù†Ø´Ø·Ø© Ùˆ{nutrition_count} Ø®Ø·Ø© ØªØºØ°ÙŠØ© Ù†Ø´Ø·Ø©.",
        f"Ø­Ø§Ù„ÙŠÙ‹Ø§ Ø¹Ù†Ø¯Ùƒ {workout_count} Ø®Ø·Ø© ØªÙ…Ø§Ø±ÙŠÙ† ÙØ¹Ø§Ù„Ø© Ùˆ{nutrition_count} Ø®Ø·Ø© ØªØºØ°ÙŠØ© ÙØ¹Ø§Ù„Ø©.",
    )


def _progress_diagnostic_reply(language: str, profile: dict[str, Any], tracking_summary: Optional[dict[str, Any]]) -> str:
    adherence = 0.0
    if tracking_summary:
        try:
            adherence = float(tracking_summary.get("adherence_score", 0) or 0)
        except (TypeError, ValueError):
            adherence = 0.0
    adherence_pct = int(round(adherence * 100))
    weight = profile.get("weight")
    try:
        hydration_liters = round(max(1.8, float(weight) * 0.033), 1) if weight is not None else 2.5
    except (TypeError, ValueError):
        hydration_liters = 2.5

    return _lang_reply(
        language,
        (
            f"Plateaus are common. Your adherence is about {adherence_pct}%. "
            "Let us find the cause step by step:\n"
            "1. How many hours do you sleep on average?\n"
            f"2. Do you drink around {hydration_liters}L water daily?\n"
            "3. Are you completing your planned sets/reps, or stopping early?\n"
            "4. Are you consistently hitting your calories and protein targets?\n"
            "Reply with these 4 points and I will give you a precise fix."
        ),
        (
            f"ثبات النتائج أمر طبيعي أحيانًا. نسبة التزامك الحالية تقريبًا {adherence_pct}%.\n"
            "لنحدد السبب خطوة بخطوة:\n"
            "1. كم ساعة تنام يوميًا بالمتوسط؟\n"
            f"2. هل تشرب تقريبًا {hydration_liters} لتر ماء يوميًا؟\n"
            "3. هل تكمل المجموعات والتكرارات كاملة أم تتوقف مبكرًا؟\n"
            "4. هل تلتزم يوميًا بسعراتك وبروتينك المستهدف؟\n"
            "أجبني على هذه النقاط الأربع وسأعطيك الحل الأدق."
        ),
        (
            f"ثبات الجسم بصير، والتزامك الحالي تقريبًا {adherence_pct}%.\n"
            "خلينا نعرف السبب شوي شوي:\n"
            "1. كم ساعة نومك بالمتوسط؟\n"
            f"2. بتشرب تقريبًا {hydration_liters} لتر مي باليوم؟\n"
            "3. بتكمل كل المجموعات والتكرارات ولا بتوقف بكير؟\n"
            "4. ملتزم بسعراتك وبروتينك يوميًا؟\n"
            "جاوبني بهدول الأربع نقاط وبعطيك الحل الأدق."
        ),
    )


def _exercise_diagnostic_reply(language: str) -> str:
    return _lang_reply(
        language,
        (
            "Understood. To fix your exercise form safely, answer these points:\n"
            "1. Which exercise exactly?\n"
            "2. Where do you feel pain/tension?\n"
            "3. At which rep does form break down?\n"
            "4. What load are you using now?\n"
            "5. Did this start after an injury or sudden volume increase?\n"
            "After your answers, I will give exact technique corrections and load changes."
        ),
        (
            "ممتاز، لنصحح أداء التمرين بشكل آمن أجبني على التالي:\n"
            "1. ما اسم التمرين بالضبط؟\n"
            "2. أين تشعر بالألم أو الشد؟\n"
            "3. في أي تكرار يبدأ الأداء بالانهيار؟\n"
            "4. ما الوزن الذي تستخدمه الآن؟\n"
            "5. هل بدأ هذا بعد إصابة أو زيادة مفاجئة في الحمل التدريبي؟\n"
            "بعد إجاباتك أعطيك تصحيحًا دقيقًا للحركة وتعديلًا مناسبًا للأوزان."
        ),
        (
            "تمام، عشان نصلح الأداء بدون إصابة جاوبني:\n"
            "1. شو اسم التمرين بالزبط؟\n"
            "2. وين بتحس بالألم أو الشد؟\n"
            "3. بأي تكرار بتخرب الحركة؟\n"
            "4. كم الوزن اللي بتلعب فيه هسا؟\n"
            "5. المشكلة بلشت بعد إصابة أو زيادة حمل مفاجئة؟\n"
            "بعدها بعطيك تصحيح دقيق للحركة وتعديل الوزن."
        ),
    )


def _normalize_recent_messages(raw_messages: Optional[list[dict[str, Any]]]) -> list[dict[str, str]]:
    if not raw_messages:
        return []
    cleaned: list[dict[str, str]] = []
    for item in raw_messages:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "")).strip().lower()
        if role not in {"user", "assistant"}:
            continue
        content = _repair_mojibake(str(item.get("content", "")).strip())
        if not content:
            continue
        cleaned.append({"role": role, "content": content})
    return cleaned[-12:]


def _update_plan_snapshot_state(state: dict[str, Any], new_snapshot: Optional[dict[str, Any]]) -> None:
    if not new_snapshot:
        return

    previous = state.get("plan_snapshot")
    state["plan_snapshot"] = new_snapshot

    if not isinstance(previous, dict):
        return

    previous_total = int(previous.get("active_workout_plans", 0) or 0) + int(previous.get("active_nutrition_plans", 0) or 0)
    new_total = int(new_snapshot.get("active_workout_plans", 0) or 0) + int(new_snapshot.get("active_nutrition_plans", 0) or 0)

    if new_total < previous_total:
        state["plans_recently_deleted"] = True
    elif new_total >= previous_total:
        state["plans_recently_deleted"] = False


def _missing_fields_for_plan(plan_type: str, profile: dict[str, Any]) -> list[str]:
    if plan_type == "workout":
        required = ["goal", "fitness_level", "rest_days"]
    else:
        required = ["goal", "age", "weight", "height", "gender", "meals_per_day", "chronic_diseases", "allergies"]

    missing: list[str] = []
    for key in required:
        value = profile.get(key)
        if value is None:
            missing.append(key)
            continue
        if isinstance(value, str) and not value.strip():
            missing.append(key)
            continue
        if key == "rest_days" and (not isinstance(value, list) or len(value) == 0):
            missing.append(key)
    return missing


def _missing_field_question(field_name: str, language: str) -> str:
    questions = {
        "en": {
            "goal": "What is your main goal now: muscle gain, fat loss, or general fitness?",
            "fitness_level": "What is your current fitness level: beginner, intermediate, or advanced?",
            "rest_days": "Which days do you want as rest days this week?",
            "age": "What is your age?",
            "weight": "What is your current weight in kg?",
            "height": "What is your height in cm?",
            "gender": "What is your gender (male/female)?",
            "meals_per_day": "How many meals do you want per day (3, 4, or 5)?",
            "chronic_diseases": "Do you have any chronic diseases I should consider? If none, reply with 'none'.",
            "allergies": "Do you have any food allergies? If none, reply with 'none'.",
        },
        "ar_fusha": {
            "goal": "ما هو هدفك الرئيسي الآن: بناء عضل أم خسارة دهون أم لياقة عامة؟",
            "fitness_level": "ما هو مستواك الرياضي الحالي: مبتدئ أم متوسط أم متقدم؟",
            "rest_days": "ما هي أيام الراحة التي تريدها هذا الأسبوع؟",
            "age": "كم عمرك؟",
            "weight": "ما وزنك الحالي بالكيلوغرام؟",
            "height": "ما طولك بالسنتيمتر؟",
            "gender": "ما جنسك (ذكر/أنثى)؟",
            "meals_per_day": "كم وجبة تريد يوميًا (3 أو 4 أو 5)؟",
            "chronic_diseases": "هل لديك أمراض مزمنة يجب أخذها بالحسبان؟ إذا لا يوجد اكتب: لا يوجد",
            "allergies": "هل لديك أي حساسية غذائية؟ إذا لا يوجد اكتب: لا يوجد",
        },
        "ar_jordanian": {
            "goal": "شو هدفك هلأ: زيادة عضل، نزول دهون، ولا لياقة عامة؟",
            "fitness_level": "شو مستواك الرياضي: مبتدئ، متوسط، ولا متقدم؟",
            "rest_days": "أي أيام بدك تكون أيام راحة بالأسبوع؟",
            "age": "كم عمرك؟",
            "weight": "شو وزنك الحالي بالكيلو؟",
            "height": "كم طولك بالسنتي؟",
            "gender": "شو جنسك (ذكر/أنثى)؟",
            "meals_per_day": "كم وجبة بدك باليوم (3 أو 4 أو 5)؟",
            "chronic_diseases": "في أمراض مزمنة لازم آخدها بالحسبان؟ إذا ما في اكتب: ما في",
            "allergies": "عندك حساسية أكل؟ إذا ما في اكتب: ما في",
        },
    }
    return questions.get(language, questions["en"]).get(field_name, questions["en"]["goal"])


def _parse_rest_days(text: str) -> list[str]:
    lowered = text.lower()
    english_map = {
        "saturday": "Saturday",
        "sunday": "Sunday",
        "monday": "Monday",
        "tuesday": "Tuesday",
        "wednesday": "Wednesday",
        "thursday": "Thursday",
        "friday": "Friday",
    }
    arabic_map = {
        "السبت": "Saturday",
        "الأحد": "Sunday",
        "الاحد": "Sunday",
        "الاثنين": "Monday",
        "الثلاثاء": "Tuesday",
        "الأربعاء": "Wednesday",
        "الاربعاء": "Wednesday",
        "الخميس": "Thursday",
        "الجمعة": "Friday",
    }

    results: list[str] = []
    for name, normalized in english_map.items():
        if name in lowered:
            results.append(normalized)
    for name, normalized in arabic_map.items():
        if name in text:
            results.append(normalized)

    deduped: list[str] = []
    for day_name in results:
        if day_name not in deduped:
            deduped.append(day_name)
    return deduped


def _apply_profile_answer(field_name: str, answer: str, user_state: dict[str, Any]) -> bool:
    text = answer.strip()
    lowered = text.lower()

    if field_name == "goal":
        normalized_goal = _normalize_goal(text)
        if not normalized_goal:
            return False
        user_state["goal"] = normalized_goal
        return True
    if field_name == "fitness_level":
        if "begin" in lowered or "مبت" in lowered:
            user_state["fitness_level"] = "beginner"
            return True
        if "inter" in lowered or "متوس" in lowered:
            user_state["fitness_level"] = "intermediate"
            return True
        if "adv" in lowered or "متقد" in lowered:
            user_state["fitness_level"] = "advanced"
            return True
        return False
    if field_name in {"age", "weight", "height"}:
        match = re.search(r"\d+(\.\d+)?", lowered)
        if not match:
            return False
        numeric_value = float(match.group())
        user_state[field_name] = int(numeric_value) if field_name == "age" else numeric_value
        return True
    if field_name == "gender":
        if any(token in lowered for token in ("male", "ذكر", "man")):
            user_state["gender"] = "male"
            return True
        if any(token in lowered for token in ("female", "أنث", "انث", "woman")):
            user_state["gender"] = "female"
            return True
        return False
    if field_name == "meals_per_day":
        match = re.search(r"\d+", lowered)
        if not match:
            return False
        meals_count = int(match.group())
        if meals_count < 3 or meals_count > 6:
            return False
        user_state["meals_per_day"] = meals_count
        return True
    if field_name == "rest_days":
        rest_days = _parse_rest_days(text)
        if not rest_days:
            return False
        user_state["rest_days"] = rest_days
        return True
    if field_name == "chronic_diseases":
        if any(token in lowered for token in ("none", "no", "لا يوجد", "ما في")):
            user_state["chronic_diseases"] = []
            return True
        user_state["chronic_diseases"] = _parse_list_field(text)
        return True
    if field_name == "allergies":
        if any(token in lowered for token in ("none", "no", "لا يوجد", "ما في")):
            user_state["allergies"] = []
            return True
        user_state["allergies"] = _parse_list_field(text)
        return True
    return False


def _select_exercises(focus: str, difficulty: str, max_items: int = 5) -> list[dict[str, Any]]:
    exercises: list[dict[str, Any]] = []
    allowed_difficulties = {
        "beginner": {"Beginner"},
        "intermediate": {"Beginner", "Intermediate"},
        "advanced": {"Beginner", "Intermediate", "Advanced"},
    }
    difficulty_filter = allowed_difficulties.get(difficulty, {"Beginner", "Intermediate"})

    for item in AI_ENGINE.exercises:
        muscle = str(item.get("muscle", "")).lower()
        level = str(item.get("difficulty", "Beginner"))
        if focus in muscle and level in difficulty_filter:
            exercises.append(item)
        if len(exercises) >= max_items:
            break

    if exercises:
        return exercises
    return AI_ENGINE.exercises[:max_items]


def _generate_workout_plan(profile: dict[str, Any], language: str) -> dict[str, Any]:
    goal = profile.get("goal") or "general_fitness"
    difficulty = str(profile.get("fitness_level", "beginner")).lower()
    requested_days = int(_to_float(profile.get("training_days_per_week")) or 0)
    training_days = max(1, min(7, requested_days)) if requested_days > 0 else 6
    rest_days = profile.get("rest_days") or []
    rest_days = [day for day in rest_days if isinstance(day, str)]
    if not rest_days:
        rest_days = [day for day, _ in WEEK_DAYS[training_days:]]

    if goal == "muscle_gain":
        weekly_focus = ["chest", "back", "legs", "shoulders", "core"]
        default_sets, default_reps = 4, "8-12"
    elif goal == "fat_loss":
        weekly_focus = ["legs", "core", "back", "chest", "shoulders"]
        default_sets, default_reps = 3, "12-15"
    else:
        weekly_focus = ["core", "legs", "back", "chest", "shoulders"]
        default_sets, default_reps = 3, "10-12"

    plan_days: list[dict[str, Any]] = []
    focus_index = 0
    for english_day, arabic_day in WEEK_DAYS:
        if english_day in rest_days:
            continue

        focus = weekly_focus[focus_index % len(weekly_focus)]
        focus_index += 1
        exercise_items = _select_exercises(focus, difficulty, max_items=5)

        exercises = []
        for item in exercise_items:
            exercise_name = str(item.get("exercise", "Exercise"))
            exercises.append(
                {
                    "name": exercise_name,
                    "nameAr": exercise_name,
                    "sets": str(default_sets),
                    "reps": default_reps,
                    "rest_seconds": 90 if goal != "fat_loss" else 60,
                    "notes": str(item.get("description", "")),
                }
            )

        plan_days.append(
            {
                "day": english_day,
                "dayAr": arabic_day,
                "focus": focus,
                "exercises": exercises,
            }
        )

    title = "AI Workout Plan"
    title_ar = "خطة تمارين ذكية"
    if language == "ar_jordanian":
        title_ar = "خطة تمارين"

    return {
        "id": f"workout_{uuid.uuid4().hex[:10]}",
        "type": "workout",
        "title": title,
        "title_ar": title_ar,
        "goal": goal,
        "fitness_level": difficulty,
        "rest_days": rest_days,
        "duration_days": 7,
        "days": plan_days,
        "created_at": datetime.utcnow().isoformat(),
    }


def _calculate_calories(profile: dict[str, Any]) -> int:
    if profile.get("target_calories"):
        return int(profile["target_calories"])

    weight = float(profile.get("weight", 70))
    height = float(profile.get("height", 170))
    age = float(profile.get("age", 25))
    gender = str(profile.get("gender", "male")).lower()
    goal = str(profile.get("goal") or "general_fitness")
    fitness_level = str(profile.get("fitness_level", "beginner")).lower()
    activity_level = str(profile.get("activity_level") or "").lower()

    bmr = 10 * weight + 6.25 * height - 5 * age + (5 if gender == "male" else -161)
    activity_factor = {"low": 1.30, "moderate": 1.50, "high": 1.70}.get(activity_level)
    if activity_factor is None:
        activity_factor = {"beginner": 1.40, "intermediate": 1.55, "advanced": 1.70}.get(fitness_level, 1.45)
    maintenance = bmr * activity_factor

    if goal == "muscle_gain":
        maintenance += 300
    elif goal == "fat_loss":
        maintenance -= 400

    return max(1200, int(round(maintenance)))


@lru_cache(maxsize=1)
def _allergy_categories_from_dataset() -> set[str]:
    candidates = [
        BACKEND_DIR / "datasets" / "food_allergy_dataset.csv",
        Path(r"D:\chatbot coach\Dataset\New folder\food_allergy_dataset.csv"),
    ]
    for path in candidates:
        if not path.exists():
            continue
        try:
            import csv

            with path.open("r", encoding="utf-8", errors="ignore", newline="") as f:
                reader = csv.DictReader(f)
                values = {str(row.get("Food_Type", "")).strip().lower() for row in reader if row.get("Food_Type")}
                return {v for v in values if v}
        except Exception:
            continue
    return set()


ALLERGY_CATEGORY_TOKENS: dict[str, set[str]] = {
    "gluten": {
        "gluten",
        "wheat",
        "bread",
        "flour",
        "pasta",
        "oats",
        "barley",
        "rye",
        "قمح",
        "خبز",
        "طحين",
        "معكرونة",
        "شوفان",
        "شعير",
    },
    "dairy": {
        "milk",
        "cheese",
        "yogurt",
        "butter",
        "cream",
        "milk",
        "حليب",
        "جبن",
        "لبنة",
        "زبادي",
        "زبدة",
        "قشطة",
    },
    "eggs": {
        "egg",
        "eggs",
        "omelette",
        "بيض",
        "بياض",
        "صفار",
        "اومليت",
    },
    "nuts": {
        "nuts",
        "peanut",
        "almond",
        "walnut",
        "cashew",
        "hazelnut",
        "pistachio",
        "مكسرات",
        "فول سوداني",
        "لوز",
        "جوز",
        "كاجو",
        "بندق",
        "فستق",
    },
    "seafood": {
        "seafood",
        "fish",
        "salmon",
        "tuna",
        "shrimp",
        "crab",
        "lobster",
        "سمك",
        "سلمون",
        "تونة",
        "جمبري",
        "روبيان",
        "سرطان",
        "لوبستر",
    },
}

CHRONIC_RESTRICTION_TOKENS: dict[str, set[str]] = {
    "diabetes": {
        "sugar",
        "sweet",
        "sweets",
        "soda",
        "juice",
        "white bread",
        "white rice",
        "dessert",
        "cake",
        "chocolate",
        "honey",
        "jam",
        "سكر",
        "حلويات",
        "عصير",
        "مشروبات غازية",
        "خبز ابيض",
        "رز ابيض",
        "كيك",
        "شوكولاتة",
        "عسل",
        "مربى",
    },
    "hypertension": {
        "salt",
        "salty",
        "sodium",
        "pickle",
        "processed",
        "sausage",
        "chips",
        "soy sauce",
        "ملح",
        "مخللات",
        "لحوم مصنعة",
        "نقانق",
        "شيبس",
        "صلصة الصويا",
    },
    "heart": {
        "fried",
        "butter",
        "ghee",
        "cream",
        "fatty",
        "red meat",
        "bacon",
        "sausages",
        "cheese",
        "مقلي",
        "زبدة",
        "سمنة",
        "دهون",
        "لحمة دهنية",
        "نقانق",
        "جبن",
    },
    "cholesterol": {
        "fried",
        "butter",
        "ghee",
        "cream",
        "fatty",
        "red meat",
        "bacon",
        "sausages",
        "cheese",
        "مقلي",
        "زبدة",
        "سمنة",
        "دهون",
        "لحمة دهنية",
        "نقانق",
        "جبن",
    },
}

DIETARY_PREFERENCE_MATCH: dict[str, set[str]] = {
    "vegan": {"vegan", "plant based", "plant-based", "نباتي صرف", "نباتي صارم", "نباتي بالكامل"},
    "vegetarian": {"vegetarian", "vegetrian", "veg", "نباتي", "نباتية"},
    "halal": {"halal", "حلال"},
    "keto": {"keto", "ketogenic", "كيتو"},
    "gluten_free": {
        "gluten free",
        "gluten-free",
        "خالي من الجلوتين",
        "خالي من الغلوتين",
        "بدون جلوتين",
        "بدون غلوتين",
    },
    "lactose_free": {"lactose free", "lactose-free", "dairy free", "dairy-free", "خالي من اللاكتوز", "بدون لاكتوز"},
}

MEAT_TOKENS = {
    "meat",
    "beef",
    "chicken",
    "turkey",
    "lamb",
    "goat",
    "pork",
    "bacon",
    "ham",
    "sausage",
    "fish",
    "salmon",
    "tuna",
    "shrimp",
    "crab",
    "lobster",
    "لحم",
    "دجاج",
    "ديك رومي",
    "غنم",
    "ماعز",
    "خنزير",
    "لحم خنزير",
    "نقانق",
    "سمك",
    "سلمون",
    "تونة",
    "جمبري",
    "روبيان",
    "سرطان",
}

PORK_ALCOHOL_TOKENS = {
    "pork",
    "bacon",
    "ham",
    "wine",
    "beer",
    "whiskey",
    "vodka",
    "rum",
    "gin",
    "liquor",
    "alcohol",
    "خنزير",
    "لحم خنزير",
    "بيكون",
    "نبيذ",
    "بيرة",
    "ويسكي",
    "فودكا",
    "رم",
    "كحول",
    "مشروب كحولي",
}

KETO_AVOID_TOKENS = (
    CHRONIC_RESTRICTION_TOKENS["diabetes"]
    | {
        "bread",
        "rice",
        "pasta",
        "potato",
        "oats",
        "corn",
        "flour",
        "cereal",
        "juice",
        "cake",
        "dessert",
        "خبز",
        "رز",
        "معكرونة",
        "بطاطا",
        "شوفان",
        "ذرة",
        "طحين",
        "حبوب",
        "عصير",
        "كيك",
        "حلويات",
    }
)

DIETARY_PREFERENCE_TOKENS: dict[str, set[str]] = {
    "vegan": MEAT_TOKENS | ALLERGY_CATEGORY_TOKENS["dairy"] | ALLERGY_CATEGORY_TOKENS["eggs"] | {"honey", "عسل"},
    "vegetarian": MEAT_TOKENS,
    "halal": PORK_ALCOHOL_TOKENS,
    "keto": KETO_AVOID_TOKENS,
    "gluten_free": ALLERGY_CATEGORY_TOKENS["gluten"],
    "lactose_free": ALLERGY_CATEGORY_TOKENS["dairy"],
}


def _text_contains_any(text: str, tokens: set[str]) -> bool:
    normalized = normalize_text(text or "")
    if not normalized or not tokens:
        return False
    return any(token and normalize_text(token) in normalized for token in tokens)


def _build_food_restrictions(profile: dict[str, Any]) -> dict[str, Any]:
    allergies = _parse_list_field(profile.get("allergies"))
    chronic = _parse_list_field(profile.get("chronic_diseases"))
    dietary_preferences = _parse_list_field(profile.get("dietary_preferences"))

    tokens: set[str] = set()
    labels: list[str] = []

    known_categories = _allergy_categories_from_dataset()

    for allergy in allergies:
        norm = normalize_text(allergy)
        matched = False
        for key, key_tokens in ALLERGY_CATEGORY_TOKENS.items():
            if key in norm or any(normalize_text(tok) in norm for tok in key_tokens):
                tokens |= key_tokens
                if key not in labels:
                    labels.append(key)
                matched = True
        if not matched and norm:
            tokens.add(allergy)
            if allergy not in labels:
                labels.append(allergy)

    # If dataset categories exist, include them in labels when user mentions them.
    for category in known_categories:
        if category and any(category in normalize_text(a) for a in allergies):
            if category not in labels:
                labels.append(category)

    for disease in chronic:
        norm = normalize_text(disease)
        if "diab" in norm or "سكر" in norm:
            tokens |= CHRONIC_RESTRICTION_TOKENS["diabetes"]
            labels.append("diabetes")
            continue
        if "ضغط" in norm or "hypertension" in norm:
            tokens |= CHRONIC_RESTRICTION_TOKENS["hypertension"]
            labels.append("hypertension")
            continue
        if "قلب" in norm or "heart" in norm:
            tokens |= CHRONIC_RESTRICTION_TOKENS["heart"]
            labels.append("heart")
            continue
        if "كوليسترول" in norm or "cholesterol" in norm:
            tokens |= CHRONIC_RESTRICTION_TOKENS["cholesterol"]
            labels.append("cholesterol")

    for pref in dietary_preferences:
        norm = normalize_text(pref)
        matched = False
        for key, aliases in DIETARY_PREFERENCE_MATCH.items():
            if any(alias and alias in norm for alias in aliases):
                tokens |= DIETARY_PREFERENCE_TOKENS.get(key, set())
                if key not in labels:
                    labels.append(key)
                matched = True
                break
        if not matched and norm:
            if pref not in labels:
                labels.append(pref)

    return {
        "tokens": {t for t in tokens if t},
        "labels": labels,
        "allergies": allergies,
        "chronic_diseases": chronic,
        "dietary_preferences": dietary_preferences,
    }


def _filter_meals_by_restrictions(meals: list[dict[str, Any]], restriction_tokens: set[str]) -> list[dict[str, Any]]:
    if not meals or not restriction_tokens:
        return meals
    filtered: list[dict[str, Any]] = []
    for meal in meals:
        haystack = " ".join(
            [
                str(meal.get("meal_type", "")),
                str(meal.get("description", "")),
                str(meal.get("name", "")),
                str(meal.get("descriptionAr", "")),
                str(meal.get("nameAr", "")),
            ]
        )
        if _text_contains_any(haystack, restriction_tokens):
            continue
        filtered.append(meal)
    return filtered if filtered else meals


def _safe_meal_templates(allergies: list[str], restriction_tokens: set[str] | None = None) -> list[dict[str, Any]]:
    templates = [
        {"name": "Greek Yogurt + Oats + Berries", "calories": 420, "protein": 28, "carbs": 48, "fat": 12, "ingredients": ["yogurt", "oats", "berries"]},
        {"name": "Egg Omelette + Whole Grain Bread", "calories": 460, "protein": 32, "carbs": 34, "fat": 20, "ingredients": ["egg", "bread", "vegetables"]},
        {"name": "Chicken Rice Bowl", "calories": 620, "protein": 45, "carbs": 70, "fat": 16, "ingredients": ["chicken", "rice", "vegetables"]},
        {"name": "Salmon + Sweet Potato", "calories": 650, "protein": 42, "carbs": 58, "fat": 24, "ingredients": ["salmon", "sweet potato", "vegetables"]},
        {"name": "Tuna Wrap", "calories": 480, "protein": 35, "carbs": 44, "fat": 14, "ingredients": ["tuna", "whole wheat tortilla", "vegetables"]},
        {"name": "Lean Beef + Quinoa", "calories": 640, "protein": 43, "carbs": 55, "fat": 20, "ingredients": ["beef", "quinoa", "salad"]},
        {"name": "Protein Shake + Banana", "calories": 320, "protein": 30, "carbs": 34, "fat": 6, "ingredients": ["whey", "banana", "milk"]},
        {"name": "Cottage Cheese + Fruit", "calories": 300, "protein": 24, "carbs": 28, "fat": 8, "ingredients": ["cottage cheese", "fruit"]},
    ]

    allergy_tokens = {a.lower() for a in allergies}
    if restriction_tokens:
        allergy_tokens |= {t.lower() for t in restriction_tokens}
    safe: list[dict[str, Any]] = []
    for meal in templates:
        ingredients_text = " ".join(meal["ingredients"]).lower()
        if any(token and token in ingredients_text for token in allergy_tokens):
            continue
        safe.append(meal)
    return safe if safe else templates


def _build_nutrition_days(profile: dict[str, Any], calories_target: int) -> tuple[list[dict[str, Any]], int]:
    meals_per_day = int(profile.get("meals_per_day", 4))
    meals_per_day = max(3, min(6, meals_per_day))
    allergies = _parse_list_field(profile.get("allergies"))
    chronic = [d.lower() for d in _parse_list_field(profile.get("chronic_diseases"))]
    restrictions = _build_food_restrictions(profile)

    meal_templates = _safe_meal_templates(allergies, restrictions.get("tokens", set()))
    meal_templates.sort(key=lambda m: m["calories"])

    if any("diab" in x or "سكر" in x for x in chronic):
        for meal in meal_templates:
            meal["carbs"] = int(round(meal["carbs"] * 0.85))

    meal_ratio = [0.25, 0.10, 0.30, 0.10, 0.20, 0.05]
    day_plans: list[dict[str, Any]] = []
    total_protein = 0

    for day_index, (english_day, arabic_day) in enumerate(WEEK_DAYS):
        meals_for_day: list[dict[str, Any]] = []
        for i in range(meals_per_day):
            template = meal_templates[(i + day_index) % len(meal_templates)]
            target = int(calories_target * meal_ratio[i])
            scale = max(0.6, min(1.6, target / template["calories"]))

            calories = int(round(template["calories"] * scale))
            protein = int(round(template["protein"] * scale))
            carbs = int(round(template["carbs"] * scale))
            fat = int(round(template["fat"] * scale))

            total_protein += protein
            meals_for_day.append(
                {
                    "name": template["name"],
                    "nameAr": template["name"],
                    "description": f"Ingredients: {', '.join(template['ingredients'])}",
                    "descriptionAr": f"المكونات: {', '.join(template['ingredients'])}",
                    "calories": str(calories),
                    "protein": protein,
                    "carbs": carbs,
                    "fat": fat,
                    "time": f"meal_{i + 1}",
                }
            )

        day_plans.append({"day": english_day, "dayAr": arabic_day, "meals": meals_for_day})

    avg_daily_protein = int(round(total_protein / 7))
    return day_plans, avg_daily_protein


def _generate_nutrition_plan(profile: dict[str, Any], language: str) -> dict[str, Any]:
    calories_target = _calculate_calories(profile)
    days, avg_daily_protein = _build_nutrition_days(profile, calories_target)
    chronic = _parse_list_field(profile.get("chronic_diseases"))
    allergies = _parse_list_field(profile.get("allergies"))
    restrictions = _build_food_restrictions(profile)
    kb_query_parts = [
        "nutrition meal plan",
        str(profile.get("goal", "") or ""),
        " ".join(chronic),
        " ".join(allergies),
    ]
    kb_query = " ".join(part for part in kb_query_parts if part).strip()
    kb_hits = NUTRITION_KB.search(kb_query, top_k=2, max_chars=220) if NUTRITION_KB.ready and kb_query else []
    reference_notes = [hit["text"] for hit in kb_hits]

    notes = []
    if chronic:
        notes.append(f"Adjusted for chronic conditions: {', '.join(chronic)}.")
    if allergies:
        notes.append(f"Avoided allergens: {', '.join(allergies)}.")
    if restrictions.get("labels"):
        notes.append(f"Restricted foods based on profile: {', '.join(restrictions['labels'])}.")

    title = "AI Nutrition Plan"
    title_ar = "خطة تغذية ذكية"
    if language == "ar_jordanian":
        title_ar = "خطة أكل"

    return {
        "id": f"nutrition_{uuid.uuid4().hex[:10]}",
        "type": "nutrition",
        "title": title,
        "title_ar": title_ar,
        "goal": profile.get("goal", "general_fitness"),
        "daily_calories": calories_target,
        "estimated_protein": avg_daily_protein,
        "meals_per_day": int(profile.get("meals_per_day", 4)),
        "days": days,
        "notes": " ".join(notes).strip(),
        "forbidden_foods": list(restrictions.get("labels", [])),
        "reference_notes": reference_notes,
        "created_at": datetime.utcnow().isoformat(),
    }


def _format_plan_preview(plan_type: str, plan: dict[str, Any], language: str) -> str:
    plan = _sanitize_plan_payload(plan_type, plan, language)
    if plan_type == "workout":
        workout_days = [d for d in plan.get("days", []) if d.get("exercises")]
        workout_day_names = [str(d.get("day") or "") for d in workout_days if d.get("day")]
        rest_days = list(plan.get("rest_days") or [d.get("day") for d in plan.get("days", []) if not d.get("exercises")])
        sample = workout_days[0]["exercises"][:3] if workout_days else []
        sample_text = "\n".join([f"- {_clean_plan_label(x.get('name'), 'Exercise')} ({x['sets']} x {x['reps']})" for x in sample])
        training_days_count = len(workout_days)
        workout_days_line = " · ".join(workout_day_names) if workout_day_names else "Not specified"

        if language == "en":
            return (
                f"## {plan.get('title') or 'Workout Plan'}\n"
                f"- Training days: {workout_days_line}\n"
                f"- Rest days: {', '.join(rest_days) if rest_days else 'None'}\n"
                f"- Weekly frequency: {training_days_count} days\n\n"
                f"Sample session:\n{sample_text}\n\n"
                "Do you want to approve this plan and add it to your schedule page?"
            )
        if language == "ar_fusha":
            return (
                f"## {plan.get('title_ar') or plan.get('title') or 'خطة تمارين'}\n"
                f"- أيام التمرين: {workout_days_line}\n"
                f"- أيام الراحة: {', '.join(rest_days) if rest_days else 'لا يوجد'}\n"
                f"- عدد أيام التدريب: {training_days_count}\n\n"
                f"مثال ليوم تدريبي:\n{sample_text}\n\n"
                "هل تريد اعتماد هذه الخطة وإضافتها إلى صفحة الجدول؟"
            )
        return (
            f"## {plan.get('title_ar') or plan.get('title') or 'خطة تمارين'}\n"
            f"- أيام التمرين: {workout_days_line}\n"
            f"- أيام الراحة: {', '.join(rest_days) if rest_days else 'ما في'}\n"
            f"- عدد أيام التدريب: {training_days_count}\n\n"
            f"مثال يوم تدريبي:\n{sample_text}\n\n"
            "بدك تعتمد الخطة وتنزل مباشرة بصفحة الجدول؟"
        )

    calories = plan.get("daily_calories", 0)
    meals_count = plan.get("meals_per_day", 4)
    sample_meals = plan.get("days", [{}])[0].get("meals", [])[:3]
    sample_text = "\n".join([f"- {_clean_plan_label(m.get('name'), 'Meal')} ({m['calories']} kcal)" for m in sample_meals])

    if language == "en":
        return (
            f"## {plan.get('title') or 'Nutrition Plan'}\n"
            f"- Daily calories: {calories} kcal\n"
            f"- Meals per day: {meals_count}\n"
            f"- Estimated protein: {plan.get('estimated_protein', 0)} g\n\n"
            f"Sample meals:\n{sample_text}\n\n"
            "Do you want to approve this plan and add it to your schedule page?"
        )
    if language == "ar_fusha":
        return (
            f"## {plan.get('title_ar') or plan.get('title') or 'خطة تغذية'}\n"
            f"- السعرات اليومية: {calories}\n"
            f"- عدد الوجبات: {meals_count}\n"
            f"- البروتين التقديري: {plan.get('estimated_protein', 0)} غ\n\n"
            f"عينة من الوجبات:\n{sample_text}\n\n"
            "هل تريد اعتماد هذه الخطة وإضافتها إلى صفحة الجدول؟"
        )
    return (
        f"## {plan.get('title_ar') or plan.get('title') or 'خطة تغذية'}\n"
        f"- السعرات اليومية: {calories}\n"
        f"- عدد الوجبات: {meals_count}\n"
        f"- البروتين التقديري: {plan.get('estimated_protein', 0)} غ\n\n"
        f"عينة وجبات:\n{sample_text}\n\n"
        "بدك تعتمدها وتنزل على صفحة الجدول؟"
    )


def _detect_generated_plan_type(reply_text: str) -> Optional[str]:
    normalized = normalize_text(reply_text)
    if not normalized:
        return None

    day_mentions = sum(
        1
        for day_en, day_ar in WEEK_DAYS
        if _contains_any(normalized, {normalize_text(day_en), normalize_text(day_ar)})
    )
    numbered_sections = len(re.findall(r"\bday\s*[1-7]\b|\bmeal\s*[1-7]\b|\bاليوم\s*[1-7]\b|\bوجبة\s*[1-7]\b", normalized))
    if day_mentions < 2 and numbered_sections < 2:
        return None

    workout_markers = WORKOUT_REQUEST_TERMS | {"sets", "reps", "rest", "warmup", "إحماء", "عدة", "تكرار"}
    nutrition_markers = NUTRITION_REQUEST_TERMS | {"kcal", "macro", "macros", "سناك", "فطور", "غداء", "عشاء"}
    workout_score = int(_contains_any(normalized, workout_markers)) + int(_contains_any(normalized, WORKOUT_PLAN_TERMS))
    nutrition_score = int(_contains_any(normalized, nutrition_markers)) + int(_contains_any(normalized, NUTRITION_PLAN_TERMS))

    if workout_score == 0 and nutrition_score == 0:
        return None
    return "workout" if workout_score >= nutrition_score else "nutrition"


def _build_pending_plan_response(
    plan_type: str,
    profile: dict[str, Any],
    tracking_summary: Optional[dict[str, Any]],
    language: str,
    user_id: str,
    conversation_id: str,
    state: dict[str, Any],
    memory: MemorySystem,
) -> ChatResponse:
    inferred_goal, inferred_confidence, inferred_by_ml = _infer_goal_for_plan(profile, tracking_summary)
    plan_profile = dict(profile)
    plan_profile["goal"] = inferred_goal

    if plan_type == "nutrition":
        plan = _generate_nutrition_plan(plan_profile, language)
    else:
        plan = _generate_workout_plan(plan_profile, language)

    plan = _sanitize_plan_payload(plan_type, plan, language)
    plan_id = str(plan.get("id") or f"{plan_type}_{uuid.uuid4().hex[:10]}")
    plan["id"] = plan_id
    PENDING_PLANS[plan_id] = {
        "user_id": user_id,
        "conversation_id": conversation_id,
        "plan_type": plan_type,
        "plan": plan,
        "approved": False,
        "created_at": datetime.utcnow().isoformat(),
    }
    state["last_pending_plan_id"] = plan_id
    state["pending_plan_options"] = None
    state["pending_plan_type"] = None

    reply = _format_plan_preview(plan_type, plan, language)
    if inferred_by_ml:
        goal_label = _profile_goal_label(inferred_goal, language)
        confidence_text = (
            f" ({_format_number((inferred_confidence or 0.0) * 100, 1)}%)"
            if inferred_confidence is not None
            else ""
        )
        intro = _lang_reply(
            language,
            f"I inferred your goal automatically from your training data: {goal_label}{confidence_text}.",
            f"تم استنتاج هدفك تلقائيًا من بيانات التدريب: {goal_label}{confidence_text}.",
            f"استنتجت هدفك تلقائيًا من بيانات التدريب: {goal_label}{confidence_text}.",
        )
        reply = f"{intro}\n\n{reply}"

    memory.add_assistant_message(reply)
    return ChatResponse(
        reply=reply,
        conversation_id=conversation_id,
        language=language,
        action="ask_plan",
        data={"plan_id": plan_id, "plan_type": plan_type, "plan": plan},
    )


def _looks_like_bad_arabic(text: str) -> bool:
    return bool(text) and any(marker in text for marker in ("Ø", "Ù", "Ã", "Ð"))


def _clean_plan_label(text: Any, fallback: str) -> str:
    cleaned = _repair_mojibake(str(text or "")).replace("_", " ").strip()
    if not cleaned or _looks_like_bad_arabic(cleaned):
        return fallback
    return cleaned


def _sanitize_plan_payload(plan_type: str, plan: dict[str, Any], language: Optional[str] = None) -> dict[str, Any]:
    cleaned = repair_mojibake_deep(deepcopy(plan)) if isinstance(plan, dict) else {}
    if not cleaned:
        return {}

    default_title_en = "Nutrition Plan" if plan_type == "nutrition" else "Workout Plan"
    default_title_ar = "خطة تغذية" if plan_type == "nutrition" else "خطة تمارين"
    cleaned["title"] = _clean_plan_label(cleaned.get("title"), default_title_en)
    cleaned["title_ar"] = _clean_plan_label(cleaned.get("title_ar"), default_title_ar)

    for day in cleaned.get("days", []):
        if not isinstance(day, dict):
            continue
        day["day"] = _clean_plan_label(day.get("day"), str(day.get("day") or ""))
        day["dayAr"] = _clean_plan_label(day.get("dayAr"), str(day.get("dayAr") or day.get("day") or ""))
        day["focus"] = _clean_plan_label(day.get("focus"), str(day.get("focus") or ""))
        for exercise in day.get("exercises", []):
            if not isinstance(exercise, dict):
                continue
            fallback_name = _clean_plan_label(exercise.get("name"), "Exercise")
            exercise["name"] = fallback_name
            exercise["nameAr"] = _clean_plan_label(exercise.get("nameAr"), fallback_name)
            if exercise.get("notes"):
                exercise["notes"] = _repair_mojibake(str(exercise.get("notes") or "")).strip()
        for meal in day.get("meals", []):
            if not isinstance(meal, dict):
                continue
            fallback_name = _clean_plan_label(meal.get("name"), "Meal")
            meal["name"] = fallback_name
            meal["nameAr"] = _clean_plan_label(meal.get("nameAr"), fallback_name)
            if meal.get("description"):
                meal["description"] = _repair_mojibake(str(meal.get("description") or "")).strip()
            if meal.get("descriptionAr"):
                meal["descriptionAr"] = _clean_plan_label(meal.get("descriptionAr"), str(meal.get("description") or ""))

    if language == "ar_fusha" and plan_type == "nutrition" and cleaned.get("title") == default_title_en:
        cleaned["title"] = default_title_ar
    return cleaned


def _generate_workout_plan_options(profile: dict[str, Any], language: str, count: int = 5) -> list[dict[str, Any]]:
    target_count = max(PLAN_OPTION_PAGE_SIZE, min(PLAN_OPTION_POOL_TARGET, int(count or PLAN_OPTION_PAGE_SIZE)))
    base_options: list[dict[str, Any]] = []

    training_options = _generate_workout_plan_options_from_training(profile, language, min(24, target_count))
    if training_options:
        base_options.extend(training_options)

    remaining = max(0, min(120, target_count) - len(base_options))
    if remaining:
        dataset_options = _generate_workout_plan_options_from_dataset(profile, language, remaining)
        base_options.extend(dataset_options)

    if not base_options:
        base_options = [_generate_workout_plan(profile, language)]

    expanded = _expand_workout_option_pool(base_options, profile, language, target_count)
    return [_sanitize_plan_payload("workout", option, language) for option in expanded]


def _generate_nutrition_plan_options(profile: dict[str, Any], language: str, count: int = 5) -> list[dict[str, Any]]:
    target_count = max(PLAN_OPTION_PAGE_SIZE, min(PLAN_OPTION_POOL_TARGET, int(count or PLAN_OPTION_PAGE_SIZE)))
    base_options: list[dict[str, Any]] = []

    training_options = _generate_nutrition_plan_options_from_training(profile, language, min(24, target_count))
    if training_options:
        base_options.extend(training_options)

    remaining = max(0, min(160, target_count) - len(base_options))
    if remaining:
        dataset_options = _generate_nutrition_plan_options_from_dataset(profile, language, remaining)
        base_options.extend(dataset_options)

    if not base_options:
        base_options = [_generate_nutrition_plan(profile, language)]

    expanded = _expand_nutrition_option_pool(base_options, profile, language, target_count)
    return [_sanitize_plan_payload("nutrition", option, language) for option in expanded]


def _preferred_training_days(profile: dict[str, Any], fallback: int = 3) -> int:
    raw = profile.get("training_days_per_week") or profile.get("trainingDaysPerWeek") or fallback
    try:
        days = int(float(raw))
    except (TypeError, ValueError):
        days = fallback
    return max(1, min(7, days))


def _rotated_training_day_names(days_per_week: int, rotation: int) -> list[str]:
    base_patterns = {
        1: [0],
        2: [0, 3],
        3: [0, 2, 4],
        4: [0, 1, 3, 5],
        5: [0, 1, 2, 4, 6],
        6: [0, 1, 2, 3, 4, 6],
        7: [0, 1, 2, 3, 4, 5, 6],
    }
    days_per_week = max(1, min(7, days_per_week))
    rotated = sorted({(index + rotation) % 7 for index in base_patterns[days_per_week]})
    if len(rotated) < days_per_week:
        for index in range(7):
            if index not in rotated:
                rotated.append(index)
            if len(rotated) >= days_per_week:
                break
        rotated.sort()
    return [WEEK_DAYS[index][0] for index in rotated[:days_per_week]]


def _workout_option_signature(plan: dict[str, Any]) -> str:
    days = []
    for day in plan.get("days", []):
        days.append(
            {
                "day": day.get("day"),
                "focus": day.get("focus"),
                "exercises": [
                    {
                        "name": ex.get("name"),
                        "sets": ex.get("sets"),
                        "reps": ex.get("reps"),
                    }
                    for ex in day.get("exercises", [])
                ],
            }
        )
    return json.dumps(days, ensure_ascii=False, sort_keys=True)


def _nutrition_option_signature(plan: dict[str, Any]) -> str:
    days = []
    for day in plan.get("days", []):
        days.append(
            {
                "day": day.get("day"),
                "meals": [
                    {
                        "name": meal.get("name"),
                        "calories": meal.get("calories"),
                    }
                    for meal in day.get("meals", [])
                ],
            }
        )
    summary = {
        "daily_calories": plan.get("daily_calories"),
        "estimated_protein": plan.get("estimated_protein"),
        "days": days,
    }
    return json.dumps(summary, ensure_ascii=False, sort_keys=True)


def _build_workout_exercise_pool(profile: dict[str, Any], limit: int = 120) -> list[dict[str, Any]]:
    pool: list[dict[str, Any]] = []
    seen_names: set[str] = set()

    def _push(items: list[dict[str, Any]]) -> None:
        for item in items:
            name = str(item.get("exercise") or item.get("name") or "").strip()
            if not name or name in seen_names:
                continue
            seen_names.add(name)
            pool.append(item)
            if len(pool) >= limit:
                break

    if _training_pipeline_ready():
        try:
            _push(training_pipeline.get_personalized_exercises(profile, limit=limit))
        except Exception as exc:
            logger.warning("Workout exercise pool retrieval failed: %s", exc)

    difficulty = str(profile.get("fitness_level") or profile.get("fitnessLevel") or "").lower() or None
    for focus in _focus_keywords_for_goal(str(profile.get("goal") or "general_fitness")) + ["full body", "cardio", "core"]:
        if len(pool) >= limit:
            break
        _push(CATEGORY_DATA.search_exercises(focus, difficulty=difficulty, limit=max(8, limit // 6)))

    if len(pool) < limit:
        _push(AI_ENGINE.exercises[:limit])

    return pool[:limit]


def _build_mutated_workout_exercises(
    base_day: dict[str, Any],
    exercise_pool: list[dict[str, Any]],
    focus: str,
    scheme: dict[str, Any],
    variant_index: int,
) -> list[dict[str, Any]]:
    base_exercises = [item for item in base_day.get("exercises", []) if isinstance(item, dict)]
    target_count = max(3, min(6, int(scheme.get("exercise_count", len(base_exercises) or 4))))
    focus_norm = normalize_text(focus)

    matching_pool = [
        item
        for item in exercise_pool
        if focus_norm in normalize_text(
            " ".join(
                [
                    str(item.get("exercise") or item.get("name") or ""),
                    str(item.get("muscle") or item.get("type") or ""),
                ]
            )
        )
    ]
    candidates = matching_pool or exercise_pool
    if not candidates and not base_exercises:
        return []

    offset = variant_index % max(1, len(candidates) or 1)
    mutated: list[dict[str, Any]] = []
    used_names: set[str] = set()
    for index in range(target_count):
        use_candidate = bool(candidates) and (not base_exercises or ((index + variant_index) % 2 == 1 or index >= len(base_exercises)))
        if use_candidate:
            candidate = candidates[(offset + index) % len(candidates)]
            name = str(candidate.get("exercise") or candidate.get("name") or "Exercise")
            notes = str(candidate.get("description") or candidate.get("why_recommended") or "")
            exercise = {
                "name": name,
                "nameAr": name,
                "sets": str(scheme.get("sets", "4")),
                "reps": str(scheme.get("reps", "8-12")),
                "rest_seconds": int(scheme.get("rest_seconds", 75)),
                "notes": notes,
            }
        else:
            source = base_exercises[(index + variant_index) % len(base_exercises)]
            exercise = {
                **source,
                "sets": str(scheme.get("sets", source.get("sets") or "4")),
                "reps": str(scheme.get("reps", source.get("reps") or "8-12")),
                "rest_seconds": int(scheme.get("rest_seconds", source.get("rest_seconds") or 75)),
            }

        exercise_name = str(exercise.get("name") or "Exercise").strip()
        if not exercise_name or exercise_name in used_names:
            continue
        used_names.add(exercise_name)
        mutated.append(exercise)

    if mutated:
        return mutated
    return base_exercises[:target_count]


def _expand_workout_option_pool(
    base_options: list[dict[str, Any]],
    profile: dict[str, Any],
    language: str,
    target_count: int,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    seen_signatures: set[str] = set()

    for option in base_options:
        signature = _workout_option_signature(option)
        if signature in seen_signatures:
            continue
        seen_signatures.add(signature)
        results.append(option)
        if len(results) >= target_count:
            return results[:target_count]

    training_days = _preferred_training_days(
        profile,
        fallback=max((len([d for d in option.get("days", []) if d.get("exercises")]) for option in base_options), default=3),
    )
    exercise_pool = _build_workout_exercise_pool(profile)
    schemes = [
        {"key": "strength", "label_en": "Strength Focus", "label_ar": "تركيز قوة", "sets": "5", "reps": "5-8", "rest_seconds": 120, "exercise_count": 4},
        {"key": "hypertrophy", "label_en": "Hypertrophy", "label_ar": "تضخيم", "sets": "4", "reps": "8-12", "rest_seconds": 75, "exercise_count": 5},
        {"key": "conditioning", "label_en": "Conditioning", "label_ar": "تكييف", "sets": "3", "reps": "12-18", "rest_seconds": 45, "exercise_count": 5},
        {"key": "volume", "label_en": "Volume Build", "label_ar": "بناء حجم", "sets": "5", "reps": "10-15", "rest_seconds": 60, "exercise_count": 6},
        {"key": "power", "label_en": "Power Emphasis", "label_ar": "تركيز قدرة", "sets": "4", "reps": "4-6", "rest_seconds": 135, "exercise_count": 4},
        {"key": "lean", "label_en": "Lean Burn", "label_ar": "حرق رشيق", "sets": "3", "reps": "15-20", "rest_seconds": 40, "exercise_count": 5},
        {"key": "balanced", "label_en": "Balanced Week", "label_ar": "أسبوع متوازن", "sets": "4", "reps": "8-10", "rest_seconds": 80, "exercise_count": 5},
        {"key": "efficient", "label_en": "Efficient Split", "label_ar": "تقسيم فعال", "sets": "3", "reps": "10-12", "rest_seconds": 60, "exercise_count": 4},
        {"key": "athletic", "label_en": "Athletic Performance", "label_ar": "أداء رياضي", "sets": "4", "reps": "6-10", "rest_seconds": 90, "exercise_count": 5},
        {"key": "recovery", "label_en": "Recovery-Friendly", "label_ar": "مراعية للتعافي", "sets": "3", "reps": "8-12", "rest_seconds": 75, "exercise_count": 4},
    ]

    variant_index = 0
    max_attempts = target_count * 12
    while len(results) < target_count and variant_index < max_attempts:
        base = base_options[variant_index % len(base_options)]
        scheme = schemes[(variant_index // max(1, len(base_options))) % len(schemes)]
        day_rotation = (variant_index // max(1, len(base_options) * len(schemes))) % 7
        active_names = _rotated_training_day_names(training_days, day_rotation)
        active_days = [day for day in base.get("days", []) if day.get("exercises")]
        if not active_days:
            active_days = [{"focus": focus, "exercises": []} for focus in _focus_keywords_for_goal(str(profile.get("goal") or "general_fitness"))]

        remapped_days: list[dict[str, Any]] = []
        for day_index, day_name in enumerate(active_names):
            base_day = active_days[day_index % len(active_days)]
            day_ar = next((arabic for english, arabic in WEEK_DAYS if english == day_name), day_name)
            focus = str(base_day.get("focus") or _focus_keywords_for_goal(str(profile.get("goal") or "general_fitness"))[day_index % len(_focus_keywords_for_goal(str(profile.get("goal") or "general_fitness")))])
            exercises = _build_mutated_workout_exercises(base_day, exercise_pool, focus, scheme, variant_index + day_index)
            if not exercises:
                continue
            remapped_days.append({
                "day": day_name,
                "dayAr": day_ar,
                "focus": focus,
                "exercises": exercises,
            })

        if not remapped_days:
            variant_index += 1
            continue

        plan = deepcopy(base)
        label_en = scheme["label_en"]
        label_ar = scheme["label_ar"]
        plan["id"] = f"workout_{uuid.uuid4().hex[:10]}"
        plan["title"] = f"{str(base.get('title') or 'Workout Plan')} - {label_en} {variant_index + 1}"
        plan["title_ar"] = f"{str(base.get('title_ar') or base.get('title') or 'خطة تمارين')} - {label_ar} {variant_index + 1}"
        plan["days"] = remapped_days
        plan["rest_days"] = [day_en for day_en, _ in WEEK_DAYS if day_en not in {day['day'] for day in remapped_days}]
        plan["training_days_per_week"] = len(remapped_days)
        plan["source"] = f"{base.get('source', 'dataset')}_expanded_pool"
        plan["pool_variant"] = scheme["key"]
        signature = _workout_option_signature(plan)
        if signature not in seen_signatures:
            seen_signatures.add(signature)
            results.append(plan)
        variant_index += 1

    return results[:target_count]


def _expand_nutrition_option_pool(
    base_options: list[dict[str, Any]],
    profile: dict[str, Any],
    language: str,
    target_count: int,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    seen_signatures: set[str] = set()
    styles = [
        {"key": "balanced", "title_en": "Balanced", "title_ar": "متوازن", "calorie_shift": 0, "protein_mul": 1.00, "meal_shift": 0},
        {"key": "high_protein", "title_en": "High Protein", "title_ar": "عالي البروتين", "calorie_shift": 90, "protein_mul": 1.20, "meal_shift": 1},
        {"key": "cutting", "title_en": "Cutting", "title_ar": "تنشيف", "calorie_shift": -180, "protein_mul": 1.15, "meal_shift": 2},
        {"key": "lean_bulk", "title_en": "Lean Bulk", "title_ar": "زيادة نظيفة", "calorie_shift": 220, "protein_mul": 1.10, "meal_shift": 3},
        {"key": "performance", "title_en": "Performance Fuel", "title_ar": "وقود الأداء", "calorie_shift": 140, "protein_mul": 1.05, "meal_shift": 1},
        {"key": "light", "title_en": "Light Daily", "title_ar": "خفيف يومي", "calorie_shift": -90, "protein_mul": 1.00, "meal_shift": 2},
        {"key": "recovery", "title_en": "Recovery Support", "title_ar": "دعم التعافي", "calorie_shift": 70, "protein_mul": 1.18, "meal_shift": 0},
        {"key": "budget", "title_en": "Budget Friendly", "title_ar": "اقتصادي", "calorie_shift": 0, "protein_mul": 1.00, "meal_shift": 4},
        {"key": "mediterranean", "title_en": "Mediterranean Style", "title_ar": "أسلوب متوسطي", "calorie_shift": 30, "protein_mul": 1.02, "meal_shift": 1},
        {"key": "steady", "title_en": "Steady Energy", "title_ar": "طاقة ثابتة", "calorie_shift": 40, "protein_mul": 1.06, "meal_shift": 2},
    ]

    for base in base_options:
        signature = _nutrition_option_signature(base)
        if signature in seen_signatures:
            continue
        seen_signatures.add(signature)
        results.append(base)
        if len(results) >= target_count:
            return results[:target_count]

    for base in base_options:
        for style_index, style in enumerate(styles):
            for meal_rotation in range(7):
                if len(results) >= target_count:
                    break
                plan = deepcopy(base)
                plan["id"] = f"nutrition_{uuid.uuid4().hex[:10]}"
                rotation_label_en = "" if meal_rotation == 0 else f" Cycle {meal_rotation + 1}"
                rotation_label_ar = "" if meal_rotation == 0 else f" دورة {meal_rotation + 1}"
                plan["title"] = f"{str(base.get('title') or 'Nutrition Plan')} - {style['title_en']}{rotation_label_en}"
                plan["title_ar"] = f"{str(base.get('title_ar') or base.get('title') or 'خطة تغذية')} - {style['title_ar']}{rotation_label_ar}"
                plan["daily_calories"] = max(1200, int(_to_float(base.get("daily_calories")) or 2000) + int(style["calorie_shift"]) + (meal_rotation * 20))
                plan["estimated_protein"] = max(80, int(round(((_to_float(base.get("estimated_protein")) or 140) * float(style["protein_mul"])) + (meal_rotation * 3))))
                remapped_days: list[dict[str, Any]] = []
                for day in plan.get("days", []):
                    meals = [meal for meal in day.get("meals", []) if isinstance(meal, dict)]
                    if meals:
                        shift = (style["meal_shift"] + style_index + meal_rotation) % len(meals)
                        meals = meals[shift:] + meals[:shift]
                    updated_meals = []
                    for meal_index, meal in enumerate(meals):
                        meal_calories = max(100, int(round((_to_float(meal.get("calories")) or 350) + (style["calorie_shift"] / max(1, len(meals) or 1)) + (meal_rotation * 8))))
                        updated_meals.append({
                            **meal,
                            "calories": str(meal_calories),
                            "time": str(meal.get("time") or f"meal_{meal_index + 1}"),
                        })
                    remapped_days.append({**day, "meals": updated_meals})
                plan["days"] = remapped_days
                plan["source"] = f"{base.get('source', 'dataset')}_expanded_pool"
                plan["pool_variant"] = f"{style['key']}_{meal_rotation}"
                signature = _nutrition_option_signature(plan)
                if signature in seen_signatures:
                    continue
                seen_signatures.add(signature)
                results.append(plan)
            if len(results) >= target_count:
                break
        if len(results) >= target_count:
            break

    return results[:target_count]


def _build_pending_plan_options_state(
    plan_type: str,
    all_options: list[dict[str, Any]],
    conversation_id: str,
    page: int = 0,
) -> dict[str, Any]:
    cleaned_options = [deepcopy(option) for option in all_options if isinstance(option, dict)]
    total_options = len(cleaned_options)
    total_pages = max(1, math.ceil(total_options / PLAN_OPTION_PAGE_SIZE))
    normalized_page = page % total_pages if total_options else 0
    start = normalized_page * PLAN_OPTION_PAGE_SIZE
    visible_options = cleaned_options[start:start + PLAN_OPTION_PAGE_SIZE]
    return {
        "plan_type": plan_type,
        "all_options": cleaned_options,
        "options": visible_options,
        "page": normalized_page,
        "page_size": PLAN_OPTION_PAGE_SIZE,
        "total_options": total_options,
        "total_pages": total_pages,
        "conversation_id": conversation_id,
    }


def _build_general_rag_context(
    user_message: str,
    profile: dict[str, Any],
    user_id: Optional[str] = None,
    short_query: bool = False,
) -> str:
    blocks: list[str] = []
    max_chars = 900 if short_query else 2400

    if user_id:
        persistent_hits = _persistent_rag_hits(user_id, user_message, top_k=2 if short_query else 4)
        if persistent_hits:
            formatted = []
            for hit in persistent_hits:
                text = str(hit.get("text") or "").strip()
                if not text:
                    continue
                namespace = str(hit.get("namespace") or "rag")
                formatted.append(f"- [{namespace}] {text}")
            if formatted:
                blocks.append("Persistent knowledge retrieval:\n" + "\n".join(formatted))

    try:
        lightweight_context = RAG_CONTEXT_BUILDER.build(user_message, profile, top_k=2 if short_query else 5)
        if lightweight_context:
            blocks.append(f"Catalog retrieval:\n{lightweight_context}")
    except Exception as exc:
        logger.warning("Catalog RAG context build failed: %s", exc)

    if _training_pipeline_ready():
        try:
            training_context = training_pipeline.build_rag_context(user_message, profile)
            if training_context:
                blocks.append(f"Trained dataset retrieval:\n{training_context}")
        except Exception as exc:
            logger.warning("Training RAG context build failed: %s", exc)

    if not blocks:
        return ""

    combined = "\n\n".join(blocks)
    if len(combined) > max_chars:
        combined = combined[:max_chars].rstrip() + "..."
    return combined
    if goal == "fat_loss":
        styles = sorted(styles, key=lambda s: 0 if s["key"] == "cutting_lean" else 1)
    elif goal == "muscle_gain":
        styles = sorted(styles, key=lambda s: 0 if s["key"] == "mass_gain" else 1)

    selected_styles = styles[: max(1, min(count, len(styles)))]
    options: list[dict[str, Any]] = []
    for style in selected_styles:
        plan = _generate_nutrition_plan(profile, language)
        plan["id"] = f"nutrition_{uuid.uuid4().hex[:10]}"
        plan["title"] = style["title"]
        plan["title_ar"] = style["title_ar"]
        plan["daily_calories"] = max(1200, int(plan.get("daily_calories", 2000) + style["calorie_shift"]))

        new_days = []
        for day in plan.get("days", []):
            meals = []
            for meal in day.get("meals", []):
                protein = max(5, int(round(float(meal.get("protein", 0)) * style["protein_mul"])))
                carbs = max(5, int(round(float(meal.get("carbs", 0)) * style["carb_mul"])))
                fat = max(3, int(round(float(meal.get("fat", 0)) * style["fat_mul"])))
                calories = int(round((protein * 4) + (carbs * 4) + (fat * 9)))
                meals.append(
                    {
                        **meal,
                        "protein": protein,
                        "carbs": carbs,
                        "fat": fat,
                        "calories": str(calories),
                    }
                )
            new_days.append({**day, "meals": meals})

        plan["days"] = new_days
        plan["variant_key"] = style["key"]
        options.append(plan)
    return options


def _format_plan_options_preview(
    plan_type: str,
    options: list[dict[str, Any]],
    language: str,
    page: int = 0,
    total_pages: int = 1,
    total_options: Optional[int] = None,
) -> str:
    if not options:
        if language == "en":
            return "I could not generate options right now. Please retry."
        if language == "ar_fusha":
            return "تعذر توليد خيارات الآن. حاول مرة أخرى."
        return "ما قدرت اولّد خيارات هسا. جرّب مرة ثانية."

    lines = []
    for i, plan in enumerate(options, start=1):
        default_title = (
            f"Workout Plan Option {i}"
            if plan_type == "workout" and language == "en"
            else (
                f"Nutrition Plan Option {i}"
                if plan_type != "workout" and language == "en"
                else (f"خيار تمارين {i}" if plan_type == "workout" else f"خيار تغذية {i}")
            )
        )
        display_title = _clean_language_text(
            plan.get("title") if language == "en" else (plan.get("title_ar") or plan.get("title")),
            language,
            default_title,
        )
        if language == "en" and display_title in {"Workout Plan", "Nutrition Plan"}:
            display_title = default_title

        if plan_type == "workout":
            rest_days = ", ".join(plan.get("rest_days", [])) or "None"
            sample_focus = _clean_language_text(
                next((d.get("focus") for d in plan.get("days", []) if d.get("exercises")), "general"),
                language,
                "training" if language == "en" else "تدريب",
            )
            lines.append(f"{i}. {display_title} | focus: {sample_focus} | rest: {rest_days}")
        else:
            lines.append(
                f"{i}. {display_title} | "
                f"{plan.get('daily_calories', 0)} kcal/day | {plan.get('meals_per_day', 4)} meals/day"
            )

    options_text = "\n".join(lines)
    header_suffix_en = f" Page {page + 1}/{max(1, total_pages)}" if total_pages > 1 else ""
    header_suffix_ar = f" صفحة {page + 1}/{max(1, total_pages)}" if total_pages > 1 else ""
    total_options = total_options if total_options is not None else len(options)
    if language == "en":
        return (
            f"I prepared multiple options for you ({total_options} total).{header_suffix_en}\n"
            f"{options_text}\n\n"
            "Reply with the option number you want (for example: 1). Say 'more options' to see the next page."
        )
    if language == "ar_fusha":
        return (
            f"أعددت لك عدة خيارات ({total_options} إجمالًا).{header_suffix_ar}\n"
            f"{options_text}\n\n"
            "أرسل رقم الخيار الذي تريده (مثال: 1). ويمكنك قول: خيارات أكثر لعرض الصفحة التالية."
        )
    return (
        f"جهزتلك كذا خيار ({total_options} بالمجموع).{header_suffix_ar}\n"
        f"{options_text}\n\n"
        "ابعت رقم الخيار اللي بدك ياه (مثال: 1). وإذا بدك صفحة ثانية احكي: خيارات أكثر."
    )


def _extract_plan_choice_index(user_input: str, options_count: int) -> int | None:
    if options_count <= 0:
        return None

    number = extract_first_int(user_input)
    if number is not None and 1 <= number <= options_count:
        return number - 1

    normalized = normalize_text(user_input)
    word_to_index = {
        "first": 0,
        "second": 1,
        "third": 2,
        "fourth": 3,
        "fifth": 4,
        "اول": 0,
        "ثاني": 1,
        "ثالث": 2,
        "رابع": 3,
        "خامس": 4,
    }
    for word, idx in word_to_index.items():
        if idx < options_count and fuzzy_contains_any(normalized, {word}):
            return idx
    return None


def _greeting_reply(language: str, profile: Optional[dict[str, Any]] = None) -> str:
    display_name = _profile_display_name(profile or {})
    goal_label = _profile_goal_label(str((profile or {}).get("goal", "")), language)
    if language == "en":
        if display_name and goal_label:
            return (
                f"Hey {display_name} 👋 Ready when you are. "
                f"I can help you with {goal_label}, workouts, nutrition, or fixing a plateau. "
                "What do you want right now: training, food, or progress?"
            )
        if display_name:
            return (
                f"Hey {display_name} 👋 I’m ready. "
                "I can help with workouts, meals, recovery, or progress analysis. "
                "What do you want to work on right now?"
            )
        return (
            "Hey 👋 I’m ready. I can help with workouts, nutrition, recovery, and progress analysis. "
            "Tell me what you want right now and I’ll answer directly."
        )
    if language == "ar_fusha":
        if display_name and goal_label:
            return (
                f"مرحبًا {display_name} 👋 أنا جاهز. "
                f"أستطيع مساعدتك في {goal_label}، والتمارين، والتغذية، وحل ثبات التقدم. "
                "ماذا تريد الآن: تمرين أم غذاء أم تحليل للتقدم؟"
            )
        if display_name:
            return (
                f"مرحبًا {display_name} 👋 أنا جاهز. "
                "أستطيع مساعدتك في التمارين، والوجبات، والتعافي، وتحليل التقدم. "
                "ما الذي تريد العمل عليه الآن؟"
            )
        return (
            "مرحبًا 👋 أنا جاهز. أستطيع مساعدتك في التمارين، والتغذية، والتعافي، وتحليل التقدم. "
            "أخبرني بما تريده الآن وسأجيبك مباشرة."
        )
    if display_name and goal_label:
        return (
            f"هلا {display_name} 👋 أنا جاهز. بقدر أساعدك بـ {goal_label}، والتمارين، والأكل، وحل ثبات النتائج. "
            "شو بدك هسا: تمرين، أكل، ولا تحليل تقدم؟"
        )
    if display_name:
        return (
            f"هلا {display_name} 👋 أنا جاهز. بقدر أساعدك بالتمارين، والأكل، والتعافي، وتحليل تقدمك. "
            "شو بدك نشتغل عليه هسا؟"
        )
    return (
        "هلا 👋 أنا جاهز. بقدر أساعدك بالتمارين، والتغذية، والتعافي، وتحليل التقدم. "
        "احكيلي شو بدك الآن وبجاوبك مباشرة."
    )


def _name_reply(language: str) -> str:
    if language == "en":
        return (
            "I’m your AI fitness coach. I can break down exercises, answer nutrition questions, "
            "analyze progress, and build workout or meal plans from your profile."
        )
    if language == "ar_fusha":
        return (
            "أنا مدرب اللياقة الذكي الخاص بك. أستطيع شرح التمارين، والإجابة عن أسئلة التغذية، "
            "وتحليل التقدم، وبناء خطط تمارين أو وجبات اعتمادًا على ملفك الشخصي."
        )
    return (
        "أنا كوتشك الذكي. بقدر أشرح التمارين، وأجاوب عن التغذية، وأحلل تقدمك، "
        "وأبني خطط تمارين أو وجبات حسب ملفك."
    )


def _how_are_you_reply(language: str) -> str:
    if language == "en":
        return (
            "I’m good and ready to help. If you want, I can do one of three things right now: "
            "improve your workout, answer a food question, or check your progress."
        )
    if language == "ar_fusha":
        return (
            "أنا بخير وجاهز للمساعدة. إذا أردت، أستطيع الآن أن أحسن تمرينك، أو أجيب عن سؤال غذائي، أو أراجع تقدمك."
        )
    return "تمام وجاهز للمساعدة. إذا بدك، بقدر أعدّل تمرينك، أو أجاوب عن الأكل، أو أراجع تقدمك هسا."


def _exercise_reply(query: str, language: str) -> str:
    normalized = normalize_text(query)
    mapped_query = query
    muscle_map = {
        "صدر": "chest",
        "ظهر": "back",
        "كتف": "shoulders",
        "اكتاف": "shoulders",
        "ذراع": "arms",
        "باي": "biceps",
        "تراي": "triceps",
        "ارجل": "legs",
        "رجل": "legs",
        "ساق": "legs",
        "بطن": "core",
    }
    for ar_term, en_term in muscle_map.items():
        if ar_term in normalized:
            mapped_query = f"{en_term} workout"
            break

    results = AI_ENGINE.search_exercises(mapped_query, top_k=5)
    if not results:
        if language == "en":
            return "I could not find matching exercises. Rephrase your request and I will try again."
        if language == "ar_fusha":
            return "لم أجد تمارين مطابقة. أعد صياغة طلبك وسأحاول مرة أخرى."
        return "ما لقيت تمارين مطابقة. جرّب صياغة ثانية وبرجع بدور."

    lines = []
    for item in results:
        lines.append(
            f"- {item.get('exercise')} | {item.get('muscle')} | {item.get('difficulty')}\n"
            f"  {item.get('description')}"
        )

    if language == "en":
        suffix = "\nYou can view muscle-specific exercises in the app on: /workouts (3D muscle viewer)."
    elif language == "ar_fusha":
        suffix = "\nيمكنك مشاهدة تمارين كل عضلة داخل التطبيق عبر صفحة: /workouts (المجسم العضلي)."
    else:
        suffix = "\nبتقدر تشوف تمارين كل عضلة داخل التطبيق بصفحة: /workouts (المجسم)."

    return "\n".join(lines) + suffix


def _tracking_reply(language: str, tracking_summary: Optional[dict[str, Any]]) -> str:
    if not tracking_summary:
        if language == "en":
            return (
                f"{_motivation_line(language, 'tracking-empty')} "
                "I do not have your latest tracking snapshot yet. Keep checking tasks in Schedule and I will monitor your adherence."
            )
        if language == "ar_fusha":
            return (
                f"{_motivation_line(language, 'tracking-empty')} "
                "لا أملك حالياً آخر ملخص متابعة لك. استمر بتحديد المهام في صفحة الجدول وسأتابع التزامك."
            )
        return (
            f"{_motivation_line(language, 'tracking-empty')} "
            "لسا ما وصلني آخر ملخص متابعة. ضل علّم المهام بصفحة الجدول وأنا براقب التزامك."
        )

    completed = int(tracking_summary.get("completed_tasks", 0))
    total = int(tracking_summary.get("total_tasks", 0))
    adherence = float(tracking_summary.get("adherence_score", 0))
    adherence_pct = int(round(adherence * 100))

    if language == "en":
        return (
            f"{_motivation_line(language, f'track-{completed}-{total}')} "
            f"Progress update: {completed}/{total} tasks done, adherence {adherence_pct}%.\n"
            "Based on your recent tracking, keep this consistency. If you want, I can adjust your plan intensity for next week."
        )
    if language == "ar_fusha":
        return (
            f"{_motivation_line(language, f'track-{completed}-{total}')} "
            f"تحديث التقدم: أنجزت {completed}/{total} مهمة، ونسبة الالتزام {adherence_pct}%.\n"
            "حسب تقدمك الأسبوع الماضي، استمر على هذا النسق، ويمكنني تعديل شدة الخطة للأسبوع القادم إذا أردت."
        )
    return (
        f"{_motivation_line(language, f'track-{completed}-{total}')} "
        f"تحديث الإنجاز: خلصت {completed}/{total} مهمة، والتزامك {adherence_pct}%.\n"
        "حسب تقدمك الأسبوع الماضي، استمر هيك، وإذا بدك بقدر أعدل شدة الخطة للأسبوع الجاي."
    )


def _dict_get_any(source: Any, keys: list[str]) -> Any:
    if not isinstance(source, dict):
        return None
    for key in keys:
        if key in source and source[key] not in (None, ""):
            return source[key]
    return None


def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _deep_merge_dict(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    merged: dict[str, Any] = dict(base or {})
    for key, value in (patch or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge_dict(merged[key], value)
        else:
            merged[key] = value
    return merged


def _extract_json_objects(text: str) -> list[str]:
    results: list[str] = []
    start_idx: Optional[int] = None
    depth = 0
    for idx, char in enumerate(text):
        if char == "{":
            if depth == 0:
                start_idx = idx
            depth += 1
        elif char == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start_idx is not None:
                candidate = text[start_idx : idx + 1].strip()
                if candidate:
                    results.append(candidate)
                start_idx = None
    return results


def _try_parse_json_object(raw_text: str) -> Optional[dict[str, Any]]:
    candidate = (raw_text or "").strip()
    if not candidate:
        return None

    parse_candidates = [
        candidate,
        re.sub(r",\s*([}\]])", r"\1", candidate),
    ]
    for payload in parse_candidates:
        try:
            obj = json.loads(payload)
            if isinstance(obj, dict):
                return obj
        except Exception:
            continue
    return None


def _looks_like_tracking_summary(payload: dict[str, Any]) -> bool:
    if not isinstance(payload, dict):
        return False
    if any(key in payload for key in ("goal", "weekly_stats", "monthly_stats", "adherence_score")):
        return True
    # Some payloads may arrive flattened.
    flat_keys = {"goal.type", "goal.current_weight", "goal.target_weight", "weekly_stats.weight_change"}
    return any(key in payload for key in flat_keys)


def _extract_float_from_patterns(source: str, patterns: list[str]) -> Optional[float]:
    for pattern in patterns:
        match = re.search(pattern, source, flags=re.IGNORECASE)
        if not match:
            continue
        parsed = _to_float(match.group(1))
        if parsed is not None:
            return parsed
    return None


def _extract_float_series_from_patterns(source: str, patterns: list[str]) -> list[float]:
    for pattern in patterns:
        match = re.search(pattern, source, flags=re.IGNORECASE)
        if not match:
            continue
        values = _to_float_list(match.group(1))
        if len(values) >= 2:
            return values
    return []


def _extract_goal_type_from_patterns(source: str) -> str:
    goal_patterns = [
        r"(?:goal(?:\s*type)?|goal_type|نوع\s*الهدف|الهدف)\s*[:=]\s*([a-z_\-\s\u0600-\u06FF]+)",
    ]
    for pattern in goal_patterns:
        match = re.search(pattern, source, flags=re.IGNORECASE)
        if not match:
            continue
        normalized = _normalize_goal(match.group(1))
        if normalized in {"muscle_gain", "fat_loss", "general_fitness"}:
            return normalized
    inferred = _normalize_goal(source)
    if inferred in {"muscle_gain", "fat_loss", "general_fitness"}:
        return inferred
    return ""


def _extract_tracking_summary_from_message(
    user_input: str,
    profile: dict[str, Any],
) -> Optional[dict[str, Any]]:
    source = _repair_mojibake(user_input or "")
    if not source:
        return None

    extracted: dict[str, Any] = {}
    has_tracking_signal = False

    for candidate in _extract_json_objects(source):
        obj = _try_parse_json_object(candidate)
        if not obj:
            continue
        if _looks_like_tracking_summary(obj):
            extracted = _deep_merge_dict(extracted, obj)
            has_tracking_signal = True

    goal_payload = extracted.get("goal") if isinstance(extracted.get("goal"), dict) else {}
    weekly_payload = extracted.get("weekly_stats") if isinstance(extracted.get("weekly_stats"), dict) else {}
    monthly_payload = extracted.get("monthly_stats") if isinstance(extracted.get("monthly_stats"), dict) else {}

    goal_type = _extract_goal_type_from_patterns(source)
    if goal_type:
        goal_payload["type"] = goal_type
        has_tracking_signal = True

    number_pattern = r"([+-]?\d+(?:\.\d+)?)(?:\s*\+)?"
    current_weight = _extract_float_from_patterns(
        source,
        [
            rf"(?:current[_\s-]*weight|weight[_\s-]*now|وزن(?:ي)?\s*(?:الحالي|الان|الآن)?)\s*[:=]?\s*{number_pattern}",
            rf"(?:وزن(?:ي)?|وزني)\s*[:=]?\s*{number_pattern}",
            rf"(?:goal\.current_weight|current_weight)\s*[:=]?\s*{number_pattern}",
        ],
    )
    target_weight = _extract_float_from_patterns(
        source,
        [
            rf"(?:target[_\s-]*weight|goal[_\s-]*weight|الوزن\s*(?:المستهدف|الهدف)|هدف(?:ي)?\s*وزن)\s*[:=]?\s*{number_pattern}",
            rf"(?:هدفي|هدف(?:ي)?)\s*[:=]?\s*{number_pattern}",
            rf"(?:goal\.target_weight|target_weight)\s*[:=]?\s*{number_pattern}",
        ],
    )
    weekly_weight_change = _extract_float_from_patterns(
        source,
        [
            rf"(?:weekly[_\s-]*weight[_\s-]*change|weekly[_\s-]*change|تغير\s*الوزن\s*(?:الاسبوعي|الأسبوعي)|نزول\s*(?:اسبوعي|أسبوعي)|زيادة\s*(?:اسبوعية|أسبوعية))\s*[:=]?\s*{number_pattern}",
            rf"(?:weekly_stats\.weight_change|weight_change)\s*[:=]?\s*{number_pattern}",
        ],
    )

    if weekly_weight_change is None:
        gain_match = re.search(
            rf"(?:زاد(?:ت)?\s*وزن(?:ي)?|وزن(?:ي)?\s*زاد|وزن(?:ي)?\s*بزيد|وزن(?:ي)?\s*عم\s*يزيد|زيادة\s*وزن(?:ي)?)\s*(?:بالاسبوع|بالأسبوع|اسبوعي|أسبوعي)?\s*[:=]?\s*{number_pattern}",
            source,
            flags=re.IGNORECASE,
        )
        loss_match = re.search(
            rf"(?:نقص(?:ت)?\s*وزن(?:ي)?|وزن(?:ي)?\s*نقص|وزن(?:ي)?\s*بنقص|وزن(?:ي)?\s*عم\s*ينقص|نزول\s*وزن(?:ي)?|خسرت\s*وزن(?:ي)?)\s*(?:بالاسبوع|بالأسبوع|اسبوعي|أسبوعي)?\s*[:=]?\s*{number_pattern}",
            source,
            flags=re.IGNORECASE,
        )
        if gain_match:
            weekly_weight_change = _to_float(gain_match.group(1))
        elif loss_match:
            loss_value = _to_float(loss_match.group(1))
            weekly_weight_change = -abs(loss_value) if loss_value is not None else None
    monthly_weight_change = _extract_float_from_patterns(
        source,
        [
            rf"(?:monthly[_\s-]*weight[_\s-]*change|monthly[_\s-]*change|تغير\s*الوزن\s*الشهري)\s*[:=]?\s*{number_pattern}",
            rf"(?:monthly_stats\.weight_change|monthly_weight_change)\s*[:=]?\s*{number_pattern}",
        ],
    )
    strength_increase = _extract_float_from_patterns(
        source,
        [
            rf"(?:strength[_\s-]*increase(?:[_\s-]*percent)?|strength[_\s-]*percent|زيادة\s*القوة(?:\s*الشهرية)?)\s*[:=]?\s*{number_pattern}\s*%?",
            rf"(?:monthly_stats\.strength_increase_percent|strength_increase_percent)\s*[:=]?\s*{number_pattern}",
        ],
    )
    consistency_percent = _extract_float_from_patterns(
        source,
        [
            rf"(?:consistency(?:[_\s-]*percent)?|consistency[_\s-]*pct|نسبة\s*الالتزام|الالتزام)\s*[:=]?\s*{number_pattern}\s*%?",
            rf"(?:monthly_stats\.consistency_percent|consistency_percent)\s*[:=]?\s*{number_pattern}",
        ],
    )
    workout_days = _extract_float_from_patterns(
        source,
        [
            rf"(?:workout[_\s-]*days|days[_\s-]*trained|ايام\s*التمرين|أيام\s*التمرين)\s*[:=]?\s*{number_pattern}",
            rf"(?:weekly_stats\.workout_days|workout_days)\s*[:=]?\s*{number_pattern}",
        ],
    )
    planned_days = _extract_float_from_patterns(
        source,
        [
            rf"(?:planned[_\s-]*days|plan[_\s-]*days|ايام\s*الخطة|أيام\s*الخطة)\s*[:=]?\s*{number_pattern}",
            rf"(?:weekly_stats\.planned_days|planned_days)\s*[:=]?\s*{number_pattern}",
        ],
    )
    avg_calories = _extract_float_from_patterns(
        source,
        [
            rf"(?:avg[_\s-]*calories|average[_\s-]*calories|متوسط\s*السعرات|السعرات)\s*[:=]?\s*{number_pattern}",
            rf"(?:weekly_stats\.avg_calories|avg_calories)\s*[:=]?\s*{number_pattern}",
        ],
    )
    avg_protein = _extract_float_from_patterns(
        source,
        [
            rf"(?:avg[_\s-]*protein|average[_\s-]*protein|متوسط\s*البروتين|البروتين)\s*[:=]?\s*{number_pattern}",
            rf"(?:weekly_stats\.avg_protein|avg_protein)\s*[:=]?\s*{number_pattern}",
        ],
    )
    sleep_avg_hours = _extract_float_from_patterns(
        source,
        [
            rf"(?:sleep[_\s-]*avg[_\s-]*hours|average[_\s-]*sleep|sleep[_\s-]*hours|متوسط\s*النوم|ساعات\s*النوم)\s*[:=]?\s*{number_pattern}",
            rf"(?:weekly_stats\.sleep_avg_hours|sleep_avg_hours)\s*[:=]?\s*{number_pattern}",
        ],
    )
    weight_change_history = _extract_float_series_from_patterns(
        source,
        [
            r"(?:weight[_\s-]*change[_\s-]*history|weekly[_\s-]*history|last[_\s-]*4[_\s-]*weeks(?:[_\s-]*weight[_\s-]*change)?)\s*[:=]\s*([0-9,\.\-\+\s|;/]+)",
            r"(?:تغير(?:ات)?\s*الوزن\s*(?:آخر|اخر)\s*4\s*(?:اسابيع|أسابيع)|آخر\s*4\s*(?:اسابيع|أسابيع)\s*تغير\s*الوزن)\s*[:=]\s*([0-9,\.\-\+\s|;/]+)",
        ],
    )

    if current_weight is not None:
        goal_payload["current_weight"] = current_weight
        has_tracking_signal = True
    if target_weight is not None:
        goal_payload["target_weight"] = target_weight
        has_tracking_signal = True
    if weekly_weight_change is not None:
        weekly_payload["weight_change"] = weekly_weight_change
        has_tracking_signal = True
    if monthly_weight_change is not None:
        monthly_payload["weight_change"] = monthly_weight_change
        has_tracking_signal = True
    if strength_increase is not None:
        monthly_payload["strength_increase_percent"] = strength_increase
        has_tracking_signal = True
    if consistency_percent is not None:
        monthly_payload["consistency_percent"] = consistency_percent
        has_tracking_signal = True
    if workout_days is not None:
        weekly_payload["workout_days"] = workout_days
        has_tracking_signal = True
    if planned_days is not None:
        weekly_payload["planned_days"] = planned_days
        has_tracking_signal = True
    if avg_calories is not None:
        weekly_payload["avg_calories"] = avg_calories
        has_tracking_signal = True
    if avg_protein is not None:
        weekly_payload["avg_protein"] = avg_protein
        has_tracking_signal = True
    if sleep_avg_hours is not None:
        weekly_payload["sleep_avg_hours"] = sleep_avg_hours
        has_tracking_signal = True
    if weight_change_history:
        weekly_payload["weight_change_history"] = weight_change_history[-4:]
        has_tracking_signal = True

    if goal_payload:
        extracted["goal"] = goal_payload
    if weekly_payload:
        extracted["weekly_stats"] = weekly_payload
    if monthly_payload:
        extracted["monthly_stats"] = monthly_payload

    if not has_tracking_signal:
        return None
    return extracted or None


def _merge_tracking_summaries(
    current_summary: Optional[dict[str, Any]],
    new_summary: Optional[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    if not isinstance(current_summary, dict) and not isinstance(new_summary, dict):
        return None
    if not isinstance(current_summary, dict):
        return deepcopy(new_summary) if isinstance(new_summary, dict) else None
    if not isinstance(new_summary, dict):
        return deepcopy(current_summary)
    return _deep_merge_dict(current_summary, new_summary)


def _has_actionable_tracking_metrics(summary: Optional[dict[str, Any]]) -> bool:
    if not isinstance(summary, dict):
        return False

    goal = summary.get("goal") if isinstance(summary.get("goal"), dict) else {}
    weekly = summary.get("weekly_stats") if isinstance(summary.get("weekly_stats"), dict) else {}
    monthly = summary.get("monthly_stats") if isinstance(summary.get("monthly_stats"), dict) else {}

    if _to_float(_dict_get_any(goal, ["current_weight", "target_weight", "target_strength_increase_percent"])) is not None:
        return True
    if _to_float(_dict_get_any(weekly, ["weight_change", "weekly_weight_change"])) is not None:
        return True
    if _to_float(_dict_get_any(monthly, ["strength_increase_percent", "weight_change"])) is not None:
        return True
    if _to_float(_dict_get_any(monthly, ["consistency_percent"])) is not None:
        return True
    if _to_float_list(_dict_get_any(weekly, ["weight_change_history", "weight_change_last_4_weeks"])):
        return True
    if _to_float_list(_dict_get_any(summary, ["weekly_weight_change_history", "last_4_weeks_weight_change"])):
        return True

    return False


def _is_performance_analysis_request(
    user_input: str,
    message_tracking_summary: Optional[dict[str, Any]] = None,
) -> bool:
    normalized = normalize_text(user_input)
    if not normalized:
        return False

    if _contains_any(normalized, PERFORMANCE_ANALYSIS_KEYWORDS):
        return True

    if _contains_any(normalized, {"analyze", "analysis", "حلل", "تحليل", "قيّم", "قيم"}):
        if _contains_any(normalized, {"performance", "progress", "اداء", "أداء", "ادائي", "تقدمي", "تقدم"}):
            return True

    intent_terms = {
        "analysis",
        "analyze",
        "progress rate",
        "on track",
        "ahead",
        "behind",
        "estimate",
        "timeline",
        "weeks remaining",
        "تحليل",
        "حلل",
        "تقييم",
        "على المسار",
        "متقدم",
        "متاخر",
        "متأخر",
        "كم اسبوع",
        "كم أسبوع",
        "الوقت المتبقي",
        "المتبقي",
    }
    metric_terms = {
        "weight",
        "strength",
        "calories",
        "protein",
        "sleep",
        "consistency",
        "وزن",
        "قوة",
        "سعرات",
        "بروتين",
        "نوم",
        "التزام",
        "تقدم",
    }
    if _contains_any(normalized, intent_terms) and _contains_any(normalized, metric_terms):
        return True

    # If the user sends actionable tracking metrics in the same message, treat it as analysis intent.
    if _has_actionable_tracking_metrics(message_tracking_summary):
        return True

    return False


def _format_number(value: Optional[float], digits: int = 2) -> str:
    if value is None:
        return "N/A"
    return f"{value:.{digits}f}"


def _to_float_list(value: Any) -> list[float]:
    values: list[float] = []
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                parsed = _to_float(
                    _dict_get_any(item, ["weight_change", "weekly_weight_change", "weightChange", "delta", "change"])
                )
            else:
                parsed = _to_float(item)
            if parsed is not None:
                values.append(parsed)
        return values

    if isinstance(value, str):
        for token in re.findall(r"-?\d+(?:\.\d+)?", value):
            parsed = _to_float(token)
            if parsed is not None:
                values.append(parsed)
    return values


def _extract_weight_change_series(
    tracking_summary: dict[str, Any],
    weekly_stats: dict[str, Any],
) -> list[float]:
    direct_series_keys = [
        "weight_change_last_4_weeks",
        "weight_change_history",
        "last_4_weeks_weight_change",
        "weekly_weight_change_history",
        "last4_weight_change",
        "recent_weight_changes",
    ]
    for key in direct_series_keys:
        if key in weekly_stats:
            values = _to_float_list(weekly_stats.get(key))
            if values:
                return values

    summary_series_keys = [
        "weekly_weight_change_history",
        "weight_change_history",
        "last_4_weeks_weight_change",
        "recent_weight_changes",
        "last_4_weeks",
    ]
    for key in summary_series_keys:
        if key in tracking_summary:
            values = _to_float_list(tracking_summary.get(key))
            if values:
                return values

    weekly_history = tracking_summary.get("weekly_history")
    values = _to_float_list(weekly_history)
    if values:
        return values

    return []


def _average(values: list[float]) -> Optional[float]:
    if not values:
        return None
    return sum(values) / len(values)


def _mean_abs_deviation(values: list[float]) -> Optional[float]:
    if len(values) < 2:
        return None
    mean_value = _average(values)
    if mean_value is None:
        return None
    return sum(abs(item - mean_value) for item in values) / len(values)


def _fitness_level_to_experience(value: Any) -> float:
    normalized = normalize_text(str(value or ""))
    if any(token in normalized for token in {"advanced", "adv", "متقدم"}):
        return 3.0
    if any(token in normalized for token in {"intermediate", "inter", "متوسط"}):
        return 2.0
    if any(token in normalized for token in {"beginner", "beg", "مبتد"}):
        return 1.0
    parsed = _to_float(value)
    return float(parsed) if parsed is not None else 0.0


def _is_goal_prediction_request(user_input: str) -> bool:
    normalized = normalize_text(user_input)
    if _contains_any(normalized, ML_GOAL_QUERY_KEYWORDS):
        return True
    return _contains_any(normalized, {"goal", "هدف"}) and _contains_any(normalized, ML_GENERAL_PREDICTION_KEYWORDS)


def _is_success_prediction_request(user_input: str) -> bool:
    normalized = normalize_text(user_input)
    if _contains_any(normalized, ML_SUCCESS_QUERY_KEYWORDS):
        return True
    return _contains_any(normalized, {"success", "نجاح", "التزام"}) and _contains_any(
        normalized, ML_GENERAL_PREDICTION_KEYWORDS
    )


def _build_goal_prediction_payload(
    profile: dict[str, Any], tracking_summary: Optional[dict[str, Any]]
) -> tuple[dict[str, Any], list[str]]:
    tracking_summary = tracking_summary if isinstance(tracking_summary, dict) else {}
    weekly_stats = tracking_summary.get("weekly_stats") if isinstance(tracking_summary.get("weekly_stats"), dict) else {}
    monthly_stats = tracking_summary.get("monthly_stats") if isinstance(tracking_summary.get("monthly_stats"), dict) else {}

    age = _to_float(profile.get("age"))
    gender = str(profile.get("gender") or "Other")
    weight_kg = _to_float(_dict_get_any(profile, ["weight", "weight_kg"]))

    height_value = _to_float(_dict_get_any(profile, ["height", "height_cm", "height_m"]))
    height_cm: Optional[float] = None
    height_m: Optional[float] = None
    if height_value is not None:
        if height_value > 3:
            height_cm = height_value
            height_m = height_value / 100.0
        else:
            height_m = height_value
            height_cm = height_value * 100.0

    fat_percentage = _to_float(_dict_get_any(profile, ["fat_percentage", "body_fat_percentage", "body_fat"]))
    workout_frequency_days_week = _to_float(
        _dict_get_any(weekly_stats, ["workout_days", "training_days", "sessions", "completed_workouts"])
    )
    calories_burned = _to_float(
        _dict_get_any(weekly_stats, ["calories_burned", "avg_calories_burned", "calories_burned_avg"])
    )
    if calories_burned is None:
        calories_burned = _to_float(_dict_get_any(monthly_stats, ["avg_calories_burned", "calories_burned"]))
    avg_bpm = _to_float(_dict_get_any(weekly_stats, ["avg_bpm", "heart_rate_avg", "average_bpm"]))

    payload = {
        "age": age or 0.0,
        "gender": gender,
        "weight_kg": weight_kg or 0.0,
        "height_m": height_m,
        "height_cm": height_cm,
        "bmi": _to_float(_dict_get_any(profile, ["bmi"])) or 0.0,
        "fat_percentage": fat_percentage or 0.0,
        "workout_frequency_days_week": workout_frequency_days_week or 0.0,
        "experience_level": _fitness_level_to_experience(profile.get("fitness_level")),
        "calories_burned": calories_burned or 0.0,
        "avg_bpm": avg_bpm or 0.0,
    }

    missing_fields: list[str] = []
    if age is None:
        missing_fields.append("age")
    if weight_kg is None:
        missing_fields.append("weight")
    if height_value is None:
        missing_fields.append("height")

    return payload, missing_fields


def _build_success_prediction_payload(
    profile: dict[str, Any], tracking_summary: Optional[dict[str, Any]]
) -> tuple[dict[str, Any], list[str]]:
    tracking_summary = tracking_summary if isinstance(tracking_summary, dict) else {}
    weekly_stats = tracking_summary.get("weekly_stats") if isinstance(tracking_summary.get("weekly_stats"), dict) else {}
    monthly_stats = tracking_summary.get("monthly_stats") if isinstance(tracking_summary.get("monthly_stats"), dict) else {}

    age = _to_float(profile.get("age"))
    gender = str(profile.get("gender") or "Other")
    membership_type = str(_dict_get_any(profile, ["membership_type", "membership", "plan_type"]) or "Unknown")
    workout_type = str(
        _dict_get_any(weekly_stats, ["workout_type", "main_workout_type"])
        or _dict_get_any(profile, ["workout_type", "preferred_workout_type"])
        or "General"
    )
    workout_duration_minutes = _to_float(
        _dict_get_any(
            weekly_stats,
            ["avg_workout_duration_minutes", "workout_duration_minutes", "session_duration_minutes", "duration_minutes"],
        )
    )
    if workout_duration_minutes is None:
        workout_duration_minutes = _to_float(_dict_get_any(monthly_stats, ["avg_workout_duration_minutes"]))
    calories_burned = _to_float(
        _dict_get_any(weekly_stats, ["calories_burned", "avg_calories_burned", "calories_burned_avg"])
    )
    if calories_burned is None:
        calories_burned = _to_float(_dict_get_any(monthly_stats, ["avg_calories_burned", "calories_burned"]))

    check_in_hour_value = _to_float(_dict_get_any(weekly_stats, ["check_in_hour", "avg_check_in_hour"]))
    check_in_hour = int(check_in_hour_value) if check_in_hour_value is not None else int(datetime.utcnow().hour)

    payload = {
        "age": age or 0.0,
        "gender": gender,
        "membership_type": membership_type,
        "workout_type": workout_type,
        "workout_duration_minutes": workout_duration_minutes or 0.0,
        "calories_burned": calories_burned or 0.0,
        "check_in_hour": check_in_hour,
    }

    missing_fields: list[str] = []
    if age is None:
        missing_fields.append("age")
    if workout_duration_minutes is None:
        missing_fields.append("weekly_stats.avg_workout_duration_minutes")
    if calories_burned is None:
        missing_fields.append("weekly_stats.calories_burned")

    return payload, missing_fields


def _ml_missing_fields_reply(language: str, prediction_type: str, missing_fields: list[str]) -> str:
    missing_text = ", ".join(missing_fields)
    if prediction_type == "goal":
        return _lang_reply(
            language,
            f"To run goal prediction, I still need: {missing_text}.",
            f"لتشغيل توقع الهدف، أحتاج هذه البيانات: {missing_text}.",
            f"عشان أشغّل توقع الهدف، لسا بحتاج: {missing_text}.",
        )
    return _lang_reply(
        language,
        f"To run success prediction, I still need: {missing_text}.",
        f"لتشغيل توقع النجاح، أحتاج هذه البيانات: {missing_text}.",
        f"عشان أشغّل توقع النجاح، لسا بحتاج: {missing_text}.",
    )


def _goal_label_from_prediction(value: Any, language: str) -> str:
    key = str(value or "").strip().lower()
    if key in {"muscle_gain", "fat_loss", "general_fitness"}:
        return _profile_goal_label(key, language)
    return str(value or "unknown")


def _ml_prediction_chat_response(
    user_input: str,
    language: str,
    profile: dict[str, Any],
    tracking_summary: Optional[dict[str, Any]],
) -> Optional[tuple[str, dict[str, Any]]]:
    want_goal = _is_goal_prediction_request(user_input)
    want_success = _is_success_prediction_request(user_input)

    if not want_goal and not want_success:
        return None

    reply_parts: list[str] = []
    payload: dict[str, Any] = {}

    if want_goal:
        goal_features, missing = _build_goal_prediction_payload(profile, tracking_summary)
        if missing:
            reply_parts.append(_ml_missing_fields_reply(language, "goal", missing))
        else:
            try:
                result = predict_goal(goal_features)
                predicted_goal = result.get("predicted_goal")
                predicted_goal_label = _goal_label_from_prediction(predicted_goal, language)
                confidence = None
                probabilities = result.get("probabilities") if isinstance(result.get("probabilities"), dict) else {}
                if predicted_goal in probabilities:
                    confidence = _to_float(probabilities.get(predicted_goal))

                goal_reply = _lang_reply(
                    language,
                    (
                        f"Goal prediction: {predicted_goal_label}"
                        + (f" (confidence {_format_number((confidence or 0) * 100, 1)}%)" if confidence is not None else "")
                        + "."
                    ),
                    (
                        f"توقع الهدف: {predicted_goal_label}"
                        + (f" (ثقة {_format_number((confidence or 0) * 100, 1)}%)" if confidence is not None else "")
                        + "."
                    ),
                    (
                        f"توقع الهدف: {predicted_goal_label}"
                        + (f" (ثقة {_format_number((confidence or 0) * 100, 1)}%)" if confidence is not None else "")
                        + "."
                    ),
                )
                reply_parts.append(goal_reply)
                payload["goal_prediction"] = result
                payload["goal_features_used"] = goal_features
            except FileNotFoundError:
                reply_parts.append(
                    _lang_reply(
                        language,
                        "Goal model is not available yet. Train `model_goal.pkl` first.",
                        "نموذج توقع الهدف غير متاح بعد. درّب `model_goal.pkl` أولًا.",
                        "نموذج توقع الهدف مش جاهز. درّب `model_goal.pkl` أول.",
                    )
                )

    if want_success:
        success_features, missing = _build_success_prediction_payload(profile, tracking_summary)
        if missing:
            reply_parts.append(_ml_missing_fields_reply(language, "success", missing))
        else:
            try:
                result = predict_success(success_features)
                prediction_flag = int(result.get("success_prediction", 0) or 0)
                probability = _to_float(result.get("success_probability"))
                status_text = _lang_reply(
                    language,
                    "likely on track" if prediction_flag == 1 else "at risk / needs adjustment",
                    "غالبًا على المسار الصحيح" if prediction_flag == 1 else "مُعرّض للتأخر ويحتاج تعديل",
                    "غالبًا ماشي صح" if prediction_flag == 1 else "في خطر تأخير وبدها تعديل",
                )
                success_reply = _lang_reply(
                    language,
                    (
                        "Success prediction: "
                        + (f"{_format_number((probability or 0) * 100, 1)}% " if probability is not None else "")
                        + f"({status_text})."
                    ),
                    (
                        "توقع النجاح: "
                        + (f"{_format_number((probability or 0) * 100, 1)}% " if probability is not None else "")
                        + f"({status_text})."
                    ),
                    (
                        "توقع النجاح: "
                        + (f"{_format_number((probability or 0) * 100, 1)}% " if probability is not None else "")
                        + f"({status_text})."
                    ),
                )
                reply_parts.append(success_reply)
                payload["success_prediction"] = result
                payload["success_features_used"] = success_features
            except FileNotFoundError:
                reply_parts.append(
                    _lang_reply(
                        language,
                        "Success model is not available yet. Train `model_success.pkl` first.",
                        "نموذج توقع النجاح غير متاح بعد. درّب `model_success.pkl` أولًا.",
                        "نموذج توقع النجاح مش جاهز. درّب `model_success.pkl` أول.",
                    )
                )

    if not reply_parts:
        return None

    return "\n".join(reply_parts), payload


def _status_label(language: str, status: str) -> str:
    status_key = status.strip().lower()
    if status_key == "ahead of schedule":
        return _lang_reply(language, "Ahead of schedule", "متقدم عن الخطة", "متقدّم عن الخطة")
    if status_key == "behind schedule":
        return _lang_reply(language, "Behind schedule", "متأخر عن الخطة", "متأخر عن الخطة")
    return _lang_reply(language, "On track", "على المسار الصحيح", "على المسار")


def _performance_missing_data_reply(language: str, missing_fields: list[str]) -> str:
    fields_text = ", ".join(missing_fields)
    quick_example = (
        "وزني الحالي 92، هدفي 85، تغير وزني الأسبوعي -0.5"
    )
    return _lang_reply(
        language,
        (
            "I can estimate how long is left, but I need a few missing details: "
            f"{fields_text}. "
            "Send them in plain text, for example: "
            f"{quick_example}"
        ),
        (
            "بقدر أحسب لك كم ضايل، بس ناقصني شوية بيانات: "
            f"{fields_text}. "
            "ابعثهم كتابة بشكل بسيط مثل: "
            f"{quick_example}"
        ),
        (
            "بقدر أحسب لك قديش ضايل، بس ناقصني بيانات: "
            f"{fields_text}. "
            "ابعتهم بشكل بسيط مثل: "
            f"{quick_example}"
        ),
    )

def _basic_progress_reply(language: str, tracking_summary: dict[str, Any]) -> str:
    completed = _to_float(tracking_summary.get("completed_tasks")) or 0
    total = _to_float(tracking_summary.get("total_tasks")) or 0
    adherence = _to_float(tracking_summary.get("adherence_score"))
    if adherence is None and total > 0:
        adherence = completed / total
    percent = int(round((adherence or 0) * 100))
    last7 = _to_float(tracking_summary.get("completed_last_7_days")) or 0
    last_completion = tracking_summary.get("last_completed_at")
    days_logged = int(_to_float(tracking_summary.get("days_logged_last_7")) or 0)
    weekly_stats = tracking_summary.get("weekly_stats") if isinstance(tracking_summary.get("weekly_stats"), dict) else {}
    workout_days = int(_to_float(_dict_get_any(weekly_stats, ["workout_days"])) or 0)
    planned_days = int(_to_float(_dict_get_any(weekly_stats, ["planned_days"])) or 0)
    nutrition_log_days = int(_to_float(_dict_get_any(weekly_stats, ["nutrition_log_days"])) or 0)
    recent_exercises = tracking_summary.get("recent_completed_exercises") if isinstance(tracking_summary.get("recent_completed_exercises"), list) else []
    recent_workout_notes = tracking_summary.get("recent_workout_notes") if isinstance(tracking_summary.get("recent_workout_notes"), list) else []
    recent_nutrition_notes = tracking_summary.get("recent_nutrition_notes") if isinstance(tracking_summary.get("recent_nutrition_notes"), list) else []
    recent_moods = tracking_summary.get("recent_moods") if isinstance(tracking_summary.get("recent_moods"), list) else []

    exercise_names = []
    for item in recent_exercises[:3]:
        if isinstance(item, dict):
            name = str(item.get("exercise_name", "")).strip()
            if name:
                exercise_names.append(name)

    workout_line = None
    if planned_days > 0:
        workout_line = f"{workout_days}/{planned_days} workout days hit this week"
    elif workout_days > 0:
        workout_line = f"{workout_days} workout days recorded this week"

    nutrition_line = None
    if nutrition_log_days > 0:
        nutrition_line = f"{nutrition_log_days} nutrition log days recorded this week"

    note_line = str(recent_workout_notes[0]).strip() if recent_workout_notes else None
    food_line = str(recent_nutrition_notes[0]).strip() if recent_nutrition_notes else None
    mood_line = str(recent_moods[0]).strip() if recent_moods else None

    if language == "en":
        parts = [
            f"Progress: {percent}% ({int(completed)}/{int(total)} tasks).",
            f"Last 7 days: {int(last7)} completed.",
        ]
        if days_logged:
            parts.append(f"Logs captured on {days_logged} days.")
        if workout_line:
            parts.append(workout_line + ".")
        if nutrition_line:
            parts.append(nutrition_line + ".")
        if exercise_names:
            parts.append("Recent exercises: " + ", ".join(exercise_names) + ".")
        if note_line:
            parts.append(f"Latest workout note: {note_line}")
        if food_line:
            parts.append(f"Latest nutrition note: {food_line}")
        if mood_line:
            parts.append(f"Latest mood/energy note: {mood_line}")
        if last_completion:
            parts.append(f"Last completion: {last_completion}.")
        parts.append("If you want a timeline to your goal, share your current and target weight.")
        return " ".join(parts)

    if language == "ar_fusha":
        parts_ar = [
            f"التقدم: {percent}% ({int(completed)}/{int(total)} مهمة).",
            f"آخر 7 أيام: {int(last7)} مهمة مكتملة.",
        ]
        if days_logged:
            parts_ar.append(f"تم تسجيل ملاحظات في {days_logged} أيام.")
        if planned_days > 0:
            parts_ar.append(f"أيام التمرين هذا الأسبوع: {workout_days}/{planned_days}.")
        elif workout_days > 0:
            parts_ar.append(f"تم تسجيل {workout_days} أيام تمرين هذا الأسبوع.")
        if nutrition_log_days > 0:
            parts_ar.append(f"تم تسجيل التغذية في {nutrition_log_days} أيام هذا الأسبوع.")
        if exercise_names:
            parts_ar.append("أحدث التمارين المنجزة: " + "، ".join(exercise_names) + ".")
        if note_line:
            parts_ar.append(f"آخر ملاحظة تمرين: {note_line}")
        if food_line:
            parts_ar.append(f"آخر ملاحظة تغذية: {food_line}")
        if mood_line:
            parts_ar.append(f"آخر ملاحظة طاقة/مزاج: {mood_line}")
        if last_completion:
            parts_ar.append(f"آخر إكمال: {last_completion}.")
        parts_ar.append("إذا أردت تقدير المدة للوصول إلى هدفك، أرسل وزنك الحالي والوزن المستهدف.")
        return " ".join(parts_ar)

    parts_ar = [
        f"تقدمك: {percent}% ({int(completed)}/{int(total)} مهمة).",
        f"آخر 7 أيام: خلصت {int(last7)} مهمة.",
    ]
    if days_logged:
        parts_ar.append(f"سجلت ملاحظات بـ {days_logged} أيام.")
    if planned_days > 0:
        parts_ar.append(f"أيام التمرين هالأسبوع: {workout_days}/{planned_days}.")
    elif workout_days > 0:
        parts_ar.append(f"سجلت {workout_days} أيام تمرين هالأسبوع.")
    if nutrition_log_days > 0:
        parts_ar.append(f"وسجلت التغذية بـ {nutrition_log_days} أيام.")
    if exercise_names:
        parts_ar.append("آخر التمارين اللي خلصتها: " + "، ".join(exercise_names) + ".")
    if note_line:
        parts_ar.append(f"آخر ملاحظة تمرين: {note_line}")
    if food_line:
        parts_ar.append(f"آخر ملاحظة تغذية: {food_line}")
    if mood_line:
        parts_ar.append(f"آخر ملاحظة طاقة/مزاج: {mood_line}")
    if last_completion:
        parts_ar.append(f"آخر إكمال: {last_completion}.")
    parts_ar.append("إذا بدك أحسب المدة لهدفك بدقة، ابعت وزنك الحالي وهدفك النهائي.")
    return " ".join(parts_ar)


def _activity_progress_analysis_reply(language: str, tracking_summary: dict[str, Any]) -> str:
    progress_metrics = tracking_summary.get("progress_metrics") if isinstance(tracking_summary.get("progress_metrics"), dict) else {}
    weekly_stats = tracking_summary.get("weekly_stats") if isinstance(tracking_summary.get("weekly_stats"), dict) else {}
    recent_workout_notes = tracking_summary.get("recent_workout_notes") if isinstance(tracking_summary.get("recent_workout_notes"), list) else []
    recent_nutrition_notes = tracking_summary.get("recent_nutrition_notes") if isinstance(tracking_summary.get("recent_nutrition_notes"), list) else []
    recent_moods = tracking_summary.get("recent_moods") if isinstance(tracking_summary.get("recent_moods"), list) else []

    recent_completed = int(_to_float(progress_metrics.get("recent_completed_tasks")) or _to_float(weekly_stats.get("recent_completed_tasks")) or tracking_summary.get("completed_last_7_days") or 0)
    prior_completed = int(_to_float(progress_metrics.get("prior_completed_tasks")) or _to_float(weekly_stats.get("previous_completed_tasks")) or 0)
    completion_delta = int(_to_float(progress_metrics.get("completion_delta")) or _to_float(weekly_stats.get("completion_delta")) or (recent_completed - prior_completed))
    workout_adherence_percent = int(_to_float(progress_metrics.get("workout_adherence_percent")) or _to_float(weekly_stats.get("workout_adherence_percent")) or 0)
    logging_consistency_percent = int(_to_float(progress_metrics.get("logging_consistency_percent")) or _to_float(weekly_stats.get("logging_consistency_percent")) or 0)
    workout_streak = int(_to_float(progress_metrics.get("current_workout_streak_days")) or _to_float(weekly_stats.get("current_workout_streak_days")) or 0)
    logging_streak = int(_to_float(progress_metrics.get("current_logging_streak_days")) or _to_float(weekly_stats.get("current_logging_streak_days")) or 0)
    trend = str(progress_metrics.get("trend") or "flat")
    trend_label_en = {"up": "improving", "down": "slipping", "flat": "steady"}.get(trend, "steady")
    trend_label_ar = {"up": "في تحسن", "down": "متراجع", "flat": "ثابت"}.get(trend, "ثابت")
    latest_workout_note = str(recent_workout_notes[0]).strip() if recent_workout_notes else ""
    latest_nutrition_note = str(recent_nutrition_notes[0]).strip() if recent_nutrition_notes else ""
    latest_mood = str(recent_moods[0]).strip() if recent_moods else ""

    if language == "en":
        recommendations = []
        if workout_adherence_percent < 60:
            recommendations.append("Your main bottleneck is consistency. Lock in 2 fixed training slots before adding more volume.")
        elif completion_delta <= 0:
            recommendations.append("Your output is flat versus the previous week. Keep the plan, but make the next 7 days more structured.")
        else:
            recommendations.append("Your activity trend is positive. Keep the same structure and increase load only if recovery stays good.")
        if logging_consistency_percent < 50:
            recommendations.append("Log at least 4 days this week so progress analysis stays reliable.")
        if latest_nutrition_note:
            recommendations.append(f"Nutrition signal: {latest_nutrition_note}")
        elif latest_workout_note:
            recommendations.append(f"Workout signal: {latest_workout_note}")
        parts = [
            f"Progress review: {trend_label_en}.",
            f"Last 7 days: {recent_completed} completed tasks vs {prior_completed} in the previous 7 days ({completion_delta:+d}).",
            f"Workout adherence: {workout_adherence_percent}%.",
            f"Logging consistency: {logging_consistency_percent}%.",
            f"Workout streak: {workout_streak} days. Logging streak: {logging_streak} days.",
        ]
        if latest_workout_note:
            parts.append(f"Latest workout note: {latest_workout_note}")
        if latest_mood:
            parts.append(f"Latest mood/energy note: {latest_mood}")
        parts.append("Recommendations:")
        parts.extend(f"{index}. {text}" for index, text in enumerate(recommendations[:3], start=1))
        return "\n".join(parts)

    if language == "ar_fusha":
        recommendations_ar = []
        if workout_adherence_percent < 60:
            recommendations_ar.append("العائق الرئيسي الآن هو الالتزام. ثبّت يومين تدريب واضحين أولًا قبل زيادة الحجم التدريبي.")
        elif completion_delta <= 0:
            recommendations_ar.append("الأداء ثابت مقارنة بالأسبوع السابق. استمر على الخطة لكن نظّم الأيام السبعة القادمة بشكل أوضح.")
        else:
            recommendations_ar.append("اتجاه النشاط جيد. حافظ على نفس الإيقاع ولا ترفع الحمل إلا إذا كان التعافي جيدًا.")
        if logging_consistency_percent < 50:
            recommendations_ar.append("سجّل 4 أيام على الأقل هذا الأسبوع حتى يبقى تحليل التقدم دقيقًا.")
        if latest_nutrition_note:
            recommendations_ar.append(f"إشارة التغذية الأخيرة: {latest_nutrition_note}")
        elif latest_workout_note:
            recommendations_ar.append(f"إشارة التمرين الأخيرة: {latest_workout_note}")
        parts_ar = [
            f"مراجعة التقدم: {trend_label_ar}.",
            f"آخر 7 أيام: {recent_completed} مهام مكتملة مقابل {prior_completed} في السبعة السابقة ({completion_delta:+d}).",
            f"التزام التمرين: {workout_adherence_percent}%.",
            f"الالتزام بالتسجيل: {logging_consistency_percent}%.",
            f"سلسلة التمرين: {workout_streak} أيام. سلسلة التسجيل: {logging_streak} أيام.",
        ]
        if latest_workout_note:
            parts_ar.append(f"آخر ملاحظة تمرين: {latest_workout_note}")
        if latest_mood:
            parts_ar.append(f"آخر ملاحظة مزاج/طاقة: {latest_mood}")
        parts_ar.append("التوصيات:")
        parts_ar.extend(f"{index}. {text}" for index, text in enumerate(recommendations_ar[:3], start=1))
        return "\n".join(parts_ar)

    recommendations_jo = []
    if workout_adherence_percent < 60:
        recommendations_jo.append("المشكلة الأساسية هسا بالالتزام. ثبّت يومين تمرين ثابتين أول إشي قبل ما تزود الحجم.")
    elif completion_delta <= 0:
        recommendations_jo.append("أداؤك ثابت عن الأسبوع اللي قبله. كمّل على الخطة بس رتّب الأسبوع الجاي بشكل أوضح.")
    else:
        recommendations_jo.append("اتجاهك منيح. خليك على نفس النسق وزيد الحمل فقط إذا التعافي تمام.")
    if logging_consistency_percent < 50:
        recommendations_jo.append("سجل على الأقل 4 أيام هالأسبوع عشان يضل التحليل دقيق.")
    if latest_nutrition_note:
        recommendations_jo.append(f"آخر إشارة تغذية: {latest_nutrition_note}")
    elif latest_workout_note:
        recommendations_jo.append(f"آخر إشارة تمرين: {latest_workout_note}")
    parts_jo = [
        f"مراجعة التقدم: {trend_label_ar}.",
        f"آخر 7 أيام: خلصت {recent_completed} مهام مقابل {prior_completed} بالأسبوع اللي قبله ({completion_delta:+d}).",
        f"التزام التمرين: {workout_adherence_percent}%.",
        f"الالتزام بالتسجيل: {logging_consistency_percent}%.",
        f"ستريك التمرين: {workout_streak} أيام. ستريك التسجيل: {logging_streak} أيام.",
    ]
    if latest_workout_note:
        parts_jo.append(f"آخر ملاحظة تمرين: {latest_workout_note}")
    if latest_mood:
        parts_jo.append(f"آخر ملاحظة مزاج/طاقة: {latest_mood}")
    parts_jo.append("التوصيات:")
    parts_jo.extend(f"{index}. {text}" for index, text in enumerate(recommendations_jo[:3], start=1))
    return "\n".join(parts_jo)


def _performance_analysis_reply(
    language: str,
    profile: dict[str, Any],
    tracking_summary: Optional[dict[str, Any]],
) -> str:
    if not isinstance(tracking_summary, dict):
        return _performance_missing_data_reply(
            language,
            ["goal.type", "goal.current_weight", "goal.target_weight", "weekly_stats.weight_change or weekly_stats.weight_change_history"],
        )

    goal_data = tracking_summary.get("goal") if isinstance(tracking_summary.get("goal"), dict) else {}
    weekly_stats = (
        tracking_summary.get("weekly_stats")
        if isinstance(tracking_summary.get("weekly_stats"), dict)
        else {}
    )
    monthly_stats = (
        tracking_summary.get("monthly_stats")
        if isinstance(tracking_summary.get("monthly_stats"), dict)
        else {}
    )

    goal_type_raw = _dict_get_any(goal_data, ["type", "goal_type"]) or profile.get("goal")
    goal_type = _normalize_goal(goal_type_raw)

    current_weight = _to_float(
        _dict_get_any(goal_data, ["current_weight", "currentWeight", "weight"]) or profile.get("weight")
    )
    target_weight = _to_float(_dict_get_any(goal_data, ["target_weight", "targetWeight"]))

    weekly_weight_change_point = _to_float(
        _dict_get_any(weekly_stats, ["weight_change", "weekly_weight_change", "weightChange"])
    )
    monthly_weight_change = _to_float(_dict_get_any(monthly_stats, ["weight_change", "monthly_weight_change"]))
    weight_change_series_all = _extract_weight_change_series(tracking_summary, weekly_stats)
    weight_change_series_recent = weight_change_series_all[-4:]
    weekly_weight_change = _average(weight_change_series_recent)
    if weekly_weight_change is None and weekly_weight_change_point is not None:
        weekly_weight_change = weekly_weight_change_point
    if weekly_weight_change is None and monthly_weight_change is not None:
        weekly_weight_change = monthly_weight_change / 4.0

    strength_increase_monthly = _to_float(
        _dict_get_any(monthly_stats, ["strength_increase_percent", "strength_increase_pct", "strength_percent"])
    )
    target_strength_increase = _to_float(
        _dict_get_any(goal_data, ["target_strength_increase_percent", "target_strength_percent"])
    )

    workout_days = _to_float(_dict_get_any(weekly_stats, ["workout_days"]))
    planned_days = _to_float(_dict_get_any(weekly_stats, ["planned_days"]))
    avg_calories = _to_float(_dict_get_any(weekly_stats, ["avg_calories", "average_calories"]))
    avg_protein = _to_float(_dict_get_any(weekly_stats, ["avg_protein", "average_protein"]))
    sleep_avg_hours = _to_float(_dict_get_any(weekly_stats, ["sleep_avg_hours", "sleep_hours"]))

    consistency_percent = _to_float(
        _dict_get_any(monthly_stats, ["consistency_percent", "consistency_pct"])
    )
    if consistency_percent is None:
        adherence_score = _to_float(_dict_get_any(tracking_summary, ["adherence_score"]))
        if adherence_score is not None:
            consistency_percent = adherence_score * 100.0

    trend_weeks_count = len(weight_change_series_recent)
    trend_series_text = ", ".join(f"{value:+.2f}" for value in weight_change_series_recent)
    trend_variability = _mean_abs_deviation(weight_change_series_recent)

    missing_fields: list[str] = []
    weight_goal_mode = goal_type == "fat_loss" or target_weight is not None

    if weight_goal_mode:
        if current_weight is None:
            missing_fields.append("goal.current_weight")
        if target_weight is None:
            missing_fields.append("goal.target_weight")
        if weekly_weight_change is None:
            missing_fields.append("weekly_stats.weight_change or weekly_stats.weight_change_history")
    elif goal_type == "muscle_gain":
        if strength_increase_monthly is None and weekly_weight_change is None:
            missing_fields.append("monthly_stats.strength_increase_percent or weekly_stats.weight_change/weight_change_history")
        if target_weight is None and target_strength_increase is None:
            missing_fields.append("goal.target_weight or goal.target_strength_increase_percent")
    else:
        if weekly_weight_change is None and strength_increase_monthly is None:
            missing_fields.append("weekly_stats.weight_change/weight_change_history or monthly_stats.strength_increase_percent")

    if missing_fields:
        progress_metrics = tracking_summary.get("progress_metrics") if isinstance(tracking_summary.get("progress_metrics"), dict) else {}
        if progress_metrics:
            return _activity_progress_analysis_reply(language, tracking_summary)
        if isinstance(tracking_summary, dict) and (
            tracking_summary.get("completed_tasks") is not None
            or tracking_summary.get("adherence_score") is not None
        ):
            return _basic_progress_reply(language, tracking_summary)
        return _performance_missing_data_reply(language, missing_fields)

    status = "on track"
    weeks_remaining: Optional[float] = None
    remaining_weight: Optional[float] = None

    if target_weight is not None and current_weight is not None and weekly_weight_change is not None:
        remaining_weight = target_weight - current_weight
        if abs(remaining_weight) < 0.05:
            status = "ahead of schedule"
            weeks_remaining = 0.0
        elif abs(weekly_weight_change) < 1e-9:
            status = "behind schedule"
        else:
            toward_target = weekly_weight_change * remaining_weight > 0
            if not toward_target:
                status = "behind schedule"
            else:
                weeks_remaining = abs(remaining_weight) / abs(weekly_weight_change)
                weekly_pct = abs(weekly_weight_change) / max(current_weight, 1e-6) * 100.0
                if goal_type == "fat_loss":
                    if weekly_pct > 1.0:
                        status = "ahead of schedule"
                    elif weekly_pct >= 0.25:
                        status = "on track"
                    else:
                        status = "behind schedule"
                elif goal_type == "muscle_gain":
                    if weekly_pct > 0.5:
                        status = "ahead of schedule"
                    elif weekly_pct >= 0.1:
                        status = "on track"
                    else:
                        status = "behind schedule"
                else:
                    status = "on track"

                if trend_weeks_count >= 2:
                    toward_weeks = sum(1 for change in weight_change_series_recent if (change * remaining_weight) > 0)
                    toward_ratio = toward_weeks / trend_weeks_count
                    if toward_ratio < 0.5:
                        status = "behind schedule"
                    elif toward_ratio < 0.75 and status == "ahead of schedule":
                        status = "on track"

                    if trend_variability is not None and abs(weekly_weight_change) > 1e-9:
                        variability_ratio = trend_variability / abs(weekly_weight_change)
                        if variability_ratio > 1.6:
                            status = "behind schedule"
                        elif variability_ratio > 1.1 and status == "ahead of schedule":
                            status = "on track"

    elif goal_type == "muscle_gain" and target_strength_increase is not None and strength_increase_monthly is not None:
        if strength_increase_monthly <= 0:
            status = "behind schedule"
        else:
            strength_remaining = max(0.0, target_strength_increase - strength_increase_monthly)
            weeks_remaining = (strength_remaining / strength_increase_monthly) * 4.0
            if strength_increase_monthly >= 5.0:
                status = "ahead of schedule"
            elif strength_increase_monthly > 0:
                status = "on track"
            else:
                status = "behind schedule"

    if consistency_percent is not None and consistency_percent < 70.0:
        status = "behind schedule"

    status_text = _status_label(language, status)
    weeks_text = "N/A" if weeks_remaining is None else f"{weeks_remaining:.1f}"

    workout_adherence_line = "N/A"
    if workout_days is not None and planned_days is not None and planned_days > 0:
        workout_adherence_line = f"{(workout_days / planned_days) * 100:.0f}% ({int(workout_days)}/{int(planned_days)} days)"

    calorie_target = _to_float(_dict_get_any(weekly_stats, ["target_calories"])) or _to_float(profile.get("target_calories"))
    calorie_delta: Optional[float] = None
    if avg_calories is not None and calorie_target is not None:
        calorie_delta = avg_calories - calorie_target

    recommendations: list[str] = []
    if goal_type == "fat_loss":
        if calorie_delta is not None and calorie_delta > 0:
            recommendations.append(f"Calories: reduce daily intake by ~{int(min(300, max(120, calorie_delta)))} kcal to match deficit target.")
        elif status == "ahead of schedule":
            recommendations.append("Calories: fat loss speed is high; add 100-150 kcal/day to protect recovery and muscle.")
        else:
            recommendations.append("Training volume: keep 10-16 hard sets per major muscle/week; add +2 sets for weak muscles if needed.")
    elif goal_type == "muscle_gain":
        if status == "behind schedule":
            recommendations.append("Volume: increase by +2 to +4 hard sets per target muscle/week and track progressive overload.")
        else:
            recommendations.append("Volume: keep current progression; maintain controlled overload weekly.")
        if calorie_delta is not None and calorie_delta < 0:
            recommendations.append(f"Calories: add ~{int(min(300, max(120, abs(calorie_delta))))} kcal/day to support muscle gain.")
    else:
        recommendations.append("Volume: adjust weekly load by +/-10% based on fatigue and performance trend.")

    if avg_protein is not None and current_weight is not None:
        protein_per_kg = avg_protein / max(current_weight, 1e-6)
        if protein_per_kg < 1.6:
            recommendations.append("Protein: increase toward 1.6-2.2 g/kg/day for better adaptation.")
    if sleep_avg_hours is not None and sleep_avg_hours < 7.0:
        recommendations.append("Recovery: increase sleep to 7-9 h/night to improve strength and body-composition progress.")

    if not recommendations:
        recommendations.append("Keep consistency high and review weekly data before adjusting plan variables.")

    recommendations_block = "\n".join(f"{idx}. {text}" for idx, text in enumerate(recommendations[:3], start=1))

    if trend_weeks_count >= 2:
        rate_line_en = f"Rate of progress (trend last {trend_weeks_count} weeks): {_format_number(weekly_weight_change)} kg/week"
        rate_line_ar_fusha = f"معدل التقدم (اتجاه آخر {trend_weeks_count} أسابيع): {_format_number(weekly_weight_change)} كغ/أسبوع"
        rate_line_ar_jordanian = f"معدل التقدم (اتجاه آخر {trend_weeks_count} أسابيع): {_format_number(weekly_weight_change)} كيلو/أسبوع"
        trend_details_en = f"Recent weekly changes: {trend_series_text} kg/week\n"
        trend_details_ar_fusha = f"تغيرات الأسابيع الأخيرة: {trend_series_text} كغ/أسبوع\n"
        trend_details_ar_jordanian = f"تغيرات آخر الأسابيع: {trend_series_text} كيلو/أسبوع\n"
    else:
        rate_line_en = f"Rate of progress: {_format_number(weekly_weight_change)} kg/week"
        rate_line_ar_fusha = f"معدل التقدم: {_format_number(weekly_weight_change)} كغ/أسبوع"
        rate_line_ar_jordanian = f"معدل التقدم: {_format_number(weekly_weight_change)} كيلو/أسبوع"
        trend_details_en = ""
        trend_details_ar_fusha = ""
        trend_details_ar_jordanian = ""

    if trend_weeks_count == 0:
        if weekly_weight_change_point is not None:
            trend_details_en = "Rate source: single weekly point.\n"
            trend_details_ar_fusha = "مصدر المعدل: نقطة أسبوعية واحدة.\n"
            trend_details_ar_jordanian = "مصدر المعدل: نقطة أسبوعية وحدة.\n"
        elif monthly_weight_change is not None:
            trend_details_en = "Rate source: monthly change divided by 4.\n"
            trend_details_ar_fusha = "مصدر المعدل: التغير الشهري مقسوم على 4.\n"
            trend_details_ar_jordanian = "مصدر المعدل: التغير الشهري مقسوم على 4.\n"

    return _lang_reply(
        language,
        (
            f"Status: {status_text}\n"
            + rate_line_en
            + (f" | Strength: {_format_number(strength_increase_monthly)}%/month" if strength_increase_monthly is not None else "")
            + "\n"
            + trend_details_en
            + (
                f"Remaining weight difference: {_format_number(remaining_weight)} kg\n"
                if remaining_weight is not None
                else ""
            )
            + f"Estimated time to target: {weeks_text} weeks\n"
            + f"Consistency: {_format_number(consistency_percent, 1)}% | Workout adherence: {workout_adherence_line}\n"
            + (
                f"Calories: avg {_format_number(avg_calories, 0)} kcal"
                + (f" vs target {_format_number(calorie_target, 0)} ({_format_number(calorie_delta, 0)} delta)" if calorie_target is not None and calorie_delta is not None else "")
                + "\n"
                if avg_calories is not None
                else ""
            )
            + "Recommendations:\n"
            + recommendations_block
        ),
        (
            f"الحالة: {status_text}\n"
            + rate_line_ar_fusha
            + (f" | القوة: {_format_number(strength_increase_monthly)}%/شهر" if strength_increase_monthly is not None else "")
            + "\n"
            + trend_details_ar_fusha
            + (
                f"فرق الوزن المتبقي: {_format_number(remaining_weight)} كغ\n"
                if remaining_weight is not None
                else ""
            )
            + f"الوقت المتوقع للوصول للهدف: {weeks_text} أسبوع\n"
            + f"نسبة الالتزام: {_format_number(consistency_percent, 1)}% | التزام التمرين: {workout_adherence_line}\n"
            + (
                f"السعرات: متوسط {_format_number(avg_calories, 0)} سعرة"
                + (f" مقابل الهدف {_format_number(calorie_target, 0)} (فرق {_format_number(calorie_delta, 0)})" if calorie_target is not None and calorie_delta is not None else "")
                + "\n"
                if avg_calories is not None
                else ""
            )
            + "التوصيات:\n"
            + recommendations_block
        ),
        (
            f"الحالة: {status_text}\n"
            + rate_line_ar_jordanian
            + (f" | القوة: {_format_number(strength_increase_monthly)}%/شهر" if strength_increase_monthly is not None else "")
            + "\n"
            + trend_details_ar_jordanian
            + (
                f"فرق الوزن المتبقي: {_format_number(remaining_weight)} كيلو\n"
                if remaining_weight is not None
                else ""
            )
            + f"الوقت المتوقع توصل للهدف: {weeks_text} أسبوع\n"
            + f"الالتزام: {_format_number(consistency_percent, 1)}% | التزام التمرين: {workout_adherence_line}\n"
            + (
                f"السعرات: متوسط {_format_number(avg_calories, 0)}"
                + (f" مقابل الهدف {_format_number(calorie_target, 0)} (فرق {_format_number(calorie_delta, 0)})" if calorie_target is not None and calorie_delta is not None else "")
                + "\n"
                if avg_calories is not None
                else ""
            )
            + "التوصيات:\n"
            + recommendations_block
        ),
    )


def _general_llm_reply(
    user_message: str,
    language: str,
    profile: dict[str, Any],
    user_id: Optional[str],
    tracking_summary: Optional[dict[str, Any]],
    memory: MemorySystem,
    state: Optional[dict[str, Any]] = None,
    recent_messages: Optional[list[dict[str, Any]]] = None,
    website_context: Optional[dict[str, Any]] = None,
) -> str:
    language_instructions = {
        "en": "Reply in polished English. Use 0-2 relevant emojis naturally.",
        "ar_fusha": "رد باللغة العربية الفصحى بشكل طبيعي. استخدم من 0 إلى 2 إيموجي مناسب فقط.",
        "ar_jordanian": "احكِ باللهجة الأردنية بشكل واضح وطبيعي. استخدم من 0 إلى 2 إيموجي مناسب فقط.",
    }.get(language, "Reply in English.")

    display_name = _profile_display_name(profile)
    state = state or {}
    plan_snapshot = state.get("plan_snapshot", {})
    nutrition_kb_context = _nutrition_kb_context(user_message, profile, top_k=3)
    normalized_message = normalize_text(user_message)
    short_query = len(normalized_message.split()) <= 8 and len(user_message.strip()) <= 80
    rag_context = _build_general_rag_context(user_message, profile, user_id=user_id, short_query=short_query)

    profile_summary = {
        "name": display_name or "Unknown",
        "goal": profile.get("goal"),
        "gender": profile.get("gender"),
        "age": profile.get("age"),
        "weight": profile.get("weight"),
        "height": profile.get("height"),
        "fitness_level": profile.get("fitness_level") or profile.get("fitnessLevel"),
        "location": profile.get("location"),
        "injuries": profile.get("injuries"),
        "equipment": profile.get("equipment"),
    }
    compact_tracking_summary = {
        "adherence_score": (tracking_summary or {}).get("adherence_score"),
        "completed_last_7_days": (tracking_summary or {}).get("completed_last_7_days"),
        "days_logged_last_7": (tracking_summary or {}).get("days_logged_last_7"),
        "active_workout_plans": (tracking_summary or {}).get("active_workout_plans"),
        "active_nutrition_plans": (tracking_summary or {}).get("active_nutrition_plans"),
        "weekly_stats": (tracking_summary or {}).get("weekly_stats"),
        "recent_completed_exercises": (tracking_summary or {}).get("recent_completed_exercises"),
        "recent_workout_notes": (tracking_summary or {}).get("recent_workout_notes"),
        "recent_nutrition_notes": (tracking_summary or {}).get("recent_nutrition_notes"),
        "recent_moods": (tracking_summary or {}).get("recent_moods"),
    }
    compact_plan_snapshot = {
        "active_workout_plans": (plan_snapshot or {}).get("active_workout_plans"),
        "active_nutrition_plans": (plan_snapshot or {}).get("active_nutrition_plans"),
    }
    max_tokens = 520 if short_query else 1400
    nutrition_context_limit = 1 if short_query else 3
    history_limit = 4 if short_query else 8

    if nutrition_kb_context and short_query:
        nutrition_kb_context = "\n".join(nutrition_kb_context.splitlines()[:4])

    website_context_text = ""
    if website_context:
        try:
            website_context_text = json.dumps(website_context, ensure_ascii=False)
        except TypeError:
            website_context_text = str(website_context)

    system_prompt = (
        "You are a smart, helpful AI assistant with elite fitness coach and nutrition expertise.\n"
        "You can answer general questions as well as fitness, training, sports performance, and nutrition topics.\n"
        "For fitness and nutrition topics, answer with expert-level depth, personalization, and practical coaching.\n"
        "For non-fitness topics, answer clearly and briefly, and do not pretend to have live or real-time data when you do not.\n"
        "Be warm, sharp, practical, and highly personalized.\n"
        "Personalize responses using user profile fields (name, goal, age, height, weight, health constraints).\n"
        "Answer like a strong modern assistant: start with the direct answer, then give the most useful breakdown or steps.\n"
        "When useful, structure the reply with short bullets, action steps, or a mini-plan.\n"
        "Use up to 2 relevant emojis naturally, never spam them.\n"
        "Sound confident and insightful, but never invent facts or pretend certainty when data is missing.\n"
        "For weekly/monthly performance questions, be analytical and numeric.\n"
        "Compare recent data against the goal, calculate the rate of progress, classify status (On track / Ahead / Behind), and estimate weeks remaining when data is sufficient.\n"
        "Never guess missing metrics; explicitly ask for the exact missing fields.\n"
        "When nutrition knowledge snippets are provided in context, prioritize them over generic advice.\n"
        "When RAG retrieval snippets are provided, treat them as primary evidence and do not contradict them unless the user gives newer direct data.\n"
        "If progress is weak or user reports no body change, ask about sleep, hydration, meal adherence, and workout execution before giving final advice.\n"
        "When user asks about exercises, guide them and mention they can use /workouts for muscle-specific exercise explorer.\n"
        "Ground your advice in the provided dataset context, nutrition snippets, and recent messages.\n"
        "When user asks about this website or app, use the provided website context as the source of truth for pages, forms, helper notes, saved note fields, and user flows.\n"
        "When user asks what the app knows about them, inspect the provided profile, tracking summary, plan snapshot, and user_saved_notes before answering.\n"
        "If a requested profile field or note is blank or missing, say it is not recorded yet instead of guessing.\n"
        "Do not generate full workout plans, nutrition plans, or claim a plan was added to Schedule inside normal chat replies. The app handles plan creation, approval, and schedule saving outside the model.\n"
        "Keep responses concise but useful, usually 1 short intro plus 3-6 strong bullets when appropriate.\n"
        "End with one clear next action, question, or recommendation when that improves the answer.\n"
        "Prefer a direct answer over long setup text.\n"
        f"{language_instructions}\n"
    )
    if short_query:
        system_prompt += "For short requests, answer in 2-4 concise sentences or 3 short bullets max.\n"

    context_lines = [
        f"User summary: {profile_summary}",
        f"Tracking summary: {compact_tracking_summary}",
        f"Plan snapshot: {compact_plan_snapshot}",
        f"Plans recently deleted flag: {bool(state.get('plans_recently_deleted', False))}",
    ]
    if nutrition_kb_context:
        context_lines.append("Nutrition reference snippets (from DATAFORPROJECT.pdf):")
        context_lines.append("\n".join(nutrition_kb_context.splitlines()[: nutrition_context_limit * 4]))
    if rag_context:
        context_lines.append(f"Retrieved RAG context:\n{rag_context}")
    if website_context_text:
        context_lines.append(f"Website/app context (JSON): {website_context_text}")
    messages = [{"role": "system", "content": system_prompt + '\n'.join(context_lines)}]

    external_history = _normalize_recent_messages(recent_messages)
    if external_history:
        messages.extend(external_history[-history_limit:])
    else:
        messages.extend(memory.get_conversation_history()[-history_limit:])

    last_history_text = normalize_text(messages[-1]["content"]) if len(messages) > 1 else ""
    if last_history_text != normalize_text(user_message):
        messages.append({"role": "user", "content": user_message})
    return LLM.chat_completion(messages, max_tokens=max_tokens)


@app.get("/health")
def health() -> dict[str, Any]:
    dataset_summary = DATASET_REGISTRY.summary()
    return {
        "status": "ok",
        "provider": LLM.active_provider,
        "model": LLM.active_model,
        "chat_response_mode": CHAT_RESPONSE_MODE,
        "response_dataset_source": str(RESPONSE_DATASET_DIR),
        "nutrition_knowledge_loaded": NUTRITION_KB.ready,
        "nutrition_knowledge_source": str(NUTRITION_KB.data_path),
        "dataset_registry_files": dataset_summary.get("files_count", 0),
        "dataset_registry_generated_at": dataset_summary.get("generated_at"),
        "features": [
            "domain_router",
            "moderation",
            "memory",
            "workout_plans",
            "nutrition_plans",
            "nutrition_knowledge",
            "plan_approval",
            "plan_options",
            "multilingual",
            "tracking_data_extraction",
            "deterministic_performance_analysis",
            "four_week_trend_scoring",
            "ml_goal_prediction",
            "ml_success_prediction",
            "ml_plan_intent_prediction",
            "logic_engine_metrics",
            "dataset_registry_all_files",
        ],
    }


@app.post("/ai/personalized-plan")
async def get_personalized_plan(user_profile: Dict[str, Any]) -> Dict[str, Any]:
    """
    Get a complete personalized fitness & nutrition plan using multi-dataset training.
    
    Args:
        user_profile: User profile with goals, fitness level, health conditions, etc.
        
    Returns:
        Complete personalized plan with workouts, nutrition, expectations
    """
    global training_pipeline
    
    if training_pipeline is None:
        raise HTTPException(
            status_code=503,
            detail="Training pipeline not initialized. Using standard recommender instead."
        )
    
    try:
        plan = training_pipeline.get_personalized_plan(user_profile)
        return {
            "status": "success",
            "plan": plan,
            "source": "multi_dataset_training_system"
        }
    except Exception as e:
        logger.error(f"Error generating personalized plan: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ai/personalized-exercises")
async def get_personalized_exercises(
    user_profile: Dict[str, Any],
    limit: int = Query(10, ge=1, le=50)
) -> Dict[str, Any]:
    """
    Get personalized exercise recommendations ranked by suitability.
    
    Args:
        user_profile: User profile
        limit: Max number of recommendations (1-50)
        
    Returns:
        List of personalized exercises with suitability scores
    """
    global training_pipeline
    
    if training_pipeline is None:
        raise HTTPException(status_code=503, detail="Training pipeline not available")
    
    try:
        exercises = training_pipeline.get_personalized_exercises(user_profile, limit)
        return {
            "status": "success",
            "count": len(exercises),
            "exercises": exercises,
            "source": "multi_dataset_training_system"
        }
    except Exception as e:
        logger.error(f"Error getting personalized exercises: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ai/personalized-foods")
async def get_personalized_foods(
    user_profile: Dict[str, Any],
    limit: int = Query(20, ge=1, le=100)
) -> Dict[str, Any]:
    """
    Get personalized food recommendations ranked by suitability.
    
    Args:
        user_profile: User profile
        limit: Max number of recommendations (1-100)
        
    Returns:
        List of personalized foods with nutritional info and suitability scores
    """
    global training_pipeline
    
    if training_pipeline is None:
        raise HTTPException(status_code=503, detail="Training pipeline not available")
    
    try:
        foods = training_pipeline.get_personalized_foods(user_profile, limit)
        return {
            "status": "success",
            "count": len(foods),
            "foods": foods,
            "source": "multi_dataset_training_system"
        }
    except Exception as e:
        logger.error(f"Error getting personalized foods: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ai/rag-context")
async def build_rag_context(query: str, user_profile: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Build RAG (Retrieval-Augmented Generation) context from training data.
    Use this to enhance LLM responses with relevant dataset information.
    
    Args:
        query: User's query/question
        user_profile: Optional user profile for personalization
        
    Returns:
        Rich context for LLM integration
    """
    global training_pipeline
    
    if training_pipeline is None:
        raise HTTPException(status_code=503, detail="Training pipeline not available")
    
    try:
        context = training_pipeline.build_rag_context(query, user_profile)
        return {
            "status": "success",
            "context": context,
            "source": "multi_dataset_training_system"
        }
    except Exception as e:
        logger.error(f"Error building RAG context: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/ai/training-status")
async def training_status() -> Dict[str, Any]:
    """Get training system status and statistics."""
    global training_pipeline
    
    if training_pipeline is None:
        return {
            "status": "not_initialized",
            "trained": False,
            "message": "Training pipeline not available"
        }
    
    try:
        summary = training_pipeline.get_summary()
        return {
            "status": "ready",
            "trained": summary["trained"],
            **summary
        }
    except Exception as e:
        logger.error(f"Error getting training status: {e}")
        return {
            "status": "error",
            "message": str(e)
        }


@app.get("/datasets/summary")
def datasets_summary() -> dict[str, Any]:
    return {"status": "ok", "summary": DATASET_REGISTRY.summary()}


@app.get("/datasets/search")
def datasets_search(q: str = Query(..., min_length=1), top_k: int = Query(10, ge=1, le=100)) -> dict[str, Any]:
    results = DATASET_REGISTRY.search(q, top_k=top_k)
    return {"status": "ok", "query": q, "count": len(results), "results": results}


@app.get("/datasets/tag/{tag}")
def datasets_by_tag(tag: str) -> dict[str, Any]:
    items = DATASET_REGISTRY.tagged_files(tag)
    slim = [
        {
            "relative_path": item.get("relative_path"),
            "category": item.get("category"),
            "extension": item.get("extension"),
            "size_bytes": item.get("size_bytes"),
            "tags": item.get("tags", []),
        }
        for item in items
    ]
    return {"status": "ok", "tag": tag, "count": len(slim), "files": slim}


@app.post("/ml/predict-goal")
def ml_predict_goal(req: GoalPredictionRequest) -> dict[str, Any]:
    try:
        payload = req.model_dump()
        result = predict_goal(payload)
        return {"status": "ok", "prediction": result}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=f"Goal model unavailable: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Goal prediction failed: {exc}") from exc


@app.post("/ml/predict-success")
def ml_predict_success(req: SuccessPredictionRequest) -> dict[str, Any]:
    try:
        payload = req.model_dump()
        result = predict_success(payload)
        return {"status": "ok", "prediction": result}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=f"Success model unavailable: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Success prediction failed: {exc}") from exc


@app.post("/ml/predict-plan-intent")
def ml_predict_plan_intent(req: PlanIntentPredictionRequest) -> dict[str, Any]:
    try:
        result = predict_plan_intent(req.message)
        return {"status": "ok", "prediction": result}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=f"Plan-intent model unavailable: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Plan-intent prediction failed: {exc}") from exc


@app.post("/logic/evaluate")
def logic_evaluate(req: LogicEvaluationRequest) -> dict[str, Any]:
    try:
        metrics = evaluate_logic_metrics(
            start_value=req.start_value,
            current_value=req.current_value,
            target_value=req.target_value,
            direction=req.direction,
            weight_history=req.weight_history,
            previous_value=req.previous_value,
            elapsed_weeks=req.elapsed_weeks,
        )
        return {"status": "ok", "metrics": metrics.__dict__}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Logic evaluation failed: {exc}") from exc


@app.get("/debug/rag/user/{user_id}")
def debug_rag_user(user_id: str, conversation_id: Optional[str] = Query(default=None)) -> dict[str, Any]:
    normalized_user_id = _normalize_user_id(user_id)
    db_context = _load_database_context(normalized_user_id, conversation_id)
    profile = db_context.get("profile") if isinstance(db_context.get("profile"), dict) else {}
    tracking_summary = db_context.get("tracking_summary") if isinstance(db_context.get("tracking_summary"), dict) else {}
    plan_snapshot = db_context.get("plan_snapshot") if isinstance(db_context.get("plan_snapshot"), dict) else {}
    recent_messages = _normalize_recent_messages(db_context.get("recent_messages"))

    _refresh_persistent_rag_context(
        normalized_user_id,
        profile,
        tracking_summary,
        plan_snapshot,
        None,
        recent_messages,
    )

    namespace = _rag_namespace_for_user(normalized_user_id)
    return {
        "status": "ok",
        "database": repair_mojibake_deep(db_context),
        "namespaces": [
            PERSISTENT_RAG.namespace_stats("app_knowledge"),
            PERSISTENT_RAG.namespace_stats(namespace),
        ],
        "user_documents": repair_mojibake_deep(PERSISTENT_RAG.list_documents(namespace, limit=12)),
        "app_documents": repair_mojibake_deep(PERSISTENT_RAG.list_documents("app_knowledge", limit=8)),
    }


@app.post("/debug/rag/query")
def debug_rag_query(req: RagDebugQueryRequest) -> dict[str, Any]:
    user_id = _normalize_user_id(req.user_id)
    conversation_id = _normalize_conversation_id(req.conversation_id, user_id)
    db_context = _load_database_context(user_id, conversation_id)
    profile = db_context.get("profile") if isinstance(db_context.get("profile"), dict) else {}
    tracking_summary = db_context.get("tracking_summary") if isinstance(db_context.get("tracking_summary"), dict) else {}
    plan_snapshot = db_context.get("plan_snapshot") if isinstance(db_context.get("plan_snapshot"), dict) else {}
    recent_messages = _normalize_recent_messages(db_context.get("recent_messages"))

    _refresh_persistent_rag_context(
        user_id,
        profile,
        tracking_summary,
        plan_snapshot,
        None,
        recent_messages,
    )

    top_k = max(1, min(10, int(req.top_k or 5)))
    return {
        "status": "ok",
        "query": _repair_mojibake(req.query),
        "database": repair_mojibake_deep(db_context),
        "hits": _format_rag_hits_for_debug(user_id, req.query, top_k=top_k),
        "namespaces": [
            PERSISTENT_RAG.namespace_stats("app_knowledge"),
            PERSISTENT_RAG.namespace_stats(_rag_namespace_for_user(user_id)),
        ],
    }


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    user_id = _normalize_user_id(req.user_id)
    conversation_id = _normalize_conversation_id(req.conversation_id, user_id)
    state = _get_user_state(user_id)
    database_context = _load_database_context(user_id, conversation_id)
    database_profile = database_context.get("profile") if isinstance(database_context.get("profile"), dict) else {}
    if database_profile:
        _persist_profile_context(database_profile, state)
    explicit_profile = req.user_profile if isinstance(req.user_profile, dict) else {}
    explicit_keys = set(explicit_profile.keys())
    if "chronicConditions" in explicit_keys:
        explicit_keys.add("chronic_diseases")
    if "fitnessLevel" in explicit_keys:
        explicit_keys.add("fitness_level")
    if "trainingDaysPerWeek" in explicit_keys:
        explicit_keys.add("training_days_per_week")
    if "activityLevel" in explicit_keys:
        explicit_keys.add("activity_level")
    if "equipment" in explicit_keys:
        explicit_keys.add("available_equipment")
    if "dietaryPreferences" in explicit_keys:
        explicit_keys.add("dietary_preferences")
    profile = _build_profile(req, state)
    language = _detect_language(req.language or "en", req.message, profile)
    recent_messages = _merge_recent_messages(database_context.get("recent_messages"), req.recent_messages)

    _persist_profile_context(profile, state, explicit_keys)
    db_tracking_summary = database_context.get("tracking_summary") if isinstance(database_context.get("tracking_summary"), dict) else None
    if db_tracking_summary:
        state["last_progress_summary"] = _merge_tracking_summaries(
            state.get("last_progress_summary"),
            db_tracking_summary,
        )
    if req.tracking_summary:
        state["last_progress_summary"] = _merge_tracking_summaries(
            state.get("last_progress_summary"),
            req.tracking_summary,
        )
    db_plan_snapshot = database_context.get("plan_snapshot") if isinstance(database_context.get("plan_snapshot"), dict) else None
    if db_plan_snapshot:
        _update_plan_snapshot_state(state, db_plan_snapshot)
    _update_plan_snapshot_state(state, req.plan_snapshot)
    tracking_summary = state.get("last_progress_summary")
    _refresh_persistent_rag_context(
        user_id,
        profile,
        tracking_summary,
        state.get("plan_snapshot") or req.plan_snapshot,
        req.website_context,
        recent_messages,
    )

    user_input = _repair_mojibake(req.message.strip())
    if not user_input:
        if CHAT_RESPONSE_MODE == "dataset_only":
            reply = _dataset_intent_response("out_of_scope", language, seed="empty") or _dataset_fallback_reply(
                language, seed="empty"
            )
        else:
            reply = "Please send a valid message." if language == "en" else "أرسل رسالة واضحة."
        return ChatResponse(
            reply=reply,
            conversation_id=conversation_id,
            language=language,
        )

    message_tracking_summary = _extract_tracking_summary_from_message(user_input, profile)
    if message_tracking_summary:
        tracking_summary = _merge_tracking_summaries(tracking_summary, message_tracking_summary)
        state["last_progress_summary"] = tracking_summary
        _refresh_persistent_rag_context(
            user_id,
            profile,
            tracking_summary,
            state.get("plan_snapshot") or req.plan_snapshot,
            req.website_context,
            recent_messages,
        )

    memory = _get_memory_session(user_id, conversation_id)
    memory.add_user_message(user_input)
    _, has_bad_words = MODERATION.filter_content(user_input, language=language)
    if has_bad_words:
        if CHAT_RESPONSE_MODE == "dataset_only":
            fallback = _dataset_intent_response("out_of_scope", language, seed=user_input) or _dataset_fallback_reply(
                language, seed=user_input
            )
        else:
            fallback = MODERATION.get_safe_fallback(language)
        memory.add_assistant_message(fallback)
        return ChatResponse(reply=fallback, conversation_id=conversation_id, language=language)

    routing_input = _normalize_routing_input(user_input)
    lowered = normalize_text(routing_input)

    pending_options_payload = state.get("pending_plan_options")
    if pending_options_payload:
        pending_conv = pending_options_payload.get("conversation_id")
        if pending_conv and pending_conv != conversation_id:
            state["pending_plan_options"] = None
            pending_options_payload = None
    if pending_options_payload:
        pending_options = pending_options_payload.get("options", [])
        pending_all_options = pending_options_payload.get("all_options", pending_options)
        pending_options_type = str(pending_options_payload.get("plan_type", "workout"))
        pending_page = int(pending_options_payload.get("page", 0) or 0)
        pending_total_pages = int(pending_options_payload.get("total_pages", 1) or 1)
        pending_total_options = int(pending_options_payload.get("total_options", len(pending_all_options)) or len(pending_all_options))
        selected_idx = _extract_plan_choice_index(user_input, len(pending_options))

        if selected_idx is not None:
            selected_plan = deepcopy(pending_options[selected_idx])
            plan_id = selected_plan["id"]
            PENDING_PLANS[plan_id] = {
                "user_id": user_id,
                "conversation_id": conversation_id,
                "plan_type": pending_options_type,
                "plan": selected_plan,
                "approved": False,
                "created_at": datetime.utcnow().isoformat(),
            }
            state["last_pending_plan_id"] = plan_id
            state["pending_plan_options"] = None
            state["pending_plan_type"] = None

            reply = _format_plan_preview(pending_options_type, selected_plan, language)
            memory.add_assistant_message(reply)
            return ChatResponse(
                reply=reply,
                conversation_id=conversation_id,
                language=language,
                action="ask_plan",
                data={"plan_id": plan_id, "plan_type": pending_options_type, "plan": selected_plan},
            )

        if _contains_any(routing_input, PLAN_REFRESH_KEYWORDS):
            next_payload = _build_pending_plan_options_state(
                pending_options_type,
                pending_all_options,
                conversation_id,
                page=pending_page + 1,
            )
            state["pending_plan_options"] = next_payload
            reply = _format_plan_options_preview(
                pending_options_type,
                next_payload["options"],
                language,
                page=next_payload["page"],
                total_pages=next_payload["total_pages"],
                total_options=next_payload["total_options"],
            )
            memory.add_assistant_message(reply)
            return ChatResponse(
                reply=reply,
                conversation_id=conversation_id,
                language=language,
                action="choose_plan",
                data={
                    "plan_type": pending_options_type,
                    "options_count": len(next_payload["options"]),
                    "total_options": next_payload["total_options"],
                    "page": next_payload["page"],
                    "total_pages": next_payload["total_pages"],
                },
            )

        reply = _format_plan_options_preview(
            pending_options_type,
            pending_options,
            language,
            page=pending_page,
            total_pages=pending_total_pages,
            total_options=pending_total_options,
        )
        memory.add_assistant_message(reply)
        return ChatResponse(
            reply=reply,
            conversation_id=conversation_id,
            language=language,
            action="choose_plan",
            data={
                "plan_type": pending_options_type,
                "options_count": len(pending_options),
                "total_options": pending_total_options,
                "page": pending_page,
                "total_pages": pending_total_pages,
            },
        )

    latest_plan_id = state.get("last_pending_plan_id")
    if latest_plan_id and latest_plan_id in PENDING_PLANS:
        if _contains_any(lowered, APPROVE_KEYWORDS):
            plan_record = PENDING_PLANS[latest_plan_id]
            plan_record["approved"] = True
            state["last_pending_plan_id"] = None
            if language == "en":
                reply = "Plan approved. I added it for your schedule flow. You can track completion daily."
            elif language == "ar_fusha":
                reply = "تم اعتماد الخطة. يمكنك الآن متابعتها يوميًا داخل صفحة الجدول."
            else:
                reply = "تم اعتماد الخطة. هلا بتقدر تتابعها يوم بيوم بصفحة الجدول."
            memory.add_assistant_message(reply)
            return ChatResponse(
                reply=reply,
                conversation_id=conversation_id,
                language=language,
                action="plan_approved",
                data={
                    "plan_id": latest_plan_id,
                    "approved_plan": {
                        "type": plan_record["plan_type"],
                        "plan": plan_record["plan"],
                    },
                },
            )
        if _contains_any(lowered, REJECT_KEYWORDS):
            state["last_pending_plan_id"] = None
            if language == "en":
                reply = "No problem. I canceled this draft. Tell me what to change and I will regenerate it."
            elif language == "ar_fusha":
                reply = "لا مشكلة. ألغيت هذه المسودة. أخبرني ما الذي تريد تغييره وسأعيد التوليد."
            else:
                reply = "تمام، لغيت المسودة. احكيلي شو بدك أغير وبرجع ببنيها."
            memory.add_assistant_message(reply)
            return ChatResponse(
                reply=reply,
                conversation_id=conversation_id,
                language=language,
                action="plan_rejected",
                data={"plan_id": latest_plan_id},
            )

    # Strict dataset mode:
    # - Chat replies are sourced only from conversation_intents.json.
    # - Plan options are sourced only from workout_programs.json / nutrition_programs.json.
    # - Legacy non-dataset flows are disabled.
    state["pending_field"] = None
    state["pending_plan_type"] = None
    state["pending_diagnostic"] = None
    state["pending_diagnostic_conversation_id"] = None

    requested_plan_type, plan_intent_meta = _resolve_plan_type_from_message(
        routing_input,
        recent_messages=recent_messages,
        memory=memory,
    )
    if requested_plan_type in {"workout", "nutrition"}:
        inferred_goal, inferred_confidence, inferred_by_ml = _infer_goal_for_plan(profile, tracking_summary)
        plan_profile = dict(profile)
        plan_profile["goal"] = inferred_goal

        if requested_plan_type == "workout":
            options = _generate_workout_plan_options(plan_profile, language, count=PLAN_OPTION_POOL_TARGET)
        else:
            options = _generate_nutrition_plan_options(plan_profile, language, count=PLAN_OPTION_POOL_TARGET)

        if not options:
            reply = _dataset_intent_response("out_of_scope", language, seed=user_input) or _dataset_fallback_reply(
                language, seed=user_input
            )
            memory.add_assistant_message(reply)
            return ChatResponse(reply=reply, conversation_id=conversation_id, language=language)

        pending_payload = _build_pending_plan_options_state(requested_plan_type, options, conversation_id)
        state["pending_plan_options"] = pending_payload
        if inferred_by_ml:
            state["inferred_goal"] = inferred_goal

        reply = _format_plan_options_preview(
            requested_plan_type,
            pending_payload["options"],
            language,
            page=pending_payload["page"],
            total_pages=pending_payload["total_pages"],
            total_options=pending_payload["total_options"],
        )

        info_lines: list[str] = []
        if inferred_by_ml:
            goal_label = _profile_goal_label(inferred_goal, language)
            conf_text = (
                f" ({_format_number((inferred_confidence or 0.0) * 100, 1)}%)"
                if inferred_confidence is not None
                else ""
            )
            info_lines.append(
                _lang_reply(
                    language,
                    f"Auto-inferred goal from training data: {goal_label}{conf_text}.",
                    f"تم استنتاج الهدف تلقائيًا من بيانات التدريب: {goal_label}{conf_text}.",
                    f"استنتجت هدفك تلقائيًا من بيانات التدريب: {goal_label}{conf_text}.",
                )
            )

        if plan_intent_meta:
            predicted_intent = str(plan_intent_meta.get("predicted_intent", requested_plan_type))
            intent_confidence = _to_float(plan_intent_meta.get("confidence"))
            conf_text = (
                f" ({_format_number((intent_confidence or 0.0) * 100, 1)}%)"
                if intent_confidence is not None
                else ""
            )
            if _is_generic_plan_request(routing_input):
                info_lines.append(
                    _lang_reply(
                        language,
                        f"Detected plan type automatically: {predicted_intent}{conf_text}.",
                        f"تم تحديد نوع الخطة تلقائيًا: {predicted_intent}{conf_text}.",
                        f"حددّت نوع الخطة تلقائيًا: {predicted_intent}{conf_text}.",
                    )
                )

        if info_lines:
            reply = "\n".join(info_lines + [reply])

        memory.add_assistant_message(reply)
        return ChatResponse(
            reply=reply,
            conversation_id=conversation_id,
            language=language,
            action="choose_plan",
            data={
                "plan_type": requested_plan_type,
                "options_count": len(pending_payload["options"]),
                "total_options": pending_payload["total_options"],
                "page": pending_payload["page"],
                "total_pages": pending_payload["total_pages"],
                "inferred_goal": inferred_goal,
                "inferred_goal_confidence": inferred_confidence,
                "plan_intent_prediction": plan_intent_meta or {},
            },
        )

    if CHAT_RESPONSE_MODE == "dataset_only":
        dataset_reply = _dataset_conversation_reply(routing_input, language)
        if dataset_reply:
            memory.add_assistant_message(dataset_reply)
            return ChatResponse(reply=dataset_reply, conversation_id=conversation_id, language=language)

        out_reply = _dataset_intent_response("out_of_scope", language, seed=user_input) or _dataset_fallback_reply(
            language, seed=user_input
        )
        memory.add_assistant_message(out_reply)
        return ChatResponse(reply=out_reply, conversation_id=conversation_id, language=language)

    ml_prediction_payload = _ml_prediction_chat_response(routing_input, language, profile, tracking_summary)
    if ml_prediction_payload:
        ml_reply, ml_data = ml_prediction_payload
        state["last_ml_prediction"] = ml_data
        memory.add_assistant_message(ml_reply)
        return ChatResponse(
            reply=ml_reply,
            conversation_id=conversation_id,
            language=language,
            action="ml_prediction",
            data=ml_data,
        )

    # Handle numeric progress/performance analysis before routing decisions.
    if _is_performance_analysis_request(routing_input, message_tracking_summary):
        performance_reply = _performance_analysis_reply(language, profile, tracking_summary)
        memory.add_assistant_message(performance_reply)
        return ChatResponse(reply=performance_reply, conversation_id=conversation_id, language=language)

    if CHAT_RESPONSE_MODE != "dataset_only":
        contextual_followup_reply = _contextual_followup_reply(user_input, language, recent_messages, memory)
        if contextual_followup_reply:
            memory.add_assistant_message(contextual_followup_reply)
            return ChatResponse(reply=contextual_followup_reply, conversation_id=conversation_id, language=language)

        if _is_name_query(user_input):
            reply = _name_reply(language)
            memory.add_assistant_message(reply)
            return ChatResponse(reply=reply, conversation_id=conversation_id, language=language)

        if _is_how_are_you_query(user_input):
            reply = _how_are_you_reply(language)
            memory.add_assistant_message(reply)
            return ChatResponse(reply=reply, conversation_id=conversation_id, language=language)

        if _is_greeting_query(user_input):
            reply = _greeting_reply(language, profile)
            memory.add_assistant_message(reply)
            return ChatResponse(reply=reply, conversation_id=conversation_id, language=language)

        social_reply = _social_reply(user_input, language, profile)
        if social_reply:
            memory.add_assistant_message(social_reply)
            return ChatResponse(reply=social_reply, conversation_id=conversation_id, language=language)

        profile_reply = _profile_query_reply(user_input, language, profile, tracking_summary)
        if profile_reply:
            memory.add_assistant_message(profile_reply)
            return ChatResponse(reply=profile_reply, conversation_id=conversation_id, language=language)

        if _contains_any(lowered, PLAN_STATUS_KEYWORDS):
            status_reply = _plan_status_reply(language, state.get("plan_snapshot"))
            memory.add_assistant_message(status_reply)
            return ChatResponse(reply=status_reply, conversation_id=conversation_id, language=language)

        if not _conversation_replies_should_use_llm():
            dataset_reply = _dataset_conversation_reply(routing_input, language)
            if dataset_reply:
                memory.add_assistant_message(dataset_reply)
                return ChatResponse(reply=dataset_reply, conversation_id=conversation_id, language=language)

        quick_nutrition_reply = _quick_nutrition_reply(user_input, language, profile)
        if quick_nutrition_reply:
            filtered_reply, _ = MODERATION.filter_content(quick_nutrition_reply, language=language)
            memory.add_assistant_message(filtered_reply)
            return ChatResponse(reply=filtered_reply, conversation_id=conversation_id, language=language)

        in_domain = _in_domain_or_strong_fitness_query(routing_input, language)
        if (not in_domain) and _looks_like_contextual_followup(user_input):
            in_domain = _recent_history_is_fitness_related(recent_messages, memory)
        if not in_domain:
            if _conversation_replies_should_use_llm():
                llm_reply = _general_llm_reply(
                    user_message=user_input,
                    language=language,
                    profile=profile,
                    user_id=user_id,
                    tracking_summary=tracking_summary,
                    memory=memory,
                    state=state,
                    recent_messages=recent_messages,
                    website_context=req.website_context,
                )
                if llm_reply.startswith("Ollama error:") or llm_reply.startswith("Ollama is not reachable"):
                    llm_reply = _ollama_unavailable_reply(language)

                llm_plan_type = _detect_generated_plan_type(llm_reply)
                if llm_plan_type:
                    return _build_pending_plan_response(
                        llm_plan_type,
                        profile,
                        tracking_summary,
                        language,
                        user_id,
                        conversation_id,
                        state,
                        memory,
                    )

                filtered_reply, _ = MODERATION.filter_content(llm_reply, language=language)
                memory.add_assistant_message(filtered_reply)
                return ChatResponse(reply=filtered_reply, conversation_id=conversation_id, language=language)

            out_reply = _strict_out_of_scope_reply(language)
            memory.add_assistant_message(out_reply)
            return ChatResponse(reply=out_reply, conversation_id=conversation_id, language=language)

        # Hybrid mode may still use short deterministic replies, but llm/smart mode
        # keeps normal in-domain gym conversation on the model.
        dataset_reply = _dataset_conversation_reply(routing_input, language)
        if dataset_reply and (not _conversation_replies_should_use_llm()) and _dataset_short_reply_allowed(routing_input):
            memory.add_assistant_message(dataset_reply)
            return ChatResponse(reply=dataset_reply, conversation_id=conversation_id, language=language)

        llm_reply = _general_llm_reply(
            user_message=user_input,
            language=language,
            profile=profile,
            user_id=user_id,
            tracking_summary=tracking_summary,
            memory=memory,
            state=state,
            recent_messages=recent_messages,
            website_context=req.website_context,
        )
        if llm_reply.startswith("Ollama error:") or llm_reply.startswith("Ollama is not reachable"):
            llm_reply = _ollama_unavailable_reply(language)

        llm_plan_type = _detect_generated_plan_type(llm_reply)
        if llm_plan_type:
            return _build_pending_plan_response(
                llm_plan_type,
                profile,
                tracking_summary,
                language,
                user_id,
                conversation_id,
                state,
                memory,
            )

        filtered_reply, _ = MODERATION.filter_content(llm_reply, language=language)
        memory.add_assistant_message(filtered_reply)
        return ChatResponse(reply=filtered_reply, conversation_id=conversation_id, language=language)

    dataset_reply = _dataset_conversation_reply(user_input, language)
    if dataset_reply:
        memory.add_assistant_message(dataset_reply)
        return ChatResponse(reply=dataset_reply, conversation_id=conversation_id, language=language)

    out_reply = _dataset_intent_response("out_of_scope", language, seed=user_input) or _dataset_fallback_reply(
        language, seed=user_input
    )
    memory.add_assistant_message(out_reply)
    return ChatResponse(reply=out_reply, conversation_id=conversation_id, language=language)

    pending_field = state.get("pending_field")
    if pending_field:
        if _apply_profile_answer(pending_field, user_input, state):
            state["pending_field"] = None
            pending_plan_type = state.get("pending_plan_type")
            profile = _build_profile(req, state)
            if pending_plan_type:
                missing = _missing_fields_for_plan(pending_plan_type, profile)
                if missing:
                    state["pending_field"] = missing[0]
                    question = _missing_field_question(missing[0], language)
                    memory.add_assistant_message(question)
                    return ChatResponse(
                        reply=question,
                        conversation_id=conversation_id,
                        language=language,
                        action="ask_profile",
                        data={"missing_field": missing[0], "plan_type": pending_plan_type},
                    )
                if pending_plan_type == "workout":
                    options = _generate_workout_plan_options(profile, language, count=PLAN_OPTION_POOL_TARGET)
                else:
                    options = _generate_nutrition_plan_options(profile, language, count=PLAN_OPTION_POOL_TARGET)

                pending_payload = _build_pending_plan_options_state(pending_plan_type, options, conversation_id)
                state["pending_plan_options"] = pending_payload
                state["pending_plan_type"] = None
                reply = _format_plan_options_preview(
                    pending_plan_type,
                    pending_payload["options"],
                    language,
                    page=pending_payload["page"],
                    total_pages=pending_payload["total_pages"],
                    total_options=pending_payload["total_options"],
                )
                memory.add_assistant_message(reply)
                return ChatResponse(
                    reply=reply,
                    conversation_id=conversation_id,
                    language=language,
                    action="choose_plan",
                    data={
                        "plan_type": pending_plan_type,
                        "options_count": len(pending_payload["options"]),
                        "total_options": pending_payload["total_options"],
                        "page": pending_payload["page"],
                        "total_pages": pending_payload["total_pages"],
                    },
                )
        else:
            question = _missing_field_question(pending_field, language)
            memory.add_assistant_message(question)
            return ChatResponse(
                reply=question,
                conversation_id=conversation_id,
                language=language,
                action="ask_profile",
                data={"missing_field": pending_field, "plan_type": state.get("pending_plan_type")},
            )

    pending_diagnostic = state.get("pending_diagnostic")
    pending_diagnostic_conversation_id = state.get("pending_diagnostic_conversation_id")
    if pending_diagnostic and pending_diagnostic_conversation_id and pending_diagnostic_conversation_id != conversation_id:
        pending_diagnostic = None
    if pending_diagnostic and not _contains_any(lowered, PROGRESS_CONCERN_KEYWORDS | TROUBLESHOOT_KEYWORDS):
        diag_in_domain, _ = ROUTER.is_in_domain(user_input, language=language)
        if not diag_in_domain:
            state["pending_diagnostic"] = None
            state["pending_diagnostic_conversation_id"] = None
            out_reply = _dataset_intent_response("out_of_scope", language, seed=user_input) or _dataset_fallback_reply(
                language, seed=user_input
            )
            memory.add_assistant_message(out_reply)
            return ChatResponse(reply=out_reply, conversation_id=conversation_id, language=language)

        if pending_diagnostic == "progress":
            prompt = (
                "The user answered my progress-diagnostic questions. "
                "Analyze likely bottlenecks (sleep, hydration, nutrition adherence, execution) "
                "and give a concrete fix for the next 7 days."
            )
        else:
            prompt = (
                "The user answered my exercise-diagnostic questions. "
                "Identify likely form/load issue, provide corrective cues, safer load adjustment, "
                "and when to stop and seek in-person assessment."
            )
        diagnostic_reply = _general_llm_reply(
            user_message=f"{prompt}\n\nUser answer: {user_input}",
            language=language,
            profile=profile,
            user_id=user_id,
            tracking_summary=tracking_summary,
            memory=memory,
            state=state,
            recent_messages=recent_messages,
        )
        state["pending_diagnostic"] = None
        state["pending_diagnostic_conversation_id"] = None
        filtered_diagnostic, _ = MODERATION.filter_content(diagnostic_reply, language=language)
        memory.add_assistant_message(filtered_diagnostic)
        return ChatResponse(reply=filtered_diagnostic, conversation_id=conversation_id, language=language)

    # Strict dataset mode:
    # - Conversational replies must come from conversation_intents.json
    # - Plan content must come from workout_programs.json / nutrition_programs.json
    # - Any unmatched general message gets out_of_scope from the dataset.
    is_plan_request = _is_workout_plan_request(user_input) or _is_nutrition_plan_request(user_input)
    if not is_plan_request:
        dataset_reply = _dataset_conversation_reply(user_input, language)
        if dataset_reply:
            memory.add_assistant_message(dataset_reply)
            return ChatResponse(reply=dataset_reply, conversation_id=conversation_id, language=language)

        out_reply = _dataset_intent_response("out_of_scope", language, seed=user_input) or _dataset_fallback_reply(
            language, seed=user_input
        )
        memory.add_assistant_message(out_reply)
        return ChatResponse(reply=out_reply, conversation_id=conversation_id, language=language)

    if _is_greeting_query(user_input):
        reply = _greeting_reply(language, profile)
        memory.add_assistant_message(reply)
        return ChatResponse(reply=reply, conversation_id=conversation_id, language=language)

    if _is_name_query(user_input):
        reply = _name_reply(language)
        memory.add_assistant_message(reply)
        return ChatResponse(reply=reply, conversation_id=conversation_id, language=language)

    if _is_how_are_you_query(user_input):
        reply = _how_are_you_reply(language)
        memory.add_assistant_message(reply)
        return ChatResponse(reply=reply, conversation_id=conversation_id, language=language)

    latest_plan_id = state.get("last_pending_plan_id")
    if latest_plan_id and latest_plan_id in PENDING_PLANS:
        if _contains_any(lowered, APPROVE_KEYWORDS):
            plan_record = PENDING_PLANS[latest_plan_id]
            plan_record["approved"] = True
            state["last_pending_plan_id"] = None
            if language == "en":
                reply = "Plan approved. I added it for your schedule flow. You can track completion daily."
            elif language == "ar_fusha":
                reply = "تم اعتماد الخطة. يمكنك الآن متابعتها يوميًا داخل صفحة الجدول."
            else:
                reply = "تم اعتماد الخطة. هلا بتقدر تتابعها يوم بيوم بصفحة الجدول."
            memory.add_assistant_message(reply)
            return ChatResponse(
                reply=reply,
                conversation_id=conversation_id,
                language=language,
                action="plan_approved",
                data={
                    "plan_id": latest_plan_id,
                    "approved_plan": {
                        "type": plan_record["plan_type"],
                        "plan": plan_record["plan"],
                    },
                },
            )
        if _contains_any(lowered, REJECT_KEYWORDS):
            state["last_pending_plan_id"] = None
            if language == "en":
                reply = "No problem. I canceled this draft. Tell me what to change and I will regenerate it."
            elif language == "ar_fusha":
                reply = "لا مشكلة. ألغيت هذه المسودة. أخبرني ما الذي تريد تغييره وسأعيد التوليد."
            else:
                reply = "تمام، لغيت المسودة. احكيلي شو بدك أغير وبرجع ببنيها."
            memory.add_assistant_message(reply)
            return ChatResponse(
                reply=reply,
                conversation_id=conversation_id,
                language=language,
                action="plan_rejected",
                data={"plan_id": latest_plan_id},
            )

    social_reply = _social_reply(user_input, language, profile)
    if social_reply:
        memory.add_assistant_message(social_reply)
        return ChatResponse(reply=social_reply, conversation_id=conversation_id, language=language)

    profile_reply = _profile_query_reply(user_input, language, profile, tracking_summary)
    if profile_reply:
        memory.add_assistant_message(profile_reply)
        return ChatResponse(reply=profile_reply, conversation_id=conversation_id, language=language)

    if _contains_any(lowered, PLAN_STATUS_KEYWORDS):
        status_reply = _plan_status_reply(language, state.get("plan_snapshot"))
        memory.add_assistant_message(status_reply)
        return ChatResponse(reply=status_reply, conversation_id=conversation_id, language=language)

    if _is_performance_analysis_request(user_input, message_tracking_summary):
        performance_reply = _performance_analysis_reply(language, profile, tracking_summary)
        memory.add_assistant_message(performance_reply)
        return ChatResponse(reply=performance_reply, conversation_id=conversation_id, language=language)

    if _contains_any(lowered, PROGRESS_CONCERN_KEYWORDS):
        state["pending_diagnostic"] = "progress"
        state["pending_diagnostic_conversation_id"] = conversation_id
        response = _progress_diagnostic_reply(language, profile, tracking_summary)
        memory.add_assistant_message(response)
        return ChatResponse(reply=response, conversation_id=conversation_id, language=language)

    if _contains_any(lowered, TROUBLESHOOT_KEYWORDS):
        state["pending_diagnostic"] = "exercise"
        state["pending_diagnostic_conversation_id"] = conversation_id
        response = _exercise_diagnostic_reply(language)
        memory.add_assistant_message(response)
        return ChatResponse(reply=response, conversation_id=conversation_id, language=language)

    in_domain, _score = ROUTER.is_in_domain(user_input, language=language)
    if not in_domain:
        out_reply = _dataset_intent_response("out_of_scope", language, seed=user_input) or _dataset_fallback_reply(
            language, seed=user_input
        )
        memory.add_assistant_message(out_reply)
        return ChatResponse(reply=out_reply, conversation_id=conversation_id, language=language)

    if _is_workout_plan_request(user_input):
        state["pending_plan_type"] = "workout"
        profile = _build_profile(req, state)
        missing = _missing_fields_for_plan("workout", profile)
        if missing:
            state["pending_field"] = missing[0]
            question = _missing_field_question(missing[0], language)
            memory.add_assistant_message(question)
            return ChatResponse(
                reply=question,
                conversation_id=conversation_id,
                language=language,
                action="ask_profile",
                data={"missing_field": missing[0], "plan_type": "workout"},
            )

        options = _generate_workout_plan_options(profile, language, count=PLAN_OPTION_POOL_TARGET)
        pending_payload = _build_pending_plan_options_state("workout", options, conversation_id)
        state["pending_plan_options"] = pending_payload
        state["pending_plan_type"] = None
        reply = _format_plan_options_preview(
            "workout",
            pending_payload["options"],
            language,
            page=pending_payload["page"],
            total_pages=pending_payload["total_pages"],
            total_options=pending_payload["total_options"],
        )
        memory.add_assistant_message(reply)
        return ChatResponse(
            reply=reply,
            conversation_id=conversation_id,
            language=language,
            action="choose_plan",
            data={
                "plan_type": "workout",
                "options_count": len(pending_payload["options"]),
                "total_options": pending_payload["total_options"],
                "page": pending_payload["page"],
                "total_pages": pending_payload["total_pages"],
            },
        )

    if _is_nutrition_plan_request(user_input):
        state["pending_plan_type"] = "nutrition"
        profile = _build_profile(req, state)
        missing = _missing_fields_for_plan("nutrition", profile)
        if missing:
            state["pending_field"] = missing[0]
            question = _missing_field_question(missing[0], language)
            memory.add_assistant_message(question)
            return ChatResponse(
                reply=question,
                conversation_id=conversation_id,
                language=language,
                action="ask_profile",
                data={"missing_field": missing[0], "plan_type": "nutrition"},
            )

        options = _generate_nutrition_plan_options(profile, language, count=PLAN_OPTION_POOL_TARGET)
        pending_payload = _build_pending_plan_options_state("nutrition", options, conversation_id)
        state["pending_plan_options"] = pending_payload
        state["pending_plan_type"] = None
        reply = _format_plan_options_preview(
            "nutrition",
            pending_payload["options"],
            language,
            page=pending_payload["page"],
            total_pages=pending_payload["total_pages"],
            total_options=pending_payload["total_options"],
        )
        memory.add_assistant_message(reply)
        return ChatResponse(
            reply=reply,
            conversation_id=conversation_id,
            language=language,
            action="choose_plan",
            data={
                "plan_type": "nutrition",
                "options_count": len(pending_payload["options"]),
                "total_options": pending_payload["total_options"],
                "page": pending_payload["page"],
                "total_pages": pending_payload["total_pages"],
            },
        )

    if _contains_any(lowered, PROGRESS_KEYWORDS):
        reply = _tracking_reply(language, tracking_summary)
        memory.add_assistant_message(reply)
        return ChatResponse(reply=reply, conversation_id=conversation_id, language=language)

    if _contains_any(
        user_input,
        {
            "exercise",
            "exercises",
            "muscle",
            "workout",
            "train",
            "تمرين",
            "تمارين",
            "اتمرن",
            "تمرن",
            "كيفية التمرين",
            "عضلة",
            "عضلات",
            "الصدر",
            "الظهر",
            "الكتف",
            "الأكتاف",
            "الأرجل",
            "الرجل",
            "الساق",
            "البطن",
        },
    ):
        reply = _exercise_reply(user_input, language)
        memory.add_assistant_message(reply)
        return ChatResponse(
            reply=reply,
            conversation_id=conversation_id,
            language=language,
            action="exercise_results",
            data={"redirect_to": "/workouts"},
        )

    llm_reply = _general_llm_reply(
        user_message=user_input,
        language=language,
        profile=profile,
        user_id=user_id,
        tracking_summary=tracking_summary,
        memory=memory,
        state=state,
        recent_messages=recent_messages,
    )
    if llm_reply.startswith("Ollama error:"):
        llm_reply = _lang_reply(
            language,
            "Local AI model is temporarily unavailable. Please make sure Ollama is running, then try again.",
            "نموذج الذكاء المحلي غير متاح مؤقتًا. تأكد من تشغيل Ollama ثم أعد المحاولة.",
            "نموذج الذكاء المحلي واقف مؤقتًا. شغّل Ollama وارجع جرّب.",
        )
    filtered_reply, _ = MODERATION.filter_content(llm_reply, language=language)
    memory.add_assistant_message(filtered_reply)
    return ChatResponse(reply=filtered_reply, conversation_id=conversation_id, language=language)


@app.post("/voice-chat", response_model=VoiceChatResponse)
async def voice_chat(
    audio: UploadFile = File(...),
    language: str = Form("en"),
    user_id: Optional[str] = Form(None),
    conversation_id: Optional[str] = Form(None),
    website_context: Optional[str] = Form(None),
) -> VoiceChatResponse:
    uid = _normalize_user_id(user_id)
    conv_id = _normalize_conversation_id(conversation_id, uid)
    lang = "ar" if (language or "").lower().startswith("ar") else "en"
    parsed_website_context: Optional[dict[str, Any]] = None
    if website_context:
        try:
            payload = json.loads(website_context)
            if isinstance(payload, dict):
                parsed_website_context = payload
        except Exception:
            parsed_website_context = None

    if audio.content_type and not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an audio format.")

    suffix = Path(audio.filename or "").suffix.lower() or ".wav"
    input_audio_path = STATIC_AUDIO_DIR / f"input_{uuid.uuid4().hex}{suffix}"
    voice_chat_payload: Optional[ChatResponse] = None

    try:
        with input_audio_path.open("wb") as out_file:
            shutil.copyfileobj(audio.file, out_file)

        async def voice_responder(
            transcript: str,
            voice_language: str,
            voice_user_id: Optional[str],
            voice_conversation_id: Optional[str],
        ) -> tuple[str, Optional[str]]:
            nonlocal voice_chat_payload
            chat_req = ChatRequest(
                message=transcript,
                user_id=voice_user_id,
                conversation_id=voice_conversation_id,
                language=voice_language,
                website_context=parsed_website_context,
            )
            voice_chat_payload = await chat(chat_req)
            return voice_chat_payload.reply, voice_chat_payload.conversation_id

        result: VoicePipelineResult = await VOICE_PIPELINE.run(
            audio_path=input_audio_path,
            language=lang,
            user_id=uid,
            conversation_id=conv_id,
            llm_responder=voice_responder,
        )

        return VoiceChatResponse(
            transcript=result.transcript,
            reply=result.reply_text,
            audio_path=result.audio_url,
            conversation_id=result.conversation_id or conv_id,
            language=lang,
            action=voice_chat_payload.action if voice_chat_payload else None,
            data=voice_chat_payload.data if voice_chat_payload else None,
        )
    except VoicePipelineError as exc:
        logger.warning("VOICE_CHAT_PIPELINE_ERROR user=%s conv=%s msg=%s", uid, conv_id, str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("VOICE_CHAT_UNKNOWN_ERROR user=%s conv=%s", uid, conv_id)
        raise HTTPException(status_code=500, detail="Voice chat failed unexpectedly.") from exc
    finally:
        try:
            audio.file.close()
        except Exception:
            pass
        try:
            input_audio_path.unlink(missing_ok=True)
        except Exception:
            pass


@app.post("/tts/speak", response_model=TextToSpeechResponse)
async def tts_speak(request: TextToSpeechRequest) -> TextToSpeechResponse:
    text = _repair_mojibake((request.text or "").strip())
    if not text:
        raise HTTPException(status_code=400, detail="Text is required for TTS.")

    lang = "ar" if (request.language or "").lower().startswith("ar") else "en"

    try:
        audio_output_path = await asyncio.to_thread(VOICE_TTS.synthesize, text, lang)
    except TTSError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("TTS_SPEAK_UNKNOWN_ERROR lang=%s", lang)
        raise HTTPException(status_code=500, detail="Text-to-speech failed unexpectedly.") from exc

    return TextToSpeechResponse(
        audio_path=f"/static/audio/{audio_output_path.name}",
        language=lang,
    )


@app.post("/plans/{plan_id}/approve")
def approve_plan(plan_id: str, req: PlanActionRequest | None = None) -> dict[str, Any]:
    record = PENDING_PLANS.get(plan_id)
    if not record:
        raise HTTPException(status_code=404, detail="Plan not found")

    if req and req.user_id and record["user_id"] != req.user_id:
        raise HTTPException(status_code=403, detail="Not allowed to approve this plan")

    record["approved"] = True
    return {
        "status": "approved",
        "plan_id": plan_id,
        "approved_plan": {
            "type": record["plan_type"],
            "plan": record["plan"],
        },
        "message": "Plan approved successfully.",
    }


@app.post("/plans/{plan_id}/reject")
def reject_plan(plan_id: str, req: PlanActionRequest | None = None) -> dict[str, Any]:
    record = PENDING_PLANS.get(plan_id)
    if not record:
        raise HTTPException(status_code=404, detail="Plan not found")

    if req and req.user_id and record["user_id"] != req.user_id:
        raise HTTPException(status_code=403, detail="Not allowed to reject this plan")

    record["approved"] = False
    return {"status": "rejected", "plan_id": plan_id}


@app.get("/conversation/{conversation_id}")
def get_conversation_history(conversation_id: str, user_id: Optional[str] = None) -> dict[str, Any]:
    uid = _normalize_user_id(user_id)
    key = _session_key(uid, _normalize_conversation_id(conversation_id, uid))
    memory = MEMORY_SESSIONS.get(key)
    return {
        "conversation_id": conversation_id,
        "user_id": uid,
        "messages": memory.short_term.get_full_history() if memory else [],
    }


@app.post("/conversation/{conversation_id}/clear")
def clear_conversation(conversation_id: str, user_id: Optional[str] = None) -> dict[str, Any]:
    uid = _normalize_user_id(user_id)
    key = _session_key(uid, _normalize_conversation_id(conversation_id, uid))
    if key in MEMORY_SESSIONS:
        MEMORY_SESSIONS[key].clear_short_term()
    return {"status": "cleared", "conversation_id": conversation_id}


@app.get("/progress/{user_id}")
def get_progress(user_id: str) -> dict[str, Any]:
    state = _get_user_state(_normalize_user_id(user_id))
    return {
        "user_id": user_id,
        "date": datetime.utcnow().isoformat(),
        "summary": state.get("last_progress_summary", {}),
    }
