import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Bot, User, Loader2, Mic, MicOff, Volume2, VolumeX, Plus, MessageSquare, Trash2, Menu, X, Settings2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { repairMojibake } from '@/lib/text';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useUser } from '@/contexts/UserContext';
import { useVoiceChat, type VoiceChatApiResponse } from '@/hooks/useVoiceChat';
import { supabase } from '@/integrations/supabase/client';
import { PlanApprovalUI } from '@/components/ai/PlanApprovalUI';
import { useLocation, useNavigate } from 'react-router-dom';
import { exercises } from '@/data/exercises';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updated_at: string;
}

interface PendingPlanState {
  id: string;
  type: 'workout' | 'nutrition';
  plan: any;
}

interface RagDebugHit {
  namespace?: string;
  id?: string;
  score?: number;
  metadata?: Record<string, unknown>;
  text?: string;
}

interface RagDebugData {
  query?: string;
  hits?: RagDebugHit[];
  database?: {
    counts?: Record<string, number>;
    tracking_summary?: {
      progress_metrics?: Record<string, unknown>;
    };
  };
}

interface StoredSchedulePlan {
  id: string;
  user_id: string;
  title: string;
  title_ar: string;
  plan_data: any[];
  is_active: boolean;
  created_at: string;
}

interface CompletionRow {
  id: string;
  completed_at?: string | null;
  log_date?: string | null;
  plan_id: string;
  day_index?: number | null;
  exercise_index?: number | null;
}

interface DailyLogRow {
  log_date?: string | null;
  workout_notes?: string | null;
  nutrition_notes?: string | null;
  mood?: string | null;
}

const AI_BACKEND_URL = import.meta.env.VITE_AI_BACKEND_URL || 'http://127.0.0.1:8002';
const NUTRITION_PREFIX = '\u{1F37D}\uFE0F';
const WEEK_TEMPLATE = [
  { day: 'Saturday', dayAr: 'السبت' },
  { day: 'Sunday', dayAr: 'الأحد' },
  { day: 'Monday', dayAr: 'الاثنين' },
  { day: 'Tuesday', dayAr: 'الثلاثاء' },
  { day: 'Wednesday', dayAr: 'الأربعاء' },
  { day: 'Thursday', dayAr: 'الخميس' },
  { day: 'Friday', dayAr: 'الجمعة' },
];

const buildWorkoutDayIndexes = (daysPerWeek: number) => {
  const clamped = Math.max(1, Math.min(7, daysPerWeek));
  const patterns: Record<number, number[]> = {
    1: [0],
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 1, 3, 5],
    5: [0, 1, 2, 4, 6],
    6: [0, 1, 2, 3, 4, 6],
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  return patterns[clamped] || patterns[3];
};

const toIsoDay = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  return date.toISOString().slice(0, 10);
};

const cleanNote = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim();

const looksLikeBadArabic = (value: string) => /[ØÙÃÐ]/.test(value);

const sanitizePlanLabel = (value: unknown, fallback: string) => {
  const cleaned = repairMojibake(String(value ?? '')).replace(/_/g, ' ').trim();
  return !cleaned || looksLikeBadArabic(cleaned) ? fallback : cleaned;
};

const repairDeep = (value: unknown): unknown => {
  if (typeof value === 'string') return repairMojibake(value);
  if (Array.isArray(value)) return value.map((item) => repairDeep(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, repairDeep(item)])
    );
  }
  return value;
};

const WEBSITE_PAGES = {
  home: {
    purpose: 'Main landing page and navigation hub for FitCoach.',
    primary_actions: ['start onboarding', 'open workouts', 'open AI coach', 'open schedule', 'open profile'],
  },
  workouts: {
    purpose: 'Exercise explorer that filters the exercise library by muscle group, goal, place, and gender.',
    primary_actions: ['select muscles on anatomy map', 'filter by goal', 'filter by home or gym', 'filter by gender'],
  },
  coach: {
    purpose: 'AI Coach page for text chat, voice chat, plan generation, plan approval, and chat history.',
    primary_actions: ['ask questions', 'use voice chat', 'create workout plans', 'create nutrition plans', 'approve or reject plans'],
  },
  schedule: {
    purpose: 'Weekly schedule page for active workout plans, nutrition plans, completions, and daily logs.',
    primary_actions: ['review plans by day', 'mark exercises complete', 'save daily workout notes', 'save nutrition notes', 'save mood or energy'],
  },
  profile: {
    purpose: 'Profile summary page for personal stats, BMI, health information, and training details.',
    primary_actions: ['review BMI', 'review health information', 'review training details', 'edit data'],
  },
  onboarding: {
    purpose: 'Multi-step setup flow that collects the user profile used across the app and by the AI coach.',
    primary_actions: ['complete profile basics', 'record health status', 'set goals', 'set training details', 'set workout location'],
  },
  auth: {
    purpose: 'Authentication page for sign in and sign up.',
    primary_actions: ['sign in', 'sign up', 'log out'],
  },
} as const;

const ONBOARDING_FLOW = [
  {
    key: 'basic_info',
    title_en: 'Basic Info',
    title_ar: 'معلومات أساسية',
    fields: ['name', 'age', 'gender'],
    helper_notes: [],
  },
  {
    key: 'body_stats',
    title_en: 'Body Stats',
    title_ar: 'قياسات الجسم',
    fields: ['weight_kg', 'height_cm'],
    helper_notes: [],
  },
  {
    key: 'health_status',
    title_en: 'Health Status',
    title_ar: 'الحالة الصحية',
    fields: ['chronic_conditions', 'allergies', 'dietary_preferences'],
    helper_notes: [
      'Chronic conditions can be selected from Diabetes, Blood Pressure, Heart, Asthma, Joints, and Back Pain, or typed manually.',
      'Allergies can be selected from Peanuts, Tree Nuts, Milk, Eggs, Wheat, and Shellfish, or typed manually.',
      'Dietary preferences can be selected from Vegetarian, Vegan, Halal, Keto, Gluten Free, and Lactose Free, or typed manually.',
      'The UI note says users can leave the field empty if they have no health issues, allergies, or dietary preferences.',
    ],
  },
  {
    key: 'goals',
    title_en: 'Your Goals',
    title_ar: 'أهدافك',
    fields: ['goal'],
    helper_notes: ['Goal options are Build Muscle, Lose Weight, and General Fitness.'],
  },
  {
    key: 'training_details',
    title_en: 'Training Details',
    title_ar: 'تفاصيل التدريب',
    fields: ['fitness_level', 'training_days_per_week', 'equipment', 'injuries', 'activity_level'],
    helper_notes: [
      'Equipment is a free-text field with examples like dumbbells, barbell, and bands.',
      'Injuries or pain is a free-text field for any injury or pain notes.',
      'Daily activity level options are Low, Moderate, and High.',
    ],
  },
  {
    key: 'workout_preference',
    title_en: 'Workout Preference',
    title_ar: 'مكان التمرين',
    fields: ['location'],
    helper_notes: ['Location options are Home and Gym.'],
  },
] as const;

const getConversationsStorageKey = (userId: string) => `fitcoach_conversations_${userId}`;
const getCurrentConversationStorageKey = (userId: string) => `fitcoach_current_conversation_${userId}`;
const getLocalPlansStorageKey = (userId: string) => `fitcoach_schedule_plans_${userId}`;

const readLocalConversations = (userId: string): { conversations: Conversation[]; currentId: string | null } => {
  try {
    const rawConversations = localStorage.getItem(getConversationsStorageKey(userId));
    const rawCurrentId = localStorage.getItem(getCurrentConversationStorageKey(userId));
    const conversations = rawConversations ? (JSON.parse(rawConversations) as Conversation[]) : [];
    const currentId = rawCurrentId || conversations[0]?.id || null;
    return { conversations, currentId };
  } catch {
    return { conversations: [], currentId: null };
  }
};

const readLocalPlans = (userId: string): StoredSchedulePlan[] => {
  try {
    const raw = localStorage.getItem(getLocalPlansStorageKey(userId));
    return raw ? (JSON.parse(raw) as StoredSchedulePlan[]) : [];
  } catch {
    return [];
  }
};

const writeLocalPlans = (userId: string, plans: StoredSchedulePlan[]) => {
  localStorage.setItem(getLocalPlansStorageKey(userId), JSON.stringify(plans));
};

export function CoachPage() {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { profile } = useUser();
  const navigate = useNavigate();
  const location = useLocation();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentMessages, setCurrentMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTypingReply, setIsTypingReply] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PendingPlanState | null>(null);
  const [showRagDebug, setShowRagDebug] = useState(false);
  const [ragDebugData, setRagDebugData] = useState<RagDebugData | null>(null);
  const [ragDebugLoading, setRagDebugLoading] = useState(false);
  const [ragDebugError, setRagDebugError] = useState('');
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    return localStorage.getItem('fitcoach_voice') || '';
  });
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceMode, setVoiceMode] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [pendingVoiceResponse, setPendingVoiceResponse] = useState<VoiceChatApiResponse | null>(null);
  const [websiteContext, setWebsiteContext] = useState<Record<string, unknown>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceModeRef = useRef(false);
  const assistantAudioRef = useRef<HTMLAudioElement | null>(null);

  const focusInput = useCallback(() => {
    window.setTimeout(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      const end = node.value.length;
      try {
        node.setSelectionRange(end, end);
      } catch {
        // Some browsers may not support selection on this control state.
      }
    }, 0);
  }, []);

  const buildWebsiteContext = useCallback(async (): Promise<Record<string, unknown>> => {
    const exerciseMuscles = Array.from(new Set(exercises.map((exercise) => exercise.muscle))).sort();
    const exerciseGoals = Array.from(new Set(exercises.map((exercise) => exercise.goal))).sort();
    const exerciseLocations = Array.from(new Set(exercises.map((exercise) => exercise.location))).sort();
    const exerciseGenders = Array.from(new Set(exercises.map((exercise) => exercise.gender))).sort();

    let recentDailyLogs: Array<Record<string, string>> = [];
    if (user) {
      try {
        const { data } = await supabase
          .from('daily_logs')
          .select('log_date,workout_notes,nutrition_notes,mood')
          .eq('user_id', user.id)
          .order('log_date', { ascending: false })
          .limit(7);

        recentDailyLogs = (data || [])
          .filter((log) => Boolean(log.workout_notes || log.nutrition_notes || log.mood))
          .map((log) => ({
            log_date: log.log_date || '',
            workout_notes: log.workout_notes || '',
            nutrition_notes: log.nutrition_notes || '',
            mood: log.mood || '',
          }));
      } catch (error) {
        console.warn('Failed building website context from daily logs:', error);
      }
    }

    return {
      app_name: 'FitCoach',
      current_page: 'coach',
      current_path: location.pathname,
      current_language: language === 'ar' ? 'ar' : 'en',
      pages: WEBSITE_PAGES,
      onboarding_flow: ONBOARDING_FLOW,
      profile_page: {
        sections: [
          'profile header with name, gender, goal, and email',
          'body mass index card with BMI value and category',
          'stats cards for age, height, weight, goal, and location',
          'health information for chronic conditions, allergies, and dietary preferences',
          'training details for level, training days, activity level, equipment, and injuries',
        ],
      },
      workouts_page: {
        title_en: 'Muscle Map',
        title_ar: 'خريطة العضلات',
        anatomy_selector: true,
        supported_muscles: exerciseMuscles,
        supported_goals: exerciseGoals,
        supported_locations: exerciseLocations,
        supported_genders: exerciseGenders,
        exercise_count: exercises.length,
        result_card_fields: ['name', 'localized name', 'sets', 'reps', 'description', 'video link if available'],
      },
      schedule_page: {
        supports_week_navigation: true,
        tabs: ['workout', 'nutrition'],
        daily_log_fields: ['workout_notes', 'nutrition_notes', 'mood'],
        daily_log_labels_en: ['What did you train today?', 'How was your nutrition today?', 'Mood / Energy'],
        daily_log_labels_ar: ['شو تمرنت اليوم؟', 'شو أكلت اليوم؟', 'مزاجك/طاقتك اليوم'],
        daily_log_help_en: 'These notes help the AI coach track your daily progress.',
        daily_log_help_ar: 'هذه الملاحظات تساعد المدرب الذكي على فهم تقدمك اليومي.',
        empty_state_workout_en: 'No workout schedule. Ask AI Coach to create one!',
        empty_state_nutrition_en: 'No nutrition plan. Ask AI Coach to create one!',
      },
      ai_coach_capabilities: [
        'general chat',
        'fitness coaching',
        'nutrition guidance',
        'website and onboarding explanations',
        'workout plan suggestions',
        'nutrition plan suggestions',
        'voice chat',
        'plan approval workflow',
        'chat history',
      ],
      user_visible_profile: profile
        ? {
            name: profile.name || '',
            age: profile.age,
            gender: profile.gender,
            weight: profile.weight,
            height: profile.height,
            goal: profile.goal,
            location: profile.location,
            fitnessLevel: profile.fitnessLevel,
            trainingDaysPerWeek: profile.trainingDaysPerWeek,
            equipment: profile.equipment || '',
            injuries: profile.injuries || '',
            activityLevel: profile.activityLevel,
            chronicConditions: profile.chronicConditions || '',
            allergies: profile.allergies || '',
            dietaryPreferences: profile.dietaryPreferences || '',
            onboardingCompleted: profile.onboardingCompleted,
          }
        : null,
      user_saved_notes: {
        source: 'daily_logs table and schedule page daily log form',
        recent_daily_logs: recentDailyLogs,
      },
    };
  }, [language, location.pathname, profile, user]);

  useEffect(() => {
    let cancelled = false;

    const refreshWebsiteContext = async () => {
      const nextContext = await buildWebsiteContext();
      if (!cancelled) {
        setWebsiteContext(nextContext);
      }
    };

    void refreshWebsiteContext();

    return () => {
      cancelled = true;
    };
  }, [buildWebsiteContext]);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  // Load available voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis?.getVoices() || [];
      setAvailableVoices(voices);
    };
    loadVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', loadVoices);
  }, []);

  // Filter voices by language
  const filteredVoices = availableVoices.filter(v => {
    if (language === 'ar') return v.lang.startsWith('ar');
    return v.lang.startsWith('en');
  });

  const handleVoiceBackendResponse = useCallback(async (payload: VoiceChatApiResponse) => {
    setPendingVoiceResponse(payload);
  }, []);

  const {
    isListening,
    isProcessing: isVoiceProcessing,
    isSupported,
    error: voiceError,
    clearError,
    startListening,
    stopListening,
    cancelVoiceRequest,
  } = useVoiceChat({
    backendUrl: AI_BACKEND_URL,
    language,
    userId: user?.id,
    conversationId: currentId || user?.id || null,
    websiteContext,
    onResponse: handleVoiceBackendResponse,
  });
  const isBusy = isLoading || isVoiceProcessing;

  const startListeningIfPossible = useCallback(() => {
    if (!isSupported) return;
    if (isLoading || isVoiceProcessing || isListening || isAssistantSpeaking) return;
    clearError();
    startListening();
  }, [isSupported, isLoading, isVoiceProcessing, isListening, isAssistantSpeaking, clearError, startListening]);

  const stopAllSpeech = useCallback(() => {
    cancelVoiceRequest();
    if (assistantAudioRef.current) {
      try {
        assistantAudioRef.current.pause();
        assistantAudioRef.current.currentTime = 0;
      } catch {
        // ignore media stop errors
      }
    }
    window.speechSynthesis?.cancel();
    setIsAssistantSpeaking(false);
  }, [cancelVoiceRequest]);

  const speakWithVoice = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) return;
    const cleanText = text
      .replace(/[#*_~`>]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\n+/g, '. ')
      .trim();

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);

    if (selectedVoice && selectedVoice !== 'default') {
      const voice = availableVoices.find(v => v.name === selectedVoice);
      if (voice) utterance.voice = voice;
    } else {
      const langVoices = availableVoices.filter(v =>
        language === 'ar' ? v.lang.startsWith('ar') : v.lang.startsWith('en')
      );
      if (langVoices.length > 0) utterance.voice = langVoices[0];
      utterance.lang = language === 'ar' ? 'ar-SA' : 'en-US';
    }

    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onstart = () => setIsAssistantSpeaking(true);
    utterance.onend = () => {
      setIsAssistantSpeaking(false);
      if (voiceModeRef.current) {
        window.setTimeout(() => startListeningIfPossible(), 250);
      }
    };
    utterance.onerror = () => setIsAssistantSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [language, selectedVoice, availableVoices, startListeningIfPossible]);

  const playBackendAudio = useCallback((relativePath?: string) => {
    if (!relativePath) {
      if (voiceModeRef.current) {
        window.setTimeout(() => startListeningIfPossible(), 250);
      }
      return;
    }

    const cleanPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
    const sourceUrl = `${AI_BACKEND_URL}${cleanPath}`;

    try {
      if (assistantAudioRef.current) {
        assistantAudioRef.current.pause();
        assistantAudioRef.current.currentTime = 0;
      }

      const audio = new Audio(sourceUrl);
      assistantAudioRef.current = audio;
      setIsAssistantSpeaking(true);

      audio.onended = () => {
        setIsAssistantSpeaking(false);
        if (voiceModeRef.current) {
          window.setTimeout(() => startListeningIfPossible(), 250);
        }
      };
      audio.onerror = () => {
        setIsAssistantSpeaking(false);
        if (voiceModeRef.current) {
          window.setTimeout(() => startListeningIfPossible(), 250);
        }
      };
      audio.play().catch(() => {
        setIsAssistantSpeaking(false);
        if (voiceModeRef.current) {
          window.setTimeout(() => startListeningIfPossible(), 250);
        }
      });
    } catch {
      setIsAssistantSpeaking(false);
      if (voiceModeRef.current) {
        window.setTimeout(() => startListeningIfPossible(), 250);
      }
    }
  }, [startListeningIfPossible]);

  const toggleVoiceMode = useCallback(() => {
    if (voiceModeRef.current) {
      setVoiceMode(false);
      stopListening();
      stopAllSpeech();
      return;
    }
    setVoiceMode(true);
    setAutoSpeak(true);
    window.setTimeout(() => startListeningIfPossible(), 120);
  }, [startListeningIfPossible, stopAllSpeech, stopListening]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const goToSchedule = useCallback(() => {
    navigate('/schedule');
    window.setTimeout(() => {
      if (!window.location.pathname.startsWith('/schedule')) {
        window.location.assign('/schedule');
      }
    }, 350);
  }, [navigate]);

  const loadRagDebug = useCallback(async (queryText?: string) => {
    if (!user) return;
    const trimmedQuery = (queryText || '').trim();
    if (!trimmedQuery) return;

    setRagDebugLoading(true);
    setRagDebugError('');
    try {
      const response = await fetch(`${AI_BACKEND_URL}/debug/rag/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          user_id: user.id,
          conversation_id: currentId || user.id,
          query: trimmedQuery,
          top_k: 6,
        }),
      });
      if (!response.ok) {
        throw new Error(`RAG debug request failed: ${response.status}`);
      }
      const payload = await response.json();
      setRagDebugData(payload);
    } catch (error: any) {
      setRagDebugError(error?.message || 'Failed to load RAG debug data.');
    } finally {
      setRagDebugLoading(false);
    }
  }, [currentId, user]);

  useEffect(() => {
    if (!showRagDebug || !user) return;
    const latestUserMessage = [...currentMessages].reverse().find((message) => message.role === 'user');
    if (!latestUserMessage?.content) return;
    void loadRagDebug(latestUserMessage.content);
  }, [showRagDebug, currentMessages, loadRagDebug, user]);

  useEffect(() => {
    scrollToBottom();
  }, [currentMessages]);

  useEffect(() => {
    if (!user) {
      setLoadingConvs(false);
      return;
    }
    loadConversations();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    localStorage.setItem(getConversationsStorageKey(user.id), JSON.stringify(conversations));
    if (currentId) {
      localStorage.setItem(getCurrentConversationStorageKey(user.id), currentId);
    } else {
      localStorage.removeItem(getCurrentConversationStorageKey(user.id));
    }
  }, [conversations, currentId, user]);

  useEffect(() => {
    return () => {
      stopAllSpeech();
      stopListening();
    };
  }, [stopAllSpeech, stopListening]);

  useEffect(() => {
    if (!pendingVoiceResponse || !user) return;

    const applyVoiceResponse = async () => {
      const transcript = (pendingVoiceResponse.transcript || '').trim();
      const reply = (pendingVoiceResponse.reply || '').trim();
      const now = Date.now();

      const userMessage: ChatMessage | null = transcript
        ? { role: 'user', content: transcript, timestamp: now }
        : null;
      const assistantMessage: ChatMessage | null = reply
        ? { role: 'assistant', content: reply, timestamp: now + 1 }
        : null;

      const additions = [userMessage, assistantMessage].filter(Boolean) as ChatMessage[];
      if (additions.length === 0) {
        setPendingVoiceResponse(null);
        return;
      }

      const updatedMessages = [...currentMessages, ...additions];
      setCurrentMessages(updatedMessages);
      setConversations(prev =>
        prev.map(c =>
          c.id === currentId
            ? { ...c, messages: updatedMessages, updated_at: new Date().toISOString() }
            : c
        )
      );

      if (currentId) {
        const rows: Array<{
          conversation_id: string;
          user_id: string;
          role: string;
          content: string;
        }> = [];
        if (userMessage) {
          rows.push({
            conversation_id: currentId,
            user_id: user.id,
            role: 'user',
            content: userMessage.content,
          });
        }
        if (assistantMessage) {
          rows.push({
            conversation_id: currentId,
            user_id: user.id,
            role: 'assistant',
            content: assistantMessage.content,
          });
        }
        if (rows.length > 0 && supabase && supabase.from) {
          try {
            await supabase.from('chat_messages').insert(rows as any);
          } catch (error) {
            console.warn('Failed to save messages to Supabase:', error);
            // لا نوقف التطبيق - الرسائل محفوظة محلياً بالفعل
          }
        }
      }

      if (reply && (voiceModeRef.current || autoSpeak)) {
        playBackendAudio(pendingVoiceResponse.audio_path);
      } else if (voiceModeRef.current) {
        window.setTimeout(() => startListeningIfPossible(), 250);
      } else {
        focusInput();
      }

      setPendingVoiceResponse(null);
    };

    applyVoiceResponse().catch((err) => {
      console.error('Failed to apply voice response:', err);
      setPendingVoiceResponse(null);
    });
  }, [
    autoSpeak,
    currentId,
    currentMessages,
    pendingVoiceResponse,
    playBackendAudio,
    focusInput,
    startListeningIfPossible,
    user,
  ]);

  const loadConversations = async () => {
    if (!user) return;
    setLoadingConvs(true);
    const localSnapshot = readLocalConversations(user.id);
    if (localSnapshot.conversations.length > 0) {
      setConversations(localSnapshot.conversations);
      setCurrentId(localSnapshot.currentId);
      const selected = localSnapshot.conversations.find((c) => c.id === localSnapshot.currentId) || localSnapshot.conversations[0];
      setCurrentMessages(selected?.messages || []);
    }
    
    try {
      if (!supabase || !supabase.from) {
        console.warn('Supabase not available');
        setLoadingConvs(false);
        return;
      }

      const { data: convs } = await supabase
        .from('chat_conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (convs && convs.length > 0) {
        const convsWithMessages: Conversation[] = [];
        for (const conv of convs) {
          const { data: msgs } = await supabase
            .from('chat_messages')
            .select('*')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: true });
          
          convsWithMessages.push({
            id: conv.id,
            title: conv.title,
            messages: (msgs || []).map(m => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
              timestamp: new Date(m.created_at).getTime(),
            })),
            updated_at: conv.updated_at,
          });
        }
        const restoredCurrentId = localSnapshot.currentId || currentId;
        const selectedConversation = convsWithMessages.find((conv) => conv.id === restoredCurrentId) || convsWithMessages[0];
        setConversations(convsWithMessages);
        setCurrentId(selectedConversation.id);
        setCurrentMessages(selectedConversation.messages);
      }
    } catch (error) {
      console.warn('Failed to load conversations:', error);
    } finally {
      setLoadingConvs(false);
    }
  };

  const createConversation = async (): Promise<string | null> => {
    if (!user) return null;

    let id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `conv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    let updatedAt = new Date().toISOString();

    // حاول حفظ في Supabase إذا كانت متاحة
    if (supabase && supabase.from) {
      try {
        const { data, error } = await supabase
          .from('chat_conversations')
          .insert({ user_id: user.id, title: '' })
          .select('id, updated_at')
          .single();

        if (!error && data?.id) {
          id = data.id;
          updatedAt = data.updated_at || updatedAt;
        } else if (error) {
          console.warn('Supabase insert error, falling back to local id:', error);
        }
      } catch (error) {
        console.warn('Failed to create conversation in Supabase:', error);
      }
    }

    const newConv: Conversation = {
      id,
      title: '',
      messages: [],
      updated_at: updatedAt,
    };

    setConversations(prev => [newConv, ...prev]);
    setCurrentId(id);
    setCurrentMessages([]);
    return id;
  };

  const ensureActiveConversation = async (): Promise<string | null> => {
    if (!user) return null;
    if (currentId) return currentId;
    const createdId = await createConversation();
    return createdId;
  };

  const selectConversation = (id: string) => {
    const conv = conversations.find(c => c.id === id);
    if (conv) {
      setCurrentId(id);
      setCurrentMessages(conv.messages);
      setPendingPlan(null);
    }
    setSidebarOpen(false);
  };

  const deleteConversation = async (id: string) => {
    if (supabase && supabase.from) {
      try {
        await supabase.from('chat_conversations').delete().eq('id', id);
      } catch (error) {
        console.warn('Failed to delete conversation from Supabase:', error);
      }
    }
    setConversations(prev => prev.filter(c => c.id !== id));
    if (currentId === id) {
      const remaining = conversations.filter(c => c.id !== id);
      if (remaining.length > 0) {
        setCurrentId(remaining[0].id);
        setCurrentMessages(remaining[0].messages);
      } else {
        setCurrentId(null);
        setCurrentMessages([]);
      }
    }
  };
  const formatExercisesMessage = (exercises: any[]) => {
    if (!Array.isArray(exercises) || exercises.length === 0) {
      return language === 'ar'
        ? 'لم أجد تمارين مناسبة في قاعدة البيانات. حاول صياغة طلبك بشكل مختلف.'
        : 'I could not find matching exercises in the knowledge base. Try rephrasing your request.';
    }

    return exercises
      .map((item, idx) =>
        [
          `${idx + 1}. ${item.exercise}`,
          `- Muscle: ${item.muscle}`,
          `- Difficulty: ${item.difficulty}`,
          `- Injury Safe: ${item.injury_safe ? 'Yes' : 'No'}`,
          `- ${item.description}`,
        ].join('\\n')
      )
      .join('\\n\\n');
  };

  const toWorkoutPlanData = (plan: any) => {
    if (Array.isArray(plan?.days) && plan.days.length > 0) {
      return plan.days.filter((day: any) => Array.isArray(day?.exercises) && day.exercises.length > 0);
    }

    const exercises = Array.isArray(plan?.exercises) ? plan.exercises : [];
    const requestedDays = Number(plan?.training_days_per_week ?? plan?.trainingDaysPerWeek ?? plan?.days_per_week ?? 3);
    const workoutDayIndexes = buildWorkoutDayIndexes(Number.isFinite(requestedDays) ? requestedDays : 3);
    const grouped = workoutDayIndexes.map(() => [] as any[]);

    exercises.forEach((exercise: any, index: number) => {
      grouped[index % workoutDayIndexes.length].push(exercise);
    });

    return WEEK_TEMPLATE.map((weekDay, weekIndex) => {
      const slot = workoutDayIndexes.indexOf(weekIndex);
      const dayExercises = slot >= 0 ? grouped[slot] : [];
      return {
        ...weekDay,
        exercises: dayExercises.map((ex: any) => ({
          name: ex?.name || 'Exercise',
          nameAr: ex?.nameAr || ex?.name || 'تمرين',
          sets: String(ex?.sets ?? ''),
          reps: String(ex?.reps ?? ''),
        })),
      };
    });
  };

  const toNutritionPlanData = (plan: any) => {
    if (Array.isArray(plan?.days) && plan.days.length > 0) {
      return plan.days;
    }

    const meals = Array.isArray(plan?.meals) ? plan.meals : [];
    const mappedMeals = meals.map((meal: any) => ({
      name: meal?.name || 'Meal',
      nameAr: meal?.nameAr || meal?.name || 'وجبة',
      description: Array.isArray(meal?.ingredients) ? meal.ingredients.join(', ') : (meal?.description || ''),
      descriptionAr: meal?.descriptionAr || (Array.isArray(meal?.ingredients) ? meal.ingredients.join(', ') : (meal?.description || '')),
      calories: String(meal?.calories ?? ''),
    }));

    return WEEK_TEMPLATE.map((weekDay) => ({
      ...weekDay,
      meals: mappedMeals,
    }));
  };

  const extractPendingPlanFromResponse = (
    responseData: any
  ): PendingPlanState | null => {
    if (responseData?.action !== 'ask_plan' || !responseData?.data?.plan || !responseData?.data?.plan_id) {
      return null;
    }

    return {
      id: responseData.data.plan_id,
      type: responseData.data.plan_type === 'nutrition' ? 'nutrition' : 'workout',
      plan: responseData.data.plan,
    };
  };

  const extractApprovedPlanFromResponse = (
    responseData: any
  ): { type: 'workout' | 'nutrition'; plan: any } | null => {
    if (responseData?.approved_plan?.plan) {
      const approved = responseData.approved_plan;
      return {
        type: approved.type === 'meal' || approved.type === 'nutrition' ? 'nutrition' : 'workout',
        plan: approved.plan,
      };
    }

    if (responseData?.data?.approved_plan?.plan) {
      const approved = responseData.data.approved_plan;
      return {
        type: approved.type === 'meal' || approved.type === 'nutrition' ? 'nutrition' : 'workout',
        plan: approved.plan,
      };
    }

    return null;
  };

  const persistApprovedPlan = async (approvedPayload: any) => {
    if (!user) return;
    const extracted = extractApprovedPlanFromResponse(approvedPayload);
    if (!extracted) return;

    const { type, plan } = extracted;
    const cleanedPlan = repairDeep(plan) as any;
    const planData = type === 'nutrition' ? toNutritionPlanData(cleanedPlan) : toWorkoutPlanData(cleanedPlan);
    if (!Array.isArray(planData) || planData.length === 0) return;

    const title = type === 'nutrition'
      ? `${NUTRITION_PREFIX} ${sanitizePlanLabel(cleanedPlan?.title, 'Nutrition Plan')}`
      : sanitizePlanLabel(cleanedPlan?.title, 'AI Workout Plan');
    const title_ar = sanitizePlanLabel(cleanedPlan?.title_ar, type === 'nutrition' ? 'خطة تغذية' : 'خطة تمارين');
    const storedPlan: StoredSchedulePlan = {
      id: cleanedPlan?.id || `${type}_${Date.now()}`,
      user_id: user.id,
      title,
      title_ar,
      plan_data: planData,
      is_active: true,
      created_at: cleanedPlan?.created_at || new Date().toISOString(),
    };

    const localPlans = readLocalPlans(user.id);
    const nextLocalPlans = [
      ...localPlans
        .filter((item) => item.id !== storedPlan.id)
        .map((item) => ({
          ...item,
          is_active: type === 'nutrition'
            ? (item.title || '').startsWith(NUTRITION_PREFIX) ? false : item.is_active
            : (item.title || '').startsWith(NUTRITION_PREFIX) ? item.is_active : false,
        })),
      storedPlan,
    ];
    writeLocalPlans(user.id, nextLocalPlans);

    try {
      if (type === 'nutrition') {
        await supabase.from('workout_plans').update({ is_active: false })
          .eq('user_id', user.id)
          .like('title', `${NUTRITION_PREFIX}%`);
      } else {
        await supabase.from('workout_plans').update({ is_active: false })
          .eq('user_id', user.id)
          .not('title', 'like', `${NUTRITION_PREFIX}%`);
      }

      await supabase.from('workout_plans').insert({
        user_id: user.id,
        title,
        title_ar,
        plan_data: planData,
        is_active: true,
      });
    } catch (error) {
      console.warn('Failed to persist approved plan to Supabase, kept local fallback:', error);
    }
  };

  const buildCombinedUserProfile = async () => {
    // Use profile from React Context (always up-to-date)
    if (profile) {
      return {
        id: user?.id,
        user_id: user?.id,
        name: profile.name,
        age: profile.age,
        gender: profile.gender,
        weight: profile.weight,
        height: profile.height,
        goal: profile.goal,
        location: profile.location,
        fitnessLevel: profile.fitnessLevel,
        trainingDaysPerWeek: profile.trainingDaysPerWeek,
        equipment: profile.equipment || '',
        injuries: profile.injuries || '',
        activityLevel: profile.activityLevel,
        dietaryPreferences: profile.dietaryPreferences || '',
        chronicConditions: profile.chronicConditions || '',
        allergies: profile.allergies || '',
      };
    }

    if (!user) return null;

    // Fallback to Supabase if context profile not available
    const merged: Record<string, any> = {};

    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('name,age,gender,weight,height,goal,location,fitness_level,training_days_per_week,equipment,injuries,activity_level,dietary_preferences,chronic_conditions,allergies')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileData) {
        merged.id = user.id;
        merged.user_id = user.id;
        merged.name = profileData.name;
        merged.age = profileData.age;
        merged.gender = profileData.gender;
        merged.weight = profileData.weight;
        merged.height = profileData.height;
        merged.goal = profileData.goal;
        merged.location = profileData.location;
        merged.fitnessLevel = (profileData as any).fitness_level;
        merged.trainingDaysPerWeek = (profileData as any).training_days_per_week;
        merged.equipment = (profileData as any).equipment || '';
        merged.injuries = (profileData as any).injuries || '';
        merged.activityLevel = (profileData as any).activity_level;
        merged.dietaryPreferences = (profileData as any).dietary_preferences || '';
        merged.chronicConditions = (profileData as any).chronic_conditions || '';
        merged.allergies = (profileData as any).allergies || '';
      }
    } catch (error) {
      console.error('Failed loading profiles table', error);
    }

    return Object.keys(merged).length > 0 ? merged : null;
  };

  const buildPlanSnapshot = async () => {
    if (!user) return null;

    try {
      const { data: activePlans } = await supabase
        .from('workout_plans')
        .select('title,is_active,updated_at')
        .eq('user_id', user.id)
        .eq('is_active', true);

      const workoutPlans = (activePlans || []).filter((plan) => !(plan.title || '').startsWith(NUTRITION_PREFIX));
      const nutritionPlans = (activePlans || []).filter((plan) => (plan.title || '').startsWith(NUTRITION_PREFIX));

      return {
        active_workout_plans: workoutPlans.length,
        active_nutrition_plans: nutritionPlans.length,
        workout_titles: workoutPlans.map((plan) => plan.title).filter(Boolean),
        nutrition_titles: nutritionPlans.map((plan) => plan.title).filter(Boolean),
        updated_at: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Failed building plan snapshot', error);
      return null;
    }
  };

  const buildTrackingSummary = async () => {
    if (!user) return null;

    try {
      const { data: plansData } = await supabase
        .from('workout_plans')
        .select('id,title,title_ar,plan_data,is_active')
        .eq('user_id', user.id);

      const { data: completionsData } = await supabase
        .from('workout_completions')
        .select('id,completed_at,log_date,plan_id,day_index,exercise_index')
        .eq('user_id', user.id);

      const { data: logsData } = await supabase
        .from('daily_logs')
        .select('log_date,workout_notes,nutrition_notes,mood')
        .eq('user_id', user.id);

      const plans = (plansData || []) as Array<StoredSchedulePlan & { title_ar?: string; is_active?: boolean }>;
      const completions = (completionsData || []) as CompletionRow[];
      const dailyLogs = (logsData || []) as DailyLogRow[];
      const plansById = new Map(plans.map((plan) => [plan.id, plan]));

      let totalTasks = 0;
      let totalWorkoutTasks = 0;
      let totalNutritionTasks = 0;
      for (const plan of plans) {
        const days = Array.isArray((plan as any).plan_data) ? (plan as any).plan_data : [];
        for (const day of days) {
          const exercises = Array.isArray(day?.exercises) ? day.exercises.length : 0;
          const meals = Array.isArray(day?.meals) ? day.meals.length : 0;
          totalTasks += exercises + meals;
          if ((plan.title || '').startsWith(NUTRITION_PREFIX)) {
            totalNutritionTasks += meals;
          } else {
            totalWorkoutTasks += exercises;
          }
        }
      }

      const completedTasks = completions.length;
      const adherence = totalTasks > 0 ? Math.min(1, completedTasks / totalTasks) : 0;
      const workoutPlans = plans.filter((plan) => !(plan.title || '').startsWith(NUTRITION_PREFIX));
      const nutritionPlans = plans.filter((plan) => (plan.title || '').startsWith(NUTRITION_PREFIX));
      const activeWorkoutPlans = workoutPlans.filter((plan) => plan.is_active).length || workoutPlans.length;
      const activeNutritionPlans = nutritionPlans.filter((plan) => plan.is_active).length || nutritionPlans.length;

      const sortedByDate = [...completions]
        .filter((row) => row.completed_at)
        .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime());
      const lastCompletionAt = sortedByDate[0]?.completed_at || null;
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const completionsLast7Days = completions.filter((row) => {
        const sourceDate = row.completed_at || row.log_date;
        if (!sourceDate) return false;
        return new Date(sourceDate).getTime() >= sevenDaysAgo;
      });
      const completedLast7Days = completionsLast7Days.length;

      const logsLast7Days = dailyLogs.filter((row) => {
        if (!row.log_date) return false;
        return new Date(row.log_date).getTime() >= sevenDaysAgo;
      });
      const lastLogDate = dailyLogs
        .filter((row) => row.log_date)
        .sort((a, b) => new Date(b.log_date).getTime() - new Date(a.log_date).getTime())[0]?.log_date || null;

      const plannedWorkoutDays = new Set<string>();
      const plannedNutritionDays = new Set<string>();
      const cadencePlans = plans.filter((plan) => plan.is_active);
      for (const plan of cadencePlans.length ? cadencePlans : plans) {
        const days = Array.isArray(plan.plan_data) ? plan.plan_data : [];
        days.forEach((day: any, index: number) => {
          const dayLabel = String(day?.day || WEEK_TEMPLATE[index]?.day || index);
          if ((plan.title || '').startsWith(NUTRITION_PREFIX)) {
            if (Array.isArray(day?.meals) && day.meals.length > 0) plannedNutritionDays.add(dayLabel);
          } else if (Array.isArray(day?.exercises) && day.exercises.length > 0) {
            plannedWorkoutDays.add(dayLabel);
          }
        });
      }

      const completionDaySet = new Set(
        completionsLast7Days
          .map((row) => toIsoDay(row.log_date || row.completed_at || null))
          .filter(Boolean) as string[]
      );
      const workoutLogDaysSet = new Set(
        logsLast7Days
          .filter((row) => cleanNote(row.workout_notes))
          .map((row) => toIsoDay(row.log_date || null))
          .filter(Boolean) as string[]
      );
      const nutritionLogDaysSet = new Set(
        logsLast7Days
          .filter((row) => cleanNote(row.nutrition_notes))
          .map((row) => toIsoDay(row.log_date || null))
          .filter(Boolean) as string[]
      );

      const recentExerciseCompletions = sortedByDate.slice(0, 12).map((row) => {
        const plan = plansById.get(row.plan_id);
        const days = Array.isArray(plan?.plan_data) ? plan?.plan_data : [];
        const day = typeof row.day_index === 'number' ? days[row.day_index] : null;
        const exercise = Array.isArray(day?.exercises) && typeof row.exercise_index === 'number'
          ? day.exercises[row.exercise_index]
          : null;
        return {
          date: toIsoDay(row.log_date || row.completed_at || null),
          plan_title: plan?.title || '',
          day: day?.day || day?.dayAr || '',
          exercise_name: exercise?.name || exercise?.nameAr || 'Exercise completed',
        };
      });

      const recentActivity = logsLast7Days
        .map((row) => {
          const day = toIsoDay(row.log_date || null);
          return {
            date: day,
            completed_exercises: day ? completionsLast7Days.filter((item) => toIsoDay(item.log_date || item.completed_at || null) === day).length : 0,
            workout_notes: cleanNote(row.workout_notes),
            nutrition_notes: cleanNote(row.nutrition_notes),
            mood: cleanNote(row.mood),
          };
        })
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
        .slice(0, 7);

      const recentWorkoutNotes = logsLast7Days.map((row) => cleanNote(row.workout_notes)).filter(Boolean).slice(0, 5);
      const recentNutritionNotes = logsLast7Days.map((row) => cleanNote(row.nutrition_notes)).filter(Boolean).slice(0, 5);
      const recentMoods = logsLast7Days.map((row) => cleanNote(row.mood)).filter(Boolean).slice(0, 5);

      const activePlanDetails = plans
        .filter((plan) => plan.is_active)
        .slice(0, 4)
        .map((plan) => {
          const days = Array.isArray(plan.plan_data) ? plan.plan_data : [];
          const sampleExercises = days.flatMap((day: any) => Array.isArray(day?.exercises) ? day.exercises.slice(0, 2) : []).slice(0, 6);
          const sampleMeals = days.flatMap((day: any) => Array.isArray(day?.meals) ? day.meals.slice(0, 2) : []).slice(0, 6);
          return {
            title: plan.title,
            type: (plan.title || '').startsWith(NUTRITION_PREFIX) ? 'nutrition' : 'workout',
            weekly_days_with_items: days.filter((day: any) => (Array.isArray(day?.exercises) && day.exercises.length > 0) || (Array.isArray(day?.meals) && day.meals.length > 0)).length,
            sample_exercises: sampleExercises.map((item: any) => item?.name || item?.nameAr).filter(Boolean),
            sample_meals: sampleMeals.map((item: any) => item?.name || item?.nameAr).filter(Boolean),
          };
        });

      return {
        completed_tasks: completedTasks,
        total_tasks: totalTasks,
        adherence_score: adherence,
        completed_workout_tasks: completedTasks,
        total_workout_tasks: totalWorkoutTasks,
        total_nutrition_tasks: totalNutritionTasks,
        active_workout_plans: activeWorkoutPlans,
        active_nutrition_plans: activeNutritionPlans,
        completed_last_7_days: completedLast7Days,
        last_completed_at: lastCompletionAt,
        days_logged_last_7: logsLast7Days.length,
        last_log_date: lastLogDate,
        recent_completed_exercises: recentExerciseCompletions,
        recent_workout_notes: recentWorkoutNotes,
        recent_nutrition_notes: recentNutritionNotes,
        recent_moods: recentMoods,
        recent_activity: recentActivity,
        active_plan_details: activePlanDetails,
        weekly_stats: {
          workout_days: completionDaySet.size,
          planned_days: plannedWorkoutDays.size,
          planned_nutrition_days: plannedNutritionDays.size,
          workout_log_days: workoutLogDaysSet.size,
          nutrition_log_days: nutritionLogDaysSet.size,
          completed_workouts: completedLast7Days,
          recent_exercise_names: recentExerciseCompletions.map((item) => item.exercise_name).filter(Boolean).slice(0, 8),
        },
        monthly_stats: {
          consistency_percent: Math.round(adherence * 100),
          days_logged: dailyLogs.length,
          workout_log_days: dailyLogs.filter((row) => cleanNote(row.workout_notes)).length,
          nutrition_log_days: dailyLogs.filter((row) => cleanNote(row.nutrition_notes)).length,
        },
        goal: profile
          ? {
              type: profile.goal,
              current_weight: profile.weight,
            }
          : undefined,
      };
    } catch (error) {
      console.error('Failed building tracking summary', error);
      return null;
    }
  };

  const typeAssistantReply = useCallback(
    async (baseMessages: ChatMessage[], fullText: string): Promise<ChatMessage[]> => {
      const timestamp = Date.now();
      const seedMessage: ChatMessage = { role: 'assistant', content: '', timestamp };
      setCurrentMessages([...baseMessages, seedMessage]);

      if (!fullText) {
        return [...baseMessages, seedMessage];
      }

      setIsTypingReply(true);
      const charsPerTick =
        fullText.length > 1400 ? 20 : fullText.length > 900 ? 14 : fullText.length > 500 ? 9 : 5;
      const tickMs = 18;
      let cursor = 0;

      await new Promise<void>((resolve) => {
        const timer = window.setInterval(() => {
          cursor = Math.min(fullText.length, cursor + charsPerTick);
          const partialMessage: ChatMessage = {
            role: 'assistant',
            content: fullText.slice(0, cursor),
            timestamp,
          };
          setCurrentMessages([...baseMessages, partialMessage]);

          if (cursor >= fullText.length) {
            window.clearInterval(timer);
            resolve();
          }
        }, tickMs);
      });

      setIsTypingReply(false);
      return [...baseMessages, { role: 'assistant', content: fullText, timestamp }];
    },
    []
  );

  const sendMessageWithText = async (text: string) => {
    if (!text.trim() || isBusy || !user) return;

    const activeConversationId = await ensureActiveConversation();
    if (!activeConversationId) return;

    const userMessage: ChatMessage = { role: 'user', content: text.trim(), timestamp: Date.now() };
    const newMessages = [...currentMessages, userMessage];
    setCurrentMessages(newMessages);
    setInput('');
    setIsLoading(true);

    if (activeConversationId) {
      if (supabase && supabase.from) {
        try {
          await supabase.from('chat_messages').insert({
            conversation_id: activeConversationId,
            user_id: user.id,
            role: 'user',
            content: text.trim(),
          });
          
          const conv = conversations.find(c => c.id === activeConversationId);
          if (conv && !conv.title) {
            const title = text.trim().slice(0, 50) + (text.trim().length > 50 ? '...' : '');
            await supabase.from('chat_conversations').update({ title }).eq('id', activeConversationId);
            setConversations(prev => prev.map(c => c.id === activeConversationId ? { ...c, title } : c));
          }
        } catch (error) {
          console.warn('Failed to save message to Supabase:', error);
        }
      }
    }

    setConversations(prev => {
      const updated = prev.map(c =>
        c.id === activeConversationId ? { ...c, messages: newMessages, updated_at: new Date().toISOString() } : c
      );
      const hasConversation = updated.some(c => c.id === activeConversationId);
      if (hasConversation) return updated;
      return [{ id: activeConversationId, title: '', messages: newMessages, updated_at: new Date().toISOString() }, ...updated];
    });
    try {
      const user_profile = await buildCombinedUserProfile();
      const tracking_summary = await buildTrackingSummary();
      const plan_snapshot = await buildPlanSnapshot();
      const recent_messages = newMessages.slice(-12).map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      const website_context = await buildWebsiteContext();

      const payload = {
        message: text.trim(),
        user_id: user.id,
        conversation_id: activeConversationId,
        language: language === 'ar' ? 'ar' : 'en',
        user_profile,
        tracking_summary,
        plan_snapshot,
        website_context,
        recent_messages,
      };

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 120000);
      const apiResponse = await fetch(`${AI_BACKEND_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);

      if (!apiResponse.ok) {
        throw new Error(`Backend error: ${apiResponse.status}`);
      }

      const data = await apiResponse.json();

      // prefer the textual reply from backend
      const assistantTextRaw = data?.reply || formatExercisesMessage(data?.exercises || []);
      const assistantText = repairMojibake(assistantTextRaw);
      const updatedMessages = await typeAssistantReply(newMessages, assistantText);
      setCurrentMessages(updatedMessages);
      setConversations(prev => prev.map(c =>
        c.id === activeConversationId ? { ...c, messages: updatedMessages, updated_at: new Date().toISOString() } : c
      ));

      if (activeConversationId) {
        try {
          await supabase.from('chat_messages').insert({
            conversation_id: activeConversationId,
            user_id: user.id,
            role: 'assistant',
            content: assistantText,
          });
        } catch (error) {
          console.warn('Failed to save assistant message to Supabase:', error);
        }
      }

      const pendingFromApi = extractPendingPlanFromResponse(data);
      if (pendingFromApi) {
        setPendingPlan(pendingFromApi);
      }

      const approvedFromApi = extractApprovedPlanFromResponse(data);
      if (approvedFromApi) {
        try {
          await persistApprovedPlan(data);
        } catch (e) {
          console.error('Failed saving approved plan to Supabase', e);
        } finally {
          setPendingPlan(null);
          goToSchedule();
        }
      }

      if (autoSpeak) speakWithVoice(assistantText);
      if (showRagDebug) {
        void loadRagDebug(text.trim());
      }
      if (!voiceModeRef.current) focusInput();
    } catch (error: any) {
      console.error('Error:', error);
      setIsTypingReply(false);
      const timeoutMessage = error?.name === 'AbortError'
        ? (language === 'ar'
          ? 'الرد تأخر. تأكد أن السيرفر شغال على المنفذ الصحيح ثم جرّب مرة ثانية.'
          : 'The response is taking too long. Make sure the backend is running on the correct port and try again.')
        : null;
      const errMsg: ChatMessage = {
        role: 'assistant',
        content:
          timeoutMessage ||
          (language === 'ar'
            ? `تعذر الاتصال بخادم الذكاء الاصطناعي (${AI_BACKEND_URL}). تأكد أنه يعمل ثم أعد المحاولة.`
            : `Could not reach the AI backend (${AI_BACKEND_URL}). Make sure it's running and try again.`),
        timestamp: Date.now(),
      };
      setCurrentMessages(prev => [...prev, errMsg]);
    } finally {
      setIsTypingReply(false);
      setIsLoading(false);
      if (!voiceModeRef.current) focusInput();
    }
  };

  const sendMessage = () => sendMessageWithText(input);

  const appendAssistantMessage = async (content: string) => {
    const aiMessage: ChatMessage = { role: 'assistant', content, timestamp: Date.now() };
    setCurrentMessages(prev => {
      const updatedMessages = [...prev, aiMessage];
      setConversations(conversationsPrev => conversationsPrev.map(c =>
        c.id === currentId ? { ...c, messages: updatedMessages, updated_at: new Date().toISOString() } : c
      ));
      return updatedMessages;
    });

    if (currentId && user) {
      try {
        await supabase.from('chat_messages').insert({
          conversation_id: currentId,
          user_id: user.id,
          role: 'assistant',
          content,
        });
      } catch (error) {
        console.warn('Failed to persist assistant confirmation message:', error);
      }
    }
  };

  const handleApprovePlan = async (planId: string) => {
    if (!user) return;
    const response = await fetch(`${AI_BACKEND_URL}/plans/${planId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user.id,
        conversation_id: currentId || user.id,
      }),
    });

    if (!response.ok) {
      throw new Error(`Approve failed: ${response.status}`);
    }

    const data = await response.json();
    try {
      await persistApprovedPlan(data);
    } catch (error) {
      console.error('Failed saving approved plan to Supabase', error);
    }
    setPendingPlan(null);

    const successText = language === 'ar'
      ? 'تم اعتماد الخطة وحفظها في صفحة الجدول.'
      : 'Plan approved and saved to your Schedule page.';
    try {
      await appendAssistantMessage(successText);
    } finally {
      goToSchedule();
    }
  };

  const handleRejectPlan = async (planId: string) => {
    if (!user) return;
    await fetch(`${AI_BACKEND_URL}/plans/${planId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user.id,
        conversation_id: currentId || user.id,
      }),
    });

    setPendingPlan(null);
    const rejectText = language === 'ar'
      ? 'تم رفض الخطة. اكتب لي التعديلات التي تريدها وسأعيد بناء خطة جديدة.'
      : 'Plan rejected. Tell me what to change and I will regenerate it.';
    await appendAssistantMessage(rejectText);
  };

  const workoutApprovalPlan = pendingPlan?.type === 'workout' ? {
    id: pendingPlan.id,
    name: pendingPlan.plan?.title || 'AI Workout Plan',
    duration_days: pendingPlan.plan?.duration_days || 7,
    exercises: (pendingPlan.plan?.days || [])
      .flatMap((day: any) => day?.exercises || [])
      .map((exercise: any) => exercise?.name)
      .filter(Boolean),
    status: 'pending' as const,
    created_at: pendingPlan.plan?.created_at || new Date().toISOString(),
  } : null;

  const nutritionApprovalPlan = pendingPlan?.type === 'nutrition' ? {
    id: pendingPlan.id,
    daily_calories: Number(pendingPlan.plan?.daily_calories || 0),
    meals: ((pendingPlan.plan?.days || [])[0]?.meals || []).map((meal: any) => ({
      name: meal?.name || 'Meal',
      macros: {
        protein: Number(meal?.protein || 0),
        carbs: Number(meal?.carbs || 0),
        fat: Number(meal?.fat || 0),
      },
    })),
    status: 'pending' as const,
    created_at: pendingPlan.plan?.created_at || new Date().toISOString(),
  } : null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;

    e.preventDefault();
    sendMessage();
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(language === 'ar' ? 'ar' : 'en', { month: 'short', day: 'numeric' });
  };
  const cleanContent = (content: string) => content;

  const handleVoiceSelect = (voiceName: string) => {
    setSelectedVoice(voiceName);
    localStorage.setItem('fitcoach_voice', voiceName);
  };

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Bot className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              {language === 'ar' ? 'سجل دخولك للتحدث مع المدرب' : 'Sign in to chat with your AI Coach'}
            </p>
            <Button variant="hero" onClick={() => window.location.href = '/auth?force=1'}>
              {language === 'ar' ? 'تسجيل الدخول' : 'Sign In'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <div className="flex-1 flex pt-16 pb-20 md:pb-0">
        {/* Sidebar - Desktop */}
        <aside className="hidden md:flex w-72 flex-col border-r border-border/50 bg-card/50">
          <div className="p-4">
            <Button variant="hero" className="w-full" onClick={createConversation}>
              <Plus className="w-4 h-4" />
              {t('coach.newChat')}
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin px-2">
            {conversations.map(conv => (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => selectConversation(conv.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { selectConversation(conv.id); } }}
                className={`w-full text-left px-3 py-3 rounded-xl mb-1 flex items-center gap-3 transition-all group ${
                  conv.id === currentId ? 'bg-primary/10 text-primary' : 'hover:bg-secondary/50 text-muted-foreground'
                }`}
              >
                <MessageSquare className="w-4 h-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{conv.title || t('coach.newChat')}</p>
                  <p className="text-xs opacity-60">{formatDate(conv.updated_at)}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* Mobile Sidebar Overlay */}
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden"
                onClick={() => setSidebarOpen(false)} />
              <motion.aside
                initial={{ x: language === 'ar' ? 300 : -300 }} animate={{ x: 0 }} exit={{ x: language === 'ar' ? 300 : -300 }}
                className="fixed top-16 bottom-0 w-72 bg-card border-r border-border/50 z-50 md:hidden flex flex-col"
                style={{ [language === 'ar' ? 'right' : 'left']: 0 }}
              >
                <div className="p-4 flex items-center justify-between">
                  <Button variant="hero" size="sm" onClick={createConversation} className="flex-1">
                    <Plus className="w-4 h-4" />
                    {t('coach.newChat')}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="ml-2">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto px-2">
                  {conversations.map(conv => (
                    <button key={conv.id} onClick={() => selectConversation(conv.id)}
                      className={`w-full text-left px-3 py-3 rounded-xl mb-1 flex items-center gap-3 transition-all ${
                        conv.id === currentId ? 'bg-primary/10 text-primary' : 'hover:bg-secondary/50 text-muted-foreground'
                      }`}
                    >
                      <MessageSquare className="w-4 h-4 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{conv.title || t('coach.newChat')}</p>
                        <p className="text-xs opacity-60">{formatDate(conv.updated_at)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Main Chat Area */}
        <main className="flex-1 flex flex-col max-w-4xl mx-auto w-full px-4">
          <div className="flex items-center gap-3 py-3 border-b border-border/30">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu className="w-5 h-5" />
            </Button>
            <div className="w-10 h-10 rounded-full bg-gradient-primary flex items-center justify-center shadow-glow">
              <Bot className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="flex-1">
              <h1 className="font-semibold text-foreground">{t('coach.title')}</h1>
              <p className="text-xs text-muted-foreground">{t('coach.subtitle')}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setShowVoiceSettings(!showVoiceSettings)}>
              <Settings2 className="w-4 h-4" />
            </Button>
            <Button variant={showRagDebug ? 'default' : 'ghost'} size="sm" onClick={() => setShowRagDebug((prev) => !prev)}>
              RAG
            </Button>
            {isSupported && (
              <Button
                variant={voiceMode ? 'default' : 'ghost'}
                size="icon"
                onClick={toggleVoiceMode}
                title={language === 'ar' ? 'وضع محادثة صوتية' : 'Voice Conversation Mode'}
              >
                {voiceMode ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </Button>
            )}
            <Button
              variant={autoSpeak ? 'default' : 'ghost'} size="icon"
              onClick={() => { setAutoSpeak(!autoSpeak); if (isAssistantSpeaking) stopAllSpeech(); }}
            >
              {autoSpeak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </Button>
          </div>

          {/* Voice Settings */}
          <AnimatePresence>
            {showVoiceSettings && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden border-b border-border/30"
              >
                <div className="p-3 flex items-center gap-3">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {language === 'ar' ? 'صوت المدرب:' : 'Coach voice:'}
                  </span>
                  <Select value={selectedVoice || 'default'} onValueChange={handleVoiceSelect}>
                    <SelectTrigger className="flex-1 bg-secondary/50 border-0 h-9">
                      <SelectValue placeholder={language === 'ar' ? 'افتراضي' : 'Default'} />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectItem value="default">{language === 'ar' ? 'افتراضي' : 'Default'}</SelectItem>
                      {filteredVoices.length > 0 && (
                        <>
                          <div className="px-2 py-1 text-xs text-muted-foreground font-semibold">
                            {language === 'ar' ? 'أصوات عربية' : 'Matching Language'}
                          </div>
                          {filteredVoices.map((voice) => (
                            <SelectItem key={voice.name} value={voice.name}>
                              {voice.name} ({voice.lang})
                            </SelectItem>
                          ))}
                        </>
                      )}
                      {availableVoices.filter(v => !filteredVoices.includes(v)).length > 0 && (
                        <>
                          <div className="px-2 py-1 text-xs text-muted-foreground font-semibold">
                            {language === 'ar' ? 'أصوات أخرى' : 'Other Voices'}
                          </div>
                          {availableVoices.filter(v => !filteredVoices.includes(v)).map((voice) => (
                            <SelectItem key={voice.name} value={voice.name}>
                              {voice.name} ({voice.lang})
                            </SelectItem>
                          ))}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="ghost" onClick={() => speakWithVoice(language === 'ar' ? 'مرحبًا، أنا مدربك الشخصي' : 'Hello, I am your personal coach')}>
                    <Volume2 className="w-4 h-4" />
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto scrollbar-thin space-y-4 py-4">
            {currentMessages.map((message, index) => (
              <motion.div key={`${currentId}-${index}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  message.role === 'user' ? 'bg-accent' : 'bg-gradient-primary'
                }`}>
                  {message.role === 'user' ? <User className="w-4 h-4 text-accent-foreground" /> : <Bot className="w-4 h-4 text-primary-foreground" />}
                </div>
                <div className="max-w-[80%] group relative">
                  <div className={`p-4 ${message.role === 'user' ? 'chat-bubble-user text-primary-foreground' : 'chat-bubble-ai text-foreground'}`}>
                    {message.role === 'assistant' ? (
                      <div className="prose prose-sm prose-invert max-w-none">
                        <ReactMarkdown>{cleanContent(message.content)}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>
                  {message.role === 'assistant' && (
                    <button onClick={() => isAssistantSpeaking ? stopAllSpeech() : speakWithVoice(message.content)}
                      className="absolute -bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-card border border-border rounded-full p-1.5 hover:bg-secondary"
                    >
                      {isAssistantSpeaking ? <VolumeX className="w-3 h-3 text-muted-foreground" /> : <Volume2 className="w-3 h-3 text-muted-foreground" />}
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
            {isLoading && !isTypingReply && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center">
                  <Bot className="w-4 h-4 text-primary-foreground" />
                </div>
                <div className="chat-bubble-ai p-4">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">{language === 'ar' ? 'جاري التفكير...' : 'Thinking...'}</span>
                  </div>
                </div>
              </motion.div>
            )}
            {isVoiceProcessing && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center">
                  <Bot className="w-4 h-4 text-primary-foreground" />
                </div>
                <div className="chat-bubble-ai p-4">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">
                      {language === 'ar' ? 'جاري معالجة الصوت...' : 'Processing voice...'}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {showRagDebug && (
            <div className="mb-4 rounded-2xl border border-border/60 bg-card/70 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">RAG Debug</h2>
                  <p className="text-xs text-muted-foreground">
                    {language === 'ar' ? 'فحص المقاطع المسترجعة وسياق التقدم من قاعدة البيانات' : 'Inspect retrieved chunks and database-backed progress context'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const latestUserMessage = [...currentMessages].reverse().find((message) => message.role === 'user');
                    void loadRagDebug(latestUserMessage?.content || 'progress');
                  }}
                  disabled={ragDebugLoading}
                >
                  {ragDebugLoading ? 'Loading...' : 'Refresh'}
                </Button>
              </div>

              {ragDebugError && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {ragDebugError}
                </div>
              )}

              {ragDebugData?.database?.counts && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  {Object.entries(ragDebugData.database.counts).map(([key, value]) => (
                    <div key={key} className="rounded-xl bg-secondary/40 px-3 py-2">
                      <div className="text-muted-foreground">{key}</div>
                      <div className="font-semibold text-foreground">{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {ragDebugData?.database?.tracking_summary?.progress_metrics && (
                <pre className="overflow-x-auto rounded-xl bg-secondary/30 p-3 text-xs text-foreground whitespace-pre-wrap">
                  {JSON.stringify(ragDebugData.database.tracking_summary.progress_metrics, null, 2)}
                </pre>
              )}

              <div className="space-y-2">
                {(ragDebugData?.hits || []).map((hit, index) => (
                  <div key={`${hit.id || 'hit'}-${index}`} className="rounded-xl border border-border/40 bg-background/50 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-2">
                      <span>{hit.namespace || 'rag'}</span>
                      {typeof hit.score === 'number' && <span>{hit.score.toFixed(3)}</span>}
                      {hit.metadata?.kind && <span>{String(hit.metadata.kind)}</span>}
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{repairMojibake(hit.text || '')}</p>
                  </div>
                ))}
                {!ragDebugLoading && (ragDebugData?.hits || []).length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    {language === 'ar' ? 'لا توجد مقاطع مسترجعة بعد.' : 'No retrieved chunks yet.'}
                  </div>
                )}
              </div>
            </div>
          )}

          {workoutApprovalPlan && (
            <div className="mb-4">
              <PlanApprovalUI
                type="workout"
                plan={workoutApprovalPlan}
                onApprove={handleApprovePlan}
                onReject={handleRejectPlan}
              />
            </div>
          )}

          {nutritionApprovalPlan && (
            <div className="mb-4">
              <PlanApprovalUI
                type="nutrition"
                plan={nutritionApprovalPlan}
                onApprove={handleApprovePlan}
                onReject={handleRejectPlan}
              />
            </div>
          )}

          {/* Voice Indicator */}
          <AnimatePresence>
            {isListening && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
                className="flex items-center justify-center gap-3 py-3"
              >
                <div className="flex items-center gap-2 bg-destructive/10 text-destructive px-4 py-2 rounded-full">
                  <div className="w-3 h-3 bg-destructive rounded-full animate-pulse" />
                  <span className="text-sm font-medium">
                    {language === 'ar' ? 'جاري الاستماع... اضغط المايك للإرسال' : 'Listening... tap mic again to send'}
                  </span>
                  <button onClick={stopListening} className="ml-2"><MicOff className="w-4 h-4" /></button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {isAssistantSpeaking && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
                className="flex items-center justify-center gap-3 py-1"
              >
                <div className="flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full">
                  <Volume2 className="w-4 h-4 animate-pulse" />
                  <span className="text-sm font-medium">
                    {language === 'ar' ? 'المدرب يتحدث...' : 'Coach is speaking...'}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {voiceError && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                className="flex items-center justify-center py-1"
              >
                <button
                  type="button"
                  onClick={clearError}
                  className="text-xs text-destructive/90 bg-destructive/10 border border-destructive/30 rounded-full px-3 py-1"
                >
                  {voiceError}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input */}
          <div className="glass-card rounded-2xl p-3 mb-4">
            <div className="flex gap-2 items-end">
              {isSupported && (
                <Button variant={isListening ? 'destructive' : 'ghost'} size="icon"
                  onClick={isListening ? stopListening : startListeningIfPossible}
                  disabled={isBusy || isAssistantSpeaking}
                  className={`shrink-0 ${isListening ? 'animate-pulse' : ''}`}
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
              )}
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  language === 'ar'
                    ? 'اكتب رسالتك...'
                    : 'Type your message...'
                }
                className="bg-secondary/50 border-0 focus-visible:ring-1 min-h-[52px] max-h-40 resize-y"
                disabled={isBusy}
                rows={2}
              />
              <Button variant="hero" size="icon" onClick={sendMessage} disabled={isBusy || !input.trim()} className="shrink-0">
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
