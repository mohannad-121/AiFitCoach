import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Bot, User, Loader2, Mic, MicOff, Volume2, VolumeX, Plus, MessageSquare, Trash2, Menu, X, Settings2, Paperclip, FileText, FileImage, Copy, Check, Lock } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AI_BACKEND_URL, isPublicAppOrigin } from '@/lib/backendUrl';
import { getTextDirection, repairMojibake, stabilizeBidiNumbers } from '@/lib/text';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useUser } from '@/contexts/UserContext';
import { useVoiceChat, type VoiceChatApiResponse } from '@/hooks/useVoiceChat';
import { supabase } from '@/integrations/supabase/client';
import { PlanApprovalUI } from '@/components/ai/PlanApprovalUI';
import { useLocation, useNavigate } from 'react-router-dom';
import { exercises } from '@/data/exercises';
import { authHeaders } from '@/lib/subscription';
import { UsageWidget } from '@/components/subscription/UsageWidget';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';
import { useSubscription } from '@/hooks/useSubscription';
import { isPlanGenerationRequest } from '@/lib/planGeneration';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  attachments?: MessageAttachment[];
}

interface MessageAttachment {
  id: string;
  filename: string;
  kind: 'pdf' | 'image';
  sizeBytes: number;
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

interface PlanChoiceOption {
  index: number;
  title: string;
  summary: string;
}

interface PendingPlanOptionsState {
  type: 'workout' | 'nutrition';
  options: PlanChoiceOption[];
  page: number;
  totalPages: number;
}
interface PendingProfileConfirmationState {
  field: string;
  fieldLabel: string;
  displayValue: string;
}

interface ProfileUpdateFeedbackState {
  field: string;
  fieldLabel: string;
  displayValue: string;
  message: string;
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

interface PendingAttachment {
  id: string;
  file: File;
  kind: 'pdf' | 'image';
  previewUrl: string | null;
}

interface FitbitSummarySection {
  title: string;
  rows: Array<{ label: string; value: string }>;
  paragraphs: string[];
}

interface FitbitSummaryCardData {
  heading: string;
  intro: string[];
  sections: FitbitSummarySection[];
}

const EMOJI_REGEX = /([\p{Extended_Pictographic}\uFE0F]+)/gu;

const renderTextWithEmoji = (text: string, keyPrefix: string) => {
  const parts = text.split(EMOJI_REGEX);
  return parts.filter(Boolean).map((part, index) => {
    if (EMOJI_REGEX.test(part)) {
      EMOJI_REGEX.lastIndex = 0;
      return (
        <span key={`${keyPrefix}-emoji-${index}`} className="chat-emoji" aria-hidden="true">
          {part}
        </span>
      );
    }
    EMOJI_REGEX.lastIndex = 0;
    return <React.Fragment key={`${keyPrefix}-text-${index}`}>{part}</React.Fragment>;
  });
};

const renderEmojiAwareChildren = (children: React.ReactNode, keyPrefix: string): React.ReactNode =>
  React.Children.map(children, (child, index) => {
    const nextKey = `${keyPrefix}-${index}`;
    if (typeof child === 'string') {
      return renderTextWithEmoji(child, nextKey);
    }
    if (Array.isArray(child)) {
      return renderEmojiAwareChildren(child, nextKey);
    }
    return child;
  });

const CHAT_REQUEST_TIMEOUT_MS = 120000;
const ATTACHMENT_REQUEST_TIMEOUT_MS = 240000;
const NUTRITION_PREFIX = '\u{1F37D}\uFE0F';
const ARABIC_VOICE_AGENT_ID = '__arabic_voice_agent__';
const LEGACY_ARABIC_VOICE_AGENT_ID = '__backend_arabic_ai__';
const MAX_CHAT_ATTACHMENTS = 4;
const MAX_CHAT_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const ATTACHMENT_META_PREFIX = '[[fitcoach_attachments:';
const ATTACHMENT_META_SUFFIX = ']]';
const URGENT_HEART_RATE_PATTERN = /\b(heart|hr|pulse|bpm|tachycardia|قلب|نبض|دقات)\b/i;
const HIGH_HEART_RATE_PATTERN = /\b(1[6-9]\d|2\d\d)\b/;
const PLAN_REJECT_TEXTS = [
  'reject',
  'decline',
  'cancel',
  'cancel it',
  'stop',
  'no',
  'رفض',
  'ارفض',
  'لا',
  'الغاء',
  'إلغاء',
  'الغي',
  'إلغي',
  'ألغ',
  'ألغِ',
  'الغ',
  'الغِ',
  'كنسل',
  'ما بدي',
  'مش بدي',
];
const WEEK_TEMPLATE = [
  { day: 'Saturday', dayAr: 'السبت' },
  { day: 'Sunday', dayAr: 'الأحد' },
  { day: 'Monday', dayAr: 'الاثنين' },
  { day: 'Tuesday', dayAr: 'الثلاثاء' },
  { day: 'Wednesday', dayAr: 'الأربعاء' },
  { day: 'Thursday', dayAr: 'الخميس' },
  { day: 'Friday', dayAr: 'الجمعة' },
];
const JS_WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

interface CoachNavigationState {
  coachPrompt?: string;
  coachPromptId?: string;
  autoSendCoachPrompt?: boolean;
}

const DAY_NAME_TO_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  'الأحد': 0,
  'الاثنين': 1,
  'الثلاثاء': 2,
  'الأربعاء': 3,
  'الخميس': 4,
  'الجمعة': 5,
  'السبت': 6,
};

const getUrgentHeartRateFallback = (text: string, language: 'en' | 'ar'): string | null => {
  if (!URGENT_HEART_RATE_PATTERN.test(text) || !HIGH_HEART_RATE_PATTERN.test(text)) {
    return null;
  }

  if (language === 'ar') {
    return [
      'معدل نبض قريب من 180 أثناء التمرين يحتاج حذر، خصوصاً إذا كان غير معتاد أو معه ألم صدر، ضيق نفس، دوخة، إغماء، غثيان، أو خفقان قوي.',
      '',
      'أوقفي التمرين الآن، اجلسي أو استلقي، واشربي ماء بهدوء. إذا بقي النبض مرتفعاً بعد 5-10 دقائق راحة، أو ظهرت أي أعراض من المذكورة، تواصلي مع الطوارئ أو طبيب فوراً.',
      '',
      'لا تكملي الحصة اليوم قبل تقييم طبي، خصوصاً إذا تكرر هذا الرقم.',
    ].join('\n');
  }

  return [
    'A heart rate around 180 bpm during Pilates needs caution, especially if it is unusual for you or comes with chest pain, shortness of breath, dizziness, fainting, nausea, or strong palpitations.',
    '',
    'Stop exercising now, sit or lie down, and sip water. If your heart rate stays very high after 5-10 minutes of rest, or you have any of those symptoms, contact emergency services or a clinician right away.',
    '',
    'Do not continue today\'s class until you are medically cleared, especially if this has happened more than once.',
  ].join('\n');
};

const buildWorkoutDayNames = (daysPerWeek: number, anchorDate?: string | null) => {
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
  const parsedAnchor = anchorDate ? new Date(anchorDate) : new Date();
  const safeAnchor = Number.isNaN(parsedAnchor.getTime()) ? new Date() : parsedAnchor;
  const anchorJsDay = safeAnchor.getDay();
  const jsDays = Array.from(new Set((patterns[clamped] || patterns[3]).map((offset) => (anchorJsDay + offset) % 7)));

  jsDays.sort((left, right) => ((left + 1) % 7) - ((right + 1) % 7));
  return jsDays.map((dayIndex) => JS_WEEKDAY_NAMES[dayIndex]);
};

const toIsoDay = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  return date.toISOString().slice(0, 10);
};

const formatIsoLocalDay = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizePlanCommandText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[إأآا]/g, 'ا')
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isPlanRejectText = (value: string) => {
  const normalized = normalizePlanCommandText(value);
  if (!normalized) return false;
  return PLAN_REJECT_TEXTS.some((keyword) => {
    const normalizedKeyword = normalizePlanCommandText(keyword);
    return normalized === normalizedKeyword || normalized.includes(normalizedKeyword);
  });
};

const getPlanDayIndex = (dayStr?: string | null) => {
  const normalized = String(dayStr || '').toLowerCase().split(' - ')[0].split(' – ')[0].trim();
  return DAY_NAME_TO_INDEX[normalized] ?? -1;
};

const getPlanWindowStart = (createdAt?: string | null) => {
  if (!createdAt) return null;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;
  created.setHours(0, 0, 0, 0);
  return created;
};

const planAppliesToDate = (createdAt: string | undefined, date: Date) => {
  const start = getPlanWindowStart(createdAt);
  if (!start) return true;
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return target >= start && target <= end;
};

const countDateStreak = (dates: Set<string>, fromDate = new Date()) => {
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);
  let streak = 0;

  while (dates.has(formatIsoLocalDay(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
};

const cleanNote = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim();

const looksLikeBadArabic = (value: string) => /[\u00d8\u00d9\u00c3\u00d0]/.test(value);

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
const getLocalCompletionsStorageKey = (userId: string) => `fitcoach_schedule_completions_${userId}`;
const getVoiceStorageKey = (language: 'en' | 'ar') => `fitcoach_voice_${language}`;

const normalizeStoredVoice = (voiceName: string, targetLanguage: 'en' | 'ar') => {
  if (voiceName === LEGACY_ARABIC_VOICE_AGENT_ID) {
    return ARABIC_VOICE_AGENT_ID;
  }
  if (!voiceName && targetLanguage === 'ar') {
    return ARABIC_VOICE_AGENT_ID;
  }
  return voiceName;
};

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

const readLocalCompletions = (userId: string): CompletionRow[] => {
  try {
    const raw = localStorage.getItem(getLocalCompletionsStorageKey(userId));
    return raw ? (JSON.parse(raw) as CompletionRow[]) : [];
  } catch {
    return [];
  }
};

const writeLocalPlans = (userId: string, plans: StoredSchedulePlan[]) => {
  localStorage.setItem(getLocalPlansStorageKey(userId), JSON.stringify(plans));
};

const formatAttachmentSize = (sizeBytes: number) => {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
};

const getAttachmentKind = (file: File): PendingAttachment['kind'] | null => {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return 'pdf';
  }
  if (file.type.startsWith('image/')) {
    return 'image';
  }
  return null;
};

const cleanMessageContent = (content: string) => content;

const getDisplayMessageContent = (content: string, language: 'en' | 'ar') => {
  const cleaned = cleanMessageContent(content);
  return language === 'ar' ? stabilizeBidiNumbers(cleaned) : cleaned;
};

const buildOutgoingUserMessage = (message: ChatMessage, language: 'en' | 'ar') => {
  const trimmed = cleanMessageContent(message.content).trim();
  const attachments = message.attachments || [];
  if (!attachments.length) return trimmed;
  const prefix = language === 'ar' ? 'المرفقات' : 'Attachments';
  const names = attachments.map((item) => item.filename).join(', ');
  return trimmed ? `${trimmed}\n\n${prefix}: ${names}` : `${prefix}: ${names}`;
};

const toMessageAttachments = (attachments: PendingAttachment[]): MessageAttachment[] =>
  attachments.map((item) => ({
    id: item.id,
    filename: item.file.name,
    kind: item.kind,
    sizeBytes: item.file.size,
  }));

const encodeAttachmentMetadata = (attachments: MessageAttachment[]) => {
  if (!attachments.length) return '';
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(attachments))));
  } catch {
    return '';
  }
};

const decodeAttachmentMetadata = (value: string): MessageAttachment[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(value))));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item, index) => ({
        id: String(item.id || `attachment-${index}`),
        filename: String(item.filename || 'attachment'),
        kind: item.kind === 'image' ? 'image' : 'pdf',
        sizeBytes: Number(item.sizeBytes || 0),
      }));
  } catch {
    return [];
  }
};

const serializeStoredMessageContent = (content: string, attachments: MessageAttachment[]) => {
  const trimmed = content.trim();
  if (!attachments.length) return trimmed;
  const encoded = encodeAttachmentMetadata(attachments);
  if (!encoded) return trimmed;
  return `${ATTACHMENT_META_PREFIX}${encoded}${ATTACHMENT_META_SUFFIX}${trimmed ? `\n${trimmed}` : ''}`;
};

const parseStoredMessageContent = (storedContent: string) => {
  const raw = String(storedContent || '');
  if (!raw.startsWith(ATTACHMENT_META_PREFIX)) {
    return { content: raw, attachments: [] as MessageAttachment[] };
  }

  const suffixIndex = raw.indexOf(ATTACHMENT_META_SUFFIX, ATTACHMENT_META_PREFIX.length);
  if (suffixIndex < 0) {
    return { content: raw, attachments: [] as MessageAttachment[] };
  }

  const encoded = raw.slice(ATTACHMENT_META_PREFIX.length, suffixIndex);
  const content = raw.slice(suffixIndex + ATTACHMENT_META_SUFFIX.length).replace(/^\n+/, '');
  return {
    content,
    attachments: decodeAttachmentMetadata(encoded),
  };
};

const normalizeChatMessage = (message: Partial<ChatMessage>): ChatMessage => {
  const parsed = parseStoredMessageContent(String(message.content || ''));
  return {
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: parsed.content,
    timestamp: Number(message.timestamp || Date.now()),
    attachments: Array.isArray(message.attachments) && message.attachments.length > 0 ? message.attachments : parsed.attachments,
  };
};

const buildMessageCopyText = (message: ChatMessage, language: 'en' | 'ar') => {
  const visibleText = getDisplayMessageContent(message.content, language).trim();
  const attachments = message.attachments || [];
  const parts: string[] = [];
  if (attachments.length) {
    const prefix = language === 'ar' ? 'المرفقات' : 'Attachments';
    parts.push(`${prefix}: ${attachments.map((item) => item.filename).join(', ')}`);
  }
  if (visibleText) {
    parts.push(visibleText);
  }
  return parts.join('\n\n').trim();
};

const FITBIT_SUMMARY_HEADINGS = [
  'الحالة الخاصة ببيانات fitbit',
  'الحالة الخاصة ببيانات fitbit:',
  'fitbit summary',
  'fitbit data summary',
];

const FITBIT_SECTION_TITLES = [
  'خلاصة اليوم',
  'ملخص اليوم',
  'متوسط آخر أسبوع',
  'متوسط آخر 7 أيام',
  'ملاحظات إضافية',
  'الخطوة التالية',
  'today summary',
  '7-day average',
  'weekly average',
  'notes',
  'next step',
];

const normalizeFitbitLine = (line: string) =>
  line
    .trim()
    .replace(/^[-*•]\s*/, '')
    .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u, '')
    .trim();

const isFitbitSummaryMessage = (content: string) => {
  const normalized = content.trim().toLowerCase();
  return FITBIT_SUMMARY_HEADINGS.some((heading) => normalized.includes(heading));
};

const isFitbitSectionTitle = (line: string) => {
  const normalized = normalizeFitbitLine(line).toLowerCase().replace(/:$/, '').trim();
  return FITBIT_SECTION_TITLES.some((title) => normalized === title);
};

const splitFitbitMetricLine = (line: string) => {
  const normalized = normalizeFitbitLine(line);
  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex >= normalized.length - 1) {
    return null;
  }

  const label = normalized.slice(0, separatorIndex).trim();
  const value = normalized.slice(separatorIndex + 1).trim();
  if (!label || !value) {
    return null;
  }

  return { label, value };
};

const parseFitbitSummaryCard = (content: string): FitbitSummaryCardData | null => {
  if (!isFitbitSummaryMessage(content)) {
    return null;
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return null;
  }

  const heading = normalizeFitbitLine(lines[0]);
  const sections: FitbitSummarySection[] = [];
  const intro: string[] = [];
  let currentSection: FitbitSummarySection | null = null;

  for (const rawLine of lines.slice(1)) {
    const line = normalizeFitbitLine(rawLine);
    if (!line) {
      continue;
    }

    if (isFitbitSectionTitle(line)) {
      currentSection = {
        title: line.replace(/:$/, '').trim(),
        rows: [],
        paragraphs: [],
      };
      sections.push(currentSection);
      continue;
    }

    const metric = splitFitbitMetricLine(line);
    if (metric && currentSection) {
      currentSection.rows.push(metric);
      continue;
    }

    if (currentSection) {
      currentSection.paragraphs.push(line);
    } else {
      intro.push(line);
    }
  }

  if (!sections.length && !intro.length) {
    return null;
  }

  return { heading, intro, sections };
};

const FitbitSummaryCard = ({ data }: { data: FitbitSummaryCardData }) => (
  <section className="fitbit-summary-card" dir="rtl">
    <header className="fitbit-summary-header">
      <h3>{data.heading}</h3>
      {data.intro.length > 0 && (
        <div className="fitbit-summary-intro">
          {data.intro.map((paragraph, index) => (
            <p key={`fitbit-intro-${index}`}>{paragraph}</p>
          ))}
        </div>
      )}
    </header>

    <div className="fitbit-summary-sections">
      {data.sections.map((section, sectionIndex) => (
        <section key={`fitbit-section-${sectionIndex}`} className="fitbit-summary-section">
          <h4>{section.title}</h4>
          {section.rows.length > 0 && (
            <dl className="fitbit-summary-grid">
              {section.rows.map((row, rowIndex) => (
                <div key={`fitbit-row-${sectionIndex}-${rowIndex}`} className="fitbit-summary-row">
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {section.paragraphs.length > 0 && (
            <div className="fitbit-summary-notes">
              {section.paragraphs.map((paragraph, paragraphIndex) => (
                <p key={`fitbit-note-${sectionIndex}-${paragraphIndex}`}>{paragraph}</p>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  </section>
);

export function CoachPage() {
  const [upgradeReason, setUpgradeReason] = useState('');
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { profile, updateProfile } = useUser();
  const { subscription, loading: subscriptionLoading, error: subscriptionError, refresh: refreshSubscription } = useSubscription();
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
  const [pendingPlanOptions, setPendingPlanOptions] = useState<PendingPlanOptionsState | null>(null);
  const [pendingProfileConfirmation, setPendingProfileConfirmation] = useState<PendingProfileConfirmationState | null>(null);
  const [profileUpdateFeedback, setProfileUpdateFeedback] = useState<ProfileUpdateFeedbackState | null>(null);
  const [showRagDebug, setShowRagDebug] = useState(false);
  const [ragDebugData, setRagDebugData] = useState<RagDebugData | null>(null);
  const [ragDebugLoading, setRagDebugLoading] = useState(false);
  const [ragDebugError, setRagDebugError] = useState('');
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    const savedVoice = localStorage.getItem(getVoiceStorageKey(language)) || localStorage.getItem('fitcoach_voice') || '';
    return normalizeStoredVoice(savedVoice, language);
  });
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceMode, setVoiceMode] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [pendingVoiceResponse, setPendingVoiceResponse] = useState<VoiceChatApiResponse | null>(null);
  const [selectedAttachments, setSelectedAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const isUnlimited = Boolean(subscription?.isUnlimited);
  const usage = subscription?.usage;
  const messagesLeft = usage?.chatMessagesLimit == null ? Infinity : Math.max(0, usage.chatMessagesLimit - usage.chatMessagesUsed);
  const uploadsLeft = usage?.uploadsLimit == null ? Infinity : Math.max(0, usage.uploadsLimit - usage.uploadsUsed);
  const plansLeft = usage?.generatedPlansLimit == null ? Infinity : Math.max(0, usage.generatedPlansLimit - usage.generatedPlansUsed);
  const isChatLimitReached = Boolean(subscription && !isUnlimited && messagesLeft <= 0);
  const isUploadLimitReached = Boolean(subscription && !isUnlimited && uploadsLeft <= 0);
  const isPlanLimitReached = Boolean(subscription && !isUnlimited && plansLeft <= 0);
  const isSubscriptionGateLoading = subscriptionLoading && !subscription && !subscriptionError;

  const showLimit = useCallback((kind: 'chat' | 'upload' | 'plan') => {
    if (isUnlimited) return;
    setUpgradeReason({
      chat: 'You used all chat messages included in your current plan.',
      upload: 'You used all file uploads included in your current plan.',
      plan: 'You used all personalized plan generations included in your current plan.',
    }[kind]);
  }, [isUnlimited]);

  const markdownComponents = useMemo(
    () => ({
      p: ({ children }: { children?: React.ReactNode }) => <p>{renderEmojiAwareChildren(children, 'md-p')}</p>,
      li: ({ children }: { children?: React.ReactNode }) => <li>{renderEmojiAwareChildren(children, 'md-li')}</li>,
      strong: ({ children }: { children?: React.ReactNode }) => <strong>{renderEmojiAwareChildren(children, 'md-strong')}</strong>,
      em: ({ children }: { children?: React.ReactNode }) => <em>{renderEmojiAwareChildren(children, 'md-em')}</em>,
      h1: ({ children }: { children?: React.ReactNode }) => <h1>{renderEmojiAwareChildren(children, 'md-h1')}</h1>,
      h2: ({ children }: { children?: React.ReactNode }) => <h2>{renderEmojiAwareChildren(children, 'md-h2')}</h2>,
      h3: ({ children }: { children?: React.ReactNode }) => <h3>{renderEmojiAwareChildren(children, 'md-h3')}</h3>,
      blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote>{renderEmojiAwareChildren(children, 'md-quote')}</blockquote>,
      code: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
        <code className={className}>{renderEmojiAwareChildren(children, 'md-code')}</code>
      ),
    }),
    []
  );


  const [websiteContext, setWebsiteContext] = useState<Record<string, unknown>>({});
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const selectedAttachmentsRef = useRef<PendingAttachment[]>([]);
  const currentMessagesRef = useRef<ChatMessage[]>([]);
  const voiceModeRef = useRef(false);
  const assistantAudioRef = useRef<HTMLAudioElement | null>(null);
  const processedCoachPromptRef = useRef<string | null>(null);
  const approvingPlanIdsRef = useRef<Set<string>>(new Set());
  const coachNavigationState = (location.state as CoachNavigationState | null) || null;

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

  const clearPendingAttachments = useCallback(() => {
    setSelectedAttachments((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      return [];
    });
  }, []);

  const removePendingAttachment = useCallback((attachmentId: string) => {
    setSelectedAttachments((prev) => {
      const target = prev.find((item) => item.id === attachmentId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== attachmentId);
    });
  }, []);

  useEffect(() => {
    selectedAttachmentsRef.current = selectedAttachments;
  }, [selectedAttachments]);

  useEffect(() => {
    return () => {
      selectedAttachmentsRef.current.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, []);

  const openAttachmentPicker = useCallback(() => {
    if (subscriptionLoading || !subscription) return;
    if (isUploadLimitReached) {
      showLimit('upload');
      return;
    }
    setAttachmentError('');
    attachmentInputRef.current?.click();
  }, [isUploadLimitReached, showLimit, subscription, subscriptionLoading]);

  const handleAttachmentSelection = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    if (subscriptionLoading || !subscription) return;
    if (isUploadLimitReached) {
      setAttachmentError('Upload limit reached. Upgrade your plan to upload more files.');
      showLimit('upload');
      return;
    }

    setSelectedAttachments((prev) => {
      const next = [...prev];
      const localErrors: string[] = [];

      for (const file of files) {
        if (!isUnlimited && next.length >= uploadsLeft) {
          localErrors.push('Upload limit reached. Upgrade your plan to upload more files.');
          showLimit('upload');
          break;
        }
        if (next.length >= MAX_CHAT_ATTACHMENTS) {
          localErrors.push(
            language === 'ar'
              ? `يمكنك رفع ${MAX_CHAT_ATTACHMENTS} ملفات كحد أقصى في الرسالة الواحدة.`
              : `You can attach up to ${MAX_CHAT_ATTACHMENTS} files per message.`
          );
          break;
        }

        const kind = getAttachmentKind(file);
        if (!kind) {
          localErrors.push(
            language === 'ar'
              ? `${file.name}: النوع غير مدعوم. ارفع PDF أو صورة.`
              : `${file.name}: unsupported type. Upload a PDF or image.`
          );
          continue;
        }

        if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
          localErrors.push(
            language === 'ar'
              ? `${file.name}: يجب أن يكون الملف أقل من 12 ميجابايت.`
              : `${file.name}: file must be smaller than 12 MB.`
          );
          continue;
        }

        const duplicate = next.some(
          (item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified
        );
        if (duplicate) {
          continue;
        }

        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          file,
          kind,
          previewUrl: kind === 'image' ? URL.createObjectURL(file) : null,
        });
      }

      setAttachmentError(localErrors.join(' '));
      return next;
    });
  }, [isUnlimited, isUploadLimitReached, language, showLimit, subscription, subscriptionLoading, uploadsLeft]);

  const handleAttachmentDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (subscriptionLoading || !subscription) return;
    if (isUploadLimitReached) {
      setAttachmentError('Upload limit reached. Upgrade your plan to upload more files.');
      showLimit('upload');
      return;
    }
    const files = Array.from(event.dataTransfer.files || []);
    if (!files.length) return;
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    if (attachmentInputRef.current) {
      attachmentInputRef.current.files = transfer.files;
      attachmentInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, [isUploadLimitReached, showLimit, subscription, subscriptionLoading]);

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

  useEffect(() => {
    const savedVoice = localStorage.getItem(getVoiceStorageKey(language)) || '';
    const normalizedVoice = normalizeStoredVoice(savedVoice, language);

    if (savedVoice !== normalizedVoice) {
      localStorage.setItem(getVoiceStorageKey(language), normalizedVoice);
      localStorage.setItem('fitcoach_voice', normalizedVoice);
    }

    setSelectedVoice(normalizedVoice);
  }, [language]);

  // Filter voices by language
  const filteredVoices = availableVoices.filter(v => {
    const voiceLang = (v.lang || '').toLowerCase();
    if (language === 'ar') return voiceLang.startsWith('ar');
    return voiceLang.startsWith('en');
  });

  const isVoiceCompatibleWithLanguage = useCallback((voice: SpeechSynthesisVoice, targetLanguage: 'en' | 'ar') => {
    const voiceLang = (voice.lang || '').toLowerCase();
    return targetLanguage === 'ar' ? voiceLang.startsWith('ar') : voiceLang.startsWith('en');
  }, []);

  const resolvePreferredVoice = useCallback(() => {
    if (selectedVoice === ARABIC_VOICE_AGENT_ID) {
      return undefined;
    }

    const selected = selectedVoice ? availableVoices.find((voice) => voice.name === selectedVoice) : undefined;
    if (selected && isVoiceCompatibleWithLanguage(selected, language)) {
      return selected;
    }

    const rankedVoices = [...filteredVoices].sort((left, right) => {
      const leftLang = (left.lang || '').toLowerCase();
      const rightLang = (right.lang || '').toLowerCase();
      const leftScore = Number(leftLang === 'ar-sa' || leftLang === 'en-us') + Number(left.localService);
      const rightScore = Number(rightLang === 'ar-sa' || rightLang === 'en-us') + Number(right.localService);
      return rightScore - leftScore;
    });

    return rankedVoices[0];
  }, [availableVoices, filteredVoices, isVoiceCompatibleWithLanguage, language, selectedVoice]);

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
    onLimitReached: async () => {
      showLimit('chat');
      await refreshSubscription();
    },
  });
  const isBusy = isLoading || isVoiceProcessing;

  const startListeningIfPossible = useCallback(() => {
    if (!isSupported) return;
    if (subscriptionLoading || !subscription || isChatLimitReached) {
      if (isChatLimitReached) showLimit('chat');
      return;
    }
    if (isLoading || isVoiceProcessing || isListening || isAssistantSpeaking) return;
    clearError();
    startListening();
  }, [isSupported, subscriptionLoading, subscription, isChatLimitReached, showLimit, isLoading, isVoiceProcessing, isListening, isAssistantSpeaking, clearError, startListening]);

  const endVoiceModeTurn = useCallback(() => {
    if (!voiceModeRef.current) {
      return;
    }
    setVoiceMode(false);
    focusInput();
  }, [focusInput]);

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

  const playBackendAudio = useCallback((relativePath?: string) => {
    if (!relativePath) {
      endVoiceModeTurn();
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
        endVoiceModeTurn();
      };
      audio.onerror = () => {
        setIsAssistantSpeaking(false);
        endVoiceModeTurn();
      };
      audio.play().catch(() => {
        setIsAssistantSpeaking(false);
        endVoiceModeTurn();
      });
    } catch {
      setIsAssistantSpeaking(false);
      endVoiceModeTurn();
    }
  }, [endVoiceModeTurn]);

  const speakWithBackendTts = useCallback(async (text: string, targetLanguage?: 'en' | 'ar') => {
    const response = await fetch(`${AI_BACKEND_URL}/tts/speak`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        text,
        language: targetLanguage || language,
      }),
    });

    if (!response.ok) {
      throw new Error(`TTS request failed: ${response.status}`);
    }

    const payload = await response.json() as { audio_path?: string };
    if (!payload.audio_path) {
      throw new Error('TTS response did not include audio_path.');
    }

    playBackendAudio(payload.audio_path);
  }, [language, playBackendAudio]);

  const speakWithVoice = useCallback(async (text: string) => {
    if (!('speechSynthesis' in window)) return;
    const cleanText = text
      .replace(/[#*_~`>]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\n+/g, '. ')
      .trim();

    if (!cleanText) return;

    const resolvedVoice = resolvePreferredVoice();

    if (selectedVoice === ARABIC_VOICE_AGENT_ID) {
      try {
        await speakWithBackendTts(cleanText, 'ar');
        return;
      } catch (error) {
        console.error('Explicit Arabic backend TTS failed:', error);
      }
    }

    if (language === 'ar' && !resolvedVoice) {
      try {
        await speakWithBackendTts(cleanText);
        return;
      } catch (error) {
        console.error('Arabic backend TTS fallback failed:', error);
      }
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = language === 'ar' ? 'ar-SA' : 'en-US';

    if (resolvedVoice) {
      utterance.voice = resolvedVoice;
      utterance.lang = resolvedVoice.lang || utterance.lang;
    }

    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onstart = () => setIsAssistantSpeaking(true);
    utterance.onend = () => {
      setIsAssistantSpeaking(false);
      endVoiceModeTurn();
    };
    utterance.onerror = () => {
      setIsAssistantSpeaking(false);
      endVoiceModeTurn();
    };
    window.speechSynthesis.speak(utterance);
  }, [endVoiceModeTurn, language, resolvePreferredVoice, selectedVoice, speakWithBackendTts]);

  const voicePreviewText = selectedVoice === ARABIC_VOICE_AGENT_ID
    ? 'مرحبا، أنا المساعد الصوتي العربي لفِت كوتش. كيف أقدر أساعدك اليوم؟'
    : (language === 'ar' ? 'مرحبًا، أنا مدربك الشخصي' : 'Hello, I am your personal coach');

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

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const scrollContainer = messagesScrollRef.current;
    if (!scrollContainer) return;
    window.requestAnimationFrame(() => {
      if (typeof scrollContainer.scrollTo === 'function') {
        scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior });
      } else {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    });
  }, []);

  const goToSchedule = useCallback(() => {
    navigate('/schedule?focusToday=1');
    window.setTimeout(() => {
      if (!window.location.pathname.startsWith('/schedule')) {
        window.location.assign('/schedule?focusToday=1');
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
    scrollToBottom(isTypingReply ? 'auto' : 'smooth');
  }, [currentMessages, isTypingReply, scrollToBottom]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  useEffect(() => {
    currentMessagesRef.current = currentMessages;
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

    const responsePayload = pendingVoiceResponse;
    setPendingVoiceResponse(null);

    const applyVoiceResponse = async () => {
      const transcript = (responsePayload.transcript || '').trim();
      const reply = (responsePayload.reply || '').trim();
      const now = Date.now();

      const userMessage: ChatMessage | null = transcript
        ? { role: 'user', content: transcript, timestamp: now }
        : null;
      const assistantMessage: ChatMessage | null = reply
        ? { role: 'assistant', content: reply, timestamp: now + 1 }
        : null;

      const additions = [userMessage, assistantMessage].filter(Boolean) as ChatMessage[];
      if (additions.length === 0) {
        return;
      }

      const updatedMessages = [...currentMessagesRef.current, ...additions];
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

      const pendingFromApi = extractPendingPlanFromResponse(responsePayload);
      if (pendingFromApi) {
        setPendingPlanOptions(null);
        setPendingPlan(pendingFromApi);
      }

      const pendingProfileConfirmationFromVoice = extractPendingProfileConfirmation(responsePayload);
      if (pendingProfileConfirmationFromVoice) {
        setPendingProfileConfirmation(pendingProfileConfirmationFromVoice);
      } else if (responsePayload?.action === 'profile_update_cancelled' || responsePayload?.action === 'profile_updated') {
        setPendingProfileConfirmation(null);
      }

      await persistProfileUpdate(responsePayload);

      const planOptionsFromApi = extractPlanOptionsFromResponse(responsePayload);
      if (planOptionsFromApi) {
        setPendingPlan(null);
        setPendingPlanOptions(planOptionsFromApi);
      }

      const approvedFromApi = extractApprovedPlanFromResponse(responsePayload);
      if (approvedFromApi) {
        try {
          await persistApprovedPlan(responsePayload);
        } catch (error) {
          console.error('Failed saving approved voice plan to Supabase', error);
        } finally {
          setPendingPlan(null);
          setPendingPlanOptions(null);
          goToSchedule();
        }
      }

      await refreshSubscription();

      if (reply && (voiceModeRef.current || autoSpeak)) {
        playBackendAudio(responsePayload.audio_path);
      } else if (voiceModeRef.current) {
        endVoiceModeTurn();
      } else {
        focusInput();
      }
    };

    applyVoiceResponse().catch((err) => {
      console.error('Failed to apply voice response:', err);
    });
  }, [
    autoSpeak,
    currentId,
    endVoiceModeTurn,
    goToSchedule,
    pendingVoiceResponse,
    playBackendAudio,
    focusInput,
    user,
  ]);

  const loadConversations = async () => {
    if (!user) return;
    setLoadingConvs(true);
    const localSnapshot = readLocalConversations(user.id);
    if (localSnapshot.conversations.length > 0) {
      const normalizedConversations = localSnapshot.conversations.map((conversation) => ({
        ...conversation,
        messages: Array.isArray(conversation.messages)
          ? conversation.messages.map((message) => normalizeChatMessage(message))
          : [],
      }));
      setConversations(normalizedConversations);
      setCurrentId(localSnapshot.currentId);
      const selected = normalizedConversations.find((c) => c.id === localSnapshot.currentId) || normalizedConversations[0];
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
            messages: (msgs || []).map(m => normalizeChatMessage({
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
    setPendingPlan(null);
    setPendingPlanOptions(null);
    setPendingProfileConfirmation(null);
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
      setPendingPlanOptions(null);
      setPendingProfileConfirmation(null);
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
    const workoutDayNames = buildWorkoutDayNames(Number.isFinite(requestedDays) ? requestedDays : 3, plan?.created_at);
    const grouped = workoutDayNames.map(() => [] as any[]);

    exercises.forEach((exercise: any, index: number) => {
      grouped[index % workoutDayNames.length].push(exercise);
    });

    return WEEK_TEMPLATE.map((weekDay) => {
      const slot = workoutDayNames.indexOf(weekDay.day);
      const dayExercises = slot >= 0 ? grouped[slot] : [];
      return {
        ...weekDay,
        exercises: dayExercises.map((ex: any) => ({
          name: ex?.name || 'Exercise',
          nameAr: ex?.nameAr || ex?.name || 'تمرين',
          sets: String(ex?.sets ?? ''),
          reps: String(ex?.reps ?? ''),
          rest_seconds: Number(ex?.rest_seconds || 0),
          notes: String(ex?.notes || ''),
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

  const extractPlanOptionsFromResponse = (responseData: any): PendingPlanOptionsState | null => {
    if (responseData?.action !== 'choose_plan' || !Array.isArray(responseData?.data?.options)) {
      return null;
    }

    return {
      type: responseData.data.plan_type === 'nutrition' ? 'nutrition' : 'workout',
      options: responseData.data.options
        .filter((option: any) => typeof option?.index === 'number')
        .map((option: any) => ({
          index: Number(option.index),
          title: String(option.title || ''),
          summary: String(option.summary || ''),
        })),
      page: Number(responseData.data.page || 0),
      totalPages: Number(responseData.data.total_pages || 1),
    };
  };

  const extractPendingProfileConfirmation = (responseData: any): PendingProfileConfirmationState | null => {
    if (responseData?.action !== 'confirm_profile_update' || !responseData?.data?.field) {
      return null;
    }

    return {
      field: String(responseData.data.field || ''),
      fieldLabel: String(responseData.data.field_label || responseData.data.field || ''),
      displayValue: String(responseData.data.display_value || ''),
    };
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

  const persistProfileUpdate = async (responseData: any) => {
    if (!user) return;
    if (responseData?.action !== 'profile_updated') return;

    const profileUpdates = responseData?.data?.profile_updates;
    const supabaseUpdates = responseData?.data?.supabase_updates;
    if (!profileUpdates || typeof profileUpdates !== 'object') return;

    setPendingProfileConfirmation(null);

    updateProfile(profileUpdates as any);
    setProfileUpdateFeedback({
      field: String(responseData?.data?.field || ''),
      fieldLabel: String(responseData?.data?.field_label || responseData?.data?.field || ''),
      displayValue: String(responseData?.data?.display_value || ''),
      message: repairMojibake(String(responseData?.reply || '')),
    });

    if (supabaseUpdates && typeof supabaseUpdates === 'object') {
      try {
        await supabase
          .from('profiles')
          .update(supabaseUpdates)
          .eq('user_id', user.id);
      } catch (error) {
        console.warn('Failed updating profile from AI Coach:', error);
      }
    }
  };

  useEffect(() => {
    if (!profileUpdateFeedback) return;
    const timeoutId = window.setTimeout(() => setProfileUpdateFeedback(null), 6000);
    return () => window.clearTimeout(timeoutId);
  }, [profileUpdateFeedback]);

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
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('name,age,gender,weight,height,goal,location,fitness_level,training_days_per_week,equipment,injuries,activity_level,dietary_preferences,chronic_conditions,allergies')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(1);

      const profileData = profileRows?.[0];

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
      const localPlans = readLocalPlans(user.id);
      const localCompletions = readLocalCompletions(user.id);

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

      const remotePlans = (plansData || []) as Array<StoredSchedulePlan & { title_ar?: string; is_active?: boolean }>;
      const remoteCompletions = (completionsData || []) as CompletionRow[];
      const plans = [
        ...remotePlans,
        ...localPlans.filter((localPlan) => !remotePlans.some((remotePlan) => remotePlan.id === localPlan.id)),
      ];
      const completions = [
        ...remoteCompletions,
        ...localCompletions.filter((localCompletion) => !remoteCompletions.some((remoteCompletion) => remoteCompletion.id === localCompletion.id)),
      ];
      const dailyLogs = (logsData || []) as DailyLogRow[];
      const plansById = new Map(plans.map((plan) => [plan.id, plan]));
      const completionTimeline = completions
        .map((row) => {
          const sourceDate = row.completed_at || row.log_date || null;
          const timestamp = sourceDate ? new Date(sourceDate).getTime() : Number.NaN;
          return { row, sourceDate, timestamp };
        })
        .filter((entry) => entry.sourceDate && !Number.isNaN(entry.timestamp))
        .sort((a, b) => b.timestamp - a.timestamp);

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
      let completedWorkoutTasks = 0;
      let completedNutritionTasks = 0;
      for (const row of completions) {
        const plan = plansById.get(row.plan_id);
        if (plan && (plan.title || '').startsWith(NUTRITION_PREFIX)) {
          completedNutritionTasks += 1;
        } else {
          completedWorkoutTasks += 1;
        }
      }
      const adherence = totalTasks > 0 ? Math.min(1, completedTasks / totalTasks) : 0;
      const workoutPlans = plans.filter((plan) => !(plan.title || '').startsWith(NUTRITION_PREFIX));
      const nutritionPlans = plans.filter((plan) => (plan.title || '').startsWith(NUTRITION_PREFIX));
      const activeWorkoutPlans = workoutPlans.filter((plan) => plan.is_active).length || workoutPlans.length;
      const activeNutritionPlans = nutritionPlans.filter((plan) => plan.is_active).length || nutritionPlans.length;

      const lastCompletionAt = completionTimeline[0]?.sourceDate || null;
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const completionsLast7Days = completions.filter((row) => {
        const sourceDate = row.completed_at || row.log_date;
        if (!sourceDate) return false;
        return new Date(sourceDate).getTime() >= sevenDaysAgo;
      });
      const completionsPrevious7Days = completions.filter((row) => {
        const sourceDate = row.completed_at || row.log_date;
        if (!sourceDate) return false;
        const timestamp = new Date(sourceDate).getTime();
        return timestamp >= fourteenDaysAgo && timestamp < sevenDaysAgo;
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

      const plannedWorkoutTasksLast7Days = (() => {
        const activeWorkoutPlanRows = workoutPlans.filter((plan) => plan.is_active);
        const plansToInspect = activeWorkoutPlanRows.length ? activeWorkoutPlanRows : workoutPlans;
        const dates = Array.from({ length: 7 }, (_, index) => {
          const date = new Date();
          date.setHours(0, 0, 0, 0);
          date.setDate(date.getDate() - index);
          return date;
        });

        let total = 0;
        for (const date of dates) {
          const jsDay = date.getDay();
          for (const plan of plansToInspect) {
            if (!planAppliesToDate(plan.created_at, date)) continue;
            const days = Array.isArray(plan.plan_data) ? plan.plan_data : [];
            for (const day of days) {
              const planDayIndex = getPlanDayIndex(day?.day) !== -1 ? getPlanDayIndex(day?.day) : getPlanDayIndex(day?.dayAr);
              if (planDayIndex !== jsDay) continue;
              total += Array.isArray(day?.exercises) ? day.exercises.length : 0;
            }
          }
        }
        return total;
      })();

      const workoutStreakDays = countDateStreak(completionDaySet);
      const loggingDaySet = new Set(
        dailyLogs
          .map((row) => toIsoDay(row.log_date || null))
          .filter(Boolean) as string[]
      );
      const loggingStreakDays = countDateStreak(loggingDaySet);
      const loggingConsistencyPercent = Math.min(100, Math.round((logsLast7Days.length / 7) * 100));
      const priorCompletedTasks = completionsPrevious7Days.length;
      const completionDelta = completedLast7Days - priorCompletedTasks;
      const workoutAdherencePercent = plannedWorkoutTasksLast7Days > 0
        ? Math.min(100, Math.round((completedLast7Days / plannedWorkoutTasksLast7Days) * 100))
        : completedLast7Days > 0
          ? 100
          : 0;
      const trend = completionDelta > 0 ? 'up' : completionDelta < 0 ? 'down' : 'flat';

      const recentExerciseCompletions = completionTimeline.slice(0, 12).map(({ row, sourceDate }) => {
        const plan = plansById.get(row.plan_id);
        const days = Array.isArray(plan?.plan_data) ? plan?.plan_data : [];
        const day = typeof row.day_index === 'number' ? days[row.day_index] : null;
        const exercise = Array.isArray(day?.exercises) && typeof row.exercise_index === 'number'
          ? day.exercises[row.exercise_index]
          : null;
        return {
          date: toIsoDay(sourceDate),
          plan_title: plan?.title || '',
          day: day?.day || day?.dayAr || '',
          exercise_name: exercise?.name || exercise?.nameAr || 'Exercise completed',
        };
      });

      const recentActivityMap = new Map<string, {
        date: string | null;
        completed_exercises: number;
        workout_notes: string;
        nutrition_notes: string;
        mood: string;
      }>();

      for (const row of logsLast7Days) {
        const day = toIsoDay(row.log_date || null);
        if (!day) continue;
        recentActivityMap.set(day, {
          date: day,
          completed_exercises: recentActivityMap.get(day)?.completed_exercises || 0,
          workout_notes: cleanNote(row.workout_notes),
          nutrition_notes: cleanNote(row.nutrition_notes),
          mood: cleanNote(row.mood),
        });
      }

      for (const row of completionsLast7Days) {
        const day = toIsoDay(row.log_date || row.completed_at || null);
        if (!day) continue;
        const existing = recentActivityMap.get(day) || {
          date: day,
          completed_exercises: 0,
          workout_notes: '',
          nutrition_notes: '',
          mood: '',
        };
        recentActivityMap.set(day, {
          ...existing,
          completed_exercises: existing.completed_exercises + 1,
        });
      }

      const recentActivity = Array.from(recentActivityMap.values())
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
        completed_workout_tasks: completedWorkoutTasks,
        completed_nutrition_tasks: completedNutritionTasks,
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
        progress_metrics: {
          recent_completed_tasks: completedLast7Days,
          prior_completed_tasks: priorCompletedTasks,
          completion_delta: completionDelta,
          workout_adherence_percent: workoutAdherencePercent,
          logging_consistency_percent: loggingConsistencyPercent,
          current_workout_streak_days: workoutStreakDays,
          current_logging_streak_days: loggingStreakDays,
          planned_workout_tasks_last_7_days: plannedWorkoutTasksLast7Days,
          trend,
        },
        weekly_stats: {
          workout_days: completionDaySet.size,
          planned_days: plannedWorkoutDays.size,
          planned_nutrition_days: plannedNutritionDays.size,
          workout_log_days: workoutLogDaysSet.size,
          nutrition_log_days: nutritionLogDaysSet.size,
          completed_workouts: completedLast7Days,
          recent_completed_tasks: completedLast7Days,
          previous_completed_tasks: priorCompletedTasks,
          completion_delta: completionDelta,
          workout_adherence_percent: workoutAdherencePercent,
          logging_consistency_percent: loggingConsistencyPercent,
          current_workout_streak_days: workoutStreakDays,
          current_logging_streak_days: loggingStreakDays,
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
      const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion || document.visibilityState === 'hidden') {
        const completeMessage: ChatMessage = { role: 'assistant', content: fullText, timestamp };
        setCurrentMessages([...baseMessages, completeMessage]);
        return [...baseMessages, completeMessage];
      }

      // Keep the pleasant streamed-text feel without rebuilding the entire
      // Markdown conversation dozens or hundreds of times for a long answer.
      const frameCount = Math.min(18, Math.max(4, Math.ceil(fullText.length / 140)));
      const charsPerTick = Math.max(1, Math.ceil(fullText.length / frameCount));
      const tickMs = 28;
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

  const sendMessageWithText = async (text: string, attachmentsOverride?: PendingAttachment[]) => {
    const attachments = attachmentsOverride ?? selectedAttachments;
    if ((!text.trim() && attachments.length === 0) || isBusy || !user) return;
    if (isSubscriptionGateLoading) return;
    if (isPlanLimitReached && isPlanGenerationRequest(text)) {
      showLimit('plan');
      return;
    }
    if (isChatLimitReached) {
      showLimit('chat');
      return;
    }
    if (attachments.length > 0 && (isUploadLimitReached || (!isUnlimited && attachments.length > uploadsLeft))) {
      setAttachmentError('Upload limit reached. Upgrade your plan to upload more files.');
      showLimit('upload');
      return;
    }

    const activeConversationId = await ensureActiveConversation();
    if (!activeConversationId) return;

    const messageAttachments = toMessageAttachments(attachments);
    const userMessage: ChatMessage = {
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
      attachments: messageAttachments,
    };
    const storedUserContent = serializeStoredMessageContent(userMessage.content, messageAttachments);
    const newMessages = [...currentMessages, userMessage];
    setCurrentMessages(newMessages);
    setInput('');
    setIsLoading(true);

    setConversations(prev => {
      const updated = prev.map(c =>
        c.id === activeConversationId ? { ...c, messages: newMessages, updated_at: new Date().toISOString() } : c
      );
      const hasConversation = updated.some(c => c.id === activeConversationId);
      if (hasConversation) return updated;
      return [{ id: activeConversationId, title: '', messages: newMessages, updated_at: new Date().toISOString() }, ...updated];
    });

    if (isPlanRejectText(text) && (pendingPlan || pendingPlanOptions)) {
      clearPendingAttachments();
      if (pendingPlan) {
        try {
          await handleRejectPlan(pendingPlan.id);
        } finally {
          setIsLoading(false);
        }
        return;
      }

      setPendingPlanOptions(null);
      setPendingPlan(null);
      const rejectText = language === 'ar'
        ? 'تمام، لغيت خيارات الخطة.'
        : 'No problem. I canceled these plan options.';
      try {
        await appendAssistantMessage(rejectText);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    let timeoutId: number | null = null;
    try {
      const useCompactPublicPayload = isPublicAppOrigin();
      const user_profile = await buildCombinedUserProfile();
      const tracking_summary = useCompactPublicPayload ? null : await buildTrackingSummary();
      const plan_snapshot = useCompactPublicPayload ? null : await buildPlanSnapshot();
      const recent_messages = newMessages.slice(useCompactPublicPayload ? -4 : -12).map((msg) => ({
        role: msg.role,
        content: buildOutgoingUserMessage(msg, language),
      }));

      const website_context = useCompactPublicPayload
        ? {
            app_name: 'FitCoach',
            current_page: 'coach',
            current_path: location.pathname,
            current_language: language === 'ar' ? 'ar' : 'en',
          }
        : await buildWebsiteContext();

      const payload = {
        message: text.trim(),
        request_id: `message-${userMessage.timestamp}`,
        user_id: user.id,
        conversation_id: activeConversationId,
        language: language === 'ar' ? 'ar' : 'en',
        user_profile,
        tracking_summary,
        plan_snapshot,
        website_context,
        recent_messages,
      };

      const fallbackPayload = {
        message: text.trim(),
        request_id: `message-${userMessage.timestamp}`,
        user_id: user.id,
        conversation_id: activeConversationId,
        language: language === 'ar' ? 'ar' : 'en',
        user_profile: user_profile
          ? {
              goal: user_profile.goal,
              gender: user_profile.gender,
              age: user_profile.age,
              weight: user_profile.weight,
              height: user_profile.height,
              fitnessLevel: user_profile.fitnessLevel,
            }
          : null,
        recent_messages: recent_messages.slice(-2),
      };

      const controller = new AbortController();
      const requestTimeoutMs = attachments.length > 0 ? ATTACHMENT_REQUEST_TIMEOUT_MS : CHAT_REQUEST_TIMEOUT_MS;
      timeoutId = window.setTimeout(() => controller.abort(), requestTimeoutMs);
      let apiResponse = attachments.length > 0
        ? await (async () => {
            const formData = new FormData();
            formData.append('message', text.trim());
            formData.append('request_id', `message-${userMessage.timestamp}`);
            formData.append('user_id', user.id);
            formData.append('conversation_id', activeConversationId);
            formData.append('language', language === 'ar' ? 'ar' : 'en');
            formData.append('user_profile', JSON.stringify(user_profile));
            formData.append('tracking_summary', JSON.stringify(tracking_summary));
            formData.append('plan_snapshot', JSON.stringify(plan_snapshot));
            formData.append('website_context', JSON.stringify(website_context));
            formData.append('recent_messages', JSON.stringify(recent_messages));
            attachments.forEach((item) => {
              formData.append('attachments', item.file, item.file.name);
            });
            return fetch(`${AI_BACKEND_URL}/chat-with-attachments`, {
              method: 'POST',
              headers: await authHeaders(),
              body: formData,
              signal: controller.signal,
            });
          })()
        : useCompactPublicPayload
          ? await fetch(`${AI_BACKEND_URL}/chat`, {
              method: 'POST',
              headers: await authHeaders({
                'Content-Type': 'application/json; charset=UTF-8',
              }),
              body: JSON.stringify(fallbackPayload),
              signal: controller.signal,
            })
        : await fetch(`${AI_BACKEND_URL}/chat`, {
            method: 'POST',
            headers: await authHeaders({
              'Content-Type': 'application/json; charset=UTF-8',
            }),
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

      if (!attachments.length && apiResponse.status >= 500 && useCompactPublicPayload) {
        apiResponse = await fetch(`${AI_BACKEND_URL}/chat`, {
          method: 'POST',
          headers: await authHeaders({
            'Content-Type': 'application/json; charset=UTF-8',
          }),
          body: JSON.stringify(fallbackPayload),
          signal: controller.signal,
        });
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (!apiResponse.ok) {
        const failure = await apiResponse.json().catch(() => ({}));
        const code = failure.code || failure.detail?.code;
        const message = failure.message || failure.detail?.message || (typeof failure.detail === 'string' ? failure.detail : `Backend error: ${apiResponse.status}`);
        if (code === 'CHAT_LIMIT_REACHED' || code === 'UPLOAD_LIMIT_REACHED' || code === 'PLAN_LIMIT_REACHED') {
          setCurrentMessages(currentMessages);
          setConversations(prev => prev.map(c => c.id === activeConversationId ? { ...c, messages: currentMessages } : c));
          setInput(text);
          showLimit(code === 'UPLOAD_LIMIT_REACHED' ? 'upload' : code === 'PLAN_LIMIT_REACHED' ? 'plan' : 'chat');
          await refreshSubscription();
          throw Object.assign(new Error(message), { limitReached: true });
        }
        throw new Error(message);
      }

      const data = await apiResponse.json();
      if (supabase && supabase.from) {
        try {
          await supabase.from('chat_messages').insert({
            conversation_id: activeConversationId,
            user_id: user.id,
            role: 'user',
            content: storedUserContent,
          });
          const conv = conversations.find(c => c.id === activeConversationId);
          if (conv && !conv.title) {
            const titleSeed = text.trim() || attachments.map((item) => item.file.name).join(', ');
            const title = titleSeed.slice(0, 50) + (titleSeed.length > 50 ? '...' : '');
            await supabase.from('chat_conversations').update({ title }).eq('id', activeConversationId);
            setConversations(prev => prev.map(c => c.id === activeConversationId ? { ...c, title } : c));
          }
        } catch (error) {
          console.warn('Failed to save accepted message to Supabase:', error);
        }
      }
      if (attachments.length > 0) {
        clearPendingAttachments();
        setAttachmentError('');
      }
      await refreshSubscription();

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
        setPendingPlanOptions(null);
        setPendingPlan(pendingFromApi);
      }

      const pendingProfileConfirmationFromApi = extractPendingProfileConfirmation(data);
      if (pendingProfileConfirmationFromApi) {
        setPendingProfileConfirmation(pendingProfileConfirmationFromApi);
      } else if (data?.action === 'profile_update_cancelled' || data?.action === 'profile_updated') {
        setPendingProfileConfirmation(null);
      }

      await persistProfileUpdate(data);

      const planOptionsFromApi = extractPlanOptionsFromResponse(data);
      if (planOptionsFromApi) {
        setPendingPlan(null);
        setPendingPlanOptions(planOptionsFromApi);
      }

      const approvedFromApi = extractApprovedPlanFromResponse(data);
      if (approvedFromApi) {
        try {
          await persistApprovedPlan(data);
        } catch (e) {
          console.error('Failed saving approved plan to Supabase', e);
        } finally {
          setPendingPlan(null);
          setPendingPlanOptions(null);
          goToSchedule();
        }
      }

      if (autoSpeak) speakWithVoice(assistantText);
      if (showRagDebug) {
        void loadRagDebug(text.trim() || attachments.map((item) => item.file.name).join(' '));
      }
      if (!voiceModeRef.current) focusInput();
    } catch (error: any) {
      console.error('Error:', error);
      setIsTypingReply(false);
      if (error?.limitReached) return;
      const timeoutMessage = error?.name === 'AbortError'
        ? (attachments.length > 0
          ? (language === 'ar'
            ? 'تحليل المرفق استغرق وقتاً أطول من المتوقع. حسّنت المسار ليعتمد على OCR أسرع للصور النصية، لكن إذا استمر التأخير فغالباً نموذج الرؤية المحلي ما زال بطيئاً.'
            : 'Attachment analysis is taking longer than expected. The flow now prefers faster OCR for text-heavy images, but if this keeps happening the local vision model is still the bottleneck.')
          : (language === 'ar'
            ? 'الرد تأخر. تأكد أن السيرفر شغال على المنفذ الصحيح ثم جرّب مرة ثانية.'
            : 'The response is taking too long. Make sure the backend is running on the correct port and try again.'))
        : null;
      const urgentFallback = getUrgentHeartRateFallback(text.trim(), language === 'ar' ? 'ar' : 'en');
      const errMsg: ChatMessage = {
        role: 'assistant',
        content:
          urgentFallback ||
          timeoutMessage ||
          (language === 'ar'
            ? `تعذر الاتصال بخادم الذكاء الاصطناعي (${AI_BACKEND_URL}). تأكد أنه يعمل ثم أعد المحاولة.`
            : `Could not reach the AI backend (${AI_BACKEND_URL}). Make sure it's running and try again.`),
        timestamp: Date.now(),
      };
      setCurrentMessages(prev => [...prev, errMsg]);
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      setIsTypingReply(false);
      setIsLoading(false);
      if (!voiceModeRef.current) focusInput();
    }
  };

  const sendMessage = () => sendMessageWithText(input);

  const choosePlanOption = (optionIndex: number) => {
    setPendingPlanOptions(null);
    void sendMessageWithText(String(optionIndex));
  };

  const loadMorePlanOptions = () => {
    void sendMessageWithText(language === 'ar' ? 'خيارات أكثر' : 'more options');
  };

  const confirmPendingProfileUpdate = () => {
    void sendMessageWithText(language === 'ar' ? 'موافق' : 'confirm');
  };

  const cancelPendingProfileUpdate = () => {
    void sendMessageWithText(language === 'ar' ? 'إلغاء' : 'cancel');
  };

  useEffect(() => {
    const prompt = coachNavigationState?.coachPrompt?.trim();
    const promptId = coachNavigationState?.coachPromptId || null;
    if (!coachNavigationState?.autoSendCoachPrompt || !prompt || !promptId) return;
    if (!user || loadingConvs || isBusy) return;
    if (processedCoachPromptRef.current === promptId) return;

    processedCoachPromptRef.current = promptId;
    setInput(prompt);

    void (async () => {
      try {
        await sendMessageWithText(prompt);
      } finally {
        navigate(location.pathname, { replace: true, state: null });
      }
    })();
  }, [coachNavigationState, isBusy, loadingConvs, location.pathname, navigate, user]);

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
    if (approvingPlanIdsRef.current.has(planId)) return;
    approvingPlanIdsRef.current.add(planId);
    try {
    const response = await fetch(`${AI_BACKEND_URL}/plans/${planId}/approve`, {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        user_id: user.id,
        conversation_id: currentId || user.id,
      }),
    });

    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      const code = failure.code || failure.detail?.code;
      const message = failure.message || failure.detail?.message || failure.detail || `Approve failed: ${response.status}`;
      if (code === 'PLAN_LIMIT_REACHED') {
        showLimit('plan');
        await refreshSubscription();
        return;
      }
      throw new Error(message);
    }

    const data = await response.json();
    try {
      await persistApprovedPlan(data);
    } catch (error) {
      console.error('Failed saving approved plan to Supabase', error);
    }
    await refreshSubscription();
    setPendingPlan(null);
    setPendingPlanOptions(null);

    const successText = language === 'ar'
      ? '✅ تم اعتماد الخطة وحفظها في صفحة الجدول.'
      : '✅ Plan approved and saved to your Schedule page.';
    try {
      await appendAssistantMessage(successText);
    } finally {
      goToSchedule();
    }
    } finally {
      approvingPlanIdsRef.current.delete(planId);
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
    setPendingPlanOptions(null);
    const rejectText = language === 'ar'
      ? '🔁 تم رفض الخطة. اكتب لي التعديلات التي تريدها وسأعيد بناء خطة جديدة.'
      : '🔁 Plan rejected. Tell me what to change and I will regenerate it.';
    await appendAssistantMessage(rejectText);
  };

  const workoutApprovalPlan = pendingPlan?.type === 'workout' ? {
    id: pendingPlan.id,
    name: pendingPlan.plan?.title || 'AI Workout Plan',
    duration_days: pendingPlan.plan?.duration_days || 7,
    exercises: (((pendingPlan.plan?.days || [])
      .flatMap((day: any) => day?.exercises || []))
      .concat(Array.isArray(pendingPlan.plan?.exercises) ? pendingPlan.plan.exercises : []))
      .map((exercise: any) => exercise?.name)
      .filter(Boolean),
    status: 'pending' as const,
    created_at: pendingPlan.plan?.created_at || new Date().toISOString(),
  } : null;

  const nutritionApprovalPlan = pendingPlan?.type === 'nutrition' ? {
    id: pendingPlan.id,
    daily_calories: Number(pendingPlan.plan?.daily_calories || 0),
    meals: ((((pendingPlan.plan?.days || [])[0]?.meals || []).concat(Array.isArray(pendingPlan.plan?.meals) ? pendingPlan.plan.meals : []))).map((meal: any) => ({
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
    if (isChatLimitReached) {
      showLimit('chat');
      return;
    }
    sendMessage();
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(language === 'ar' ? 'ar' : 'en', { month: 'short', day: 'numeric' });
  };

  const formatMessageTime = (timestamp: number) => {
    try {
      return new Date(timestamp).toLocaleTimeString(language === 'ar' ? 'ar' : 'en', {
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const isArabic = language === 'ar';
  const quickPrompts = isArabic
    ? [
        'ابنِ لي خطة تمارين',
        'أنشئ لي خطة غذائية للتنشيف',
        'عدّل جدولي هذا الأسبوع',
        'ماذا أتمرن اليوم؟',
        'حلّل تقدمي',
        'أعطني تمارين آمنة للكتف',
      ]
    : [
        'Build me a workout plan',
        'Create a fat-loss meal plan',
        'Adjust my schedule',
        'What should I train today?',
        'Analyze my progress',
        'Give me shoulder-safe exercises',
      ];
  const profileContextEntries = [
    {
      label: isArabic ? 'الهدف' : 'Goal',
      value: profile?.goal || (isArabic ? 'غير محدد' : 'Not set'),
    },
    {
      label: isArabic ? 'مكان التدريب' : 'Training place',
      value: profile?.location || profile?.equipment || (isArabic ? 'مرن' : 'Flexible'),
    },
    {
      label: isArabic ? 'أيام التدريب' : 'Training days',
      value: profile?.trainingDaysPerWeek ? `${profile.trainingDaysPerWeek}/week` : (isArabic ? 'حسب الخطة' : 'Plan-based'),
    },
    {
      label: isArabic ? 'تنبيهات الإصابات' : 'Injury note',
      value: profile?.injuries || (isArabic ? 'لا يوجد' : 'None listed'),
    },
  ];

  const handleVoiceSelect = (voiceName: string) => {
    setSelectedVoice(voiceName);
    localStorage.setItem(getVoiceStorageKey(language), voiceName);
    localStorage.setItem('fitcoach_voice', voiceName);
  };

  const copyMessage = useCallback(async (messageKey: string, content: string) => {
    const text = content.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageKey(messageKey);
      window.setTimeout(() => {
        setCopiedMessageKey((current) => (current === messageKey ? null : current));
      }, 1800);
    } catch (error) {
      console.error('Failed to copy message:', error);
    }
  }, []);

  const renderAttachmentBadge = (attachment: MessageAttachment) => (
    <div
      key={attachment.id}
      className="flex w-full max-w-sm items-center gap-3 rounded-2xl border border-border/60 bg-card/80 px-3 py-2 text-left shadow-sm"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary/70">
        {attachment.kind === 'image' ? <FileImage className="w-5 h-5 text-primary" /> : <FileText className="w-5 h-5 text-primary" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{attachment.filename}</p>
        <p className="text-xs text-muted-foreground">{formatAttachmentSize(attachment.sizeBytes)}</p>
      </div>
    </div>
  );

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
    <div className="relative flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#060816] text-foreground">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(129,92,255,0.18),_transparent_32%),radial-gradient(circle_at_85%_18%,_rgba(34,211,238,0.12),_transparent_24%),radial-gradient(circle_at_50%_100%,_rgba(236,72,153,0.1),_transparent_34%)]" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:54px_54px]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/40 via-transparent to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_transparent_45%,_rgba(1,3,10,0.75)_100%)]" />
      </div>
      <Navbar />
      <UpgradeModal open={Boolean(upgradeReason)} onOpenChange={(open) => !open && setUpgradeReason('')} reason={upgradeReason} />

      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden pt-16 pb-16 md:pb-0">
        <aside className="hidden md:flex w-80 shrink-0 flex-col border-r border-white/10 bg-[rgba(10,12,24,0.72)] backdrop-blur-2xl">
          <div className="border-b border-white/10 p-5">
            <div className="mb-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-cyan-200/70">
                {isArabic ? 'جلسات المدرب' : 'Coach Sessions'}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {isArabic ? 'سجل المحادثات والخطط والردود الذكية.' : 'Your premium conversation vault for plans, insights, and follow-ups.'}
              </p>
            </div>
            <Button variant="hero" className="h-12 w-full rounded-2xl shadow-[0_18px_40px_rgba(168,85,247,0.28)]" onClick={createConversation}>
              <Plus className="w-4 h-4" />
              {t('coach.newChat')}
            </Button>
            <div className="mt-3"><UsageWidget value={subscription} /></div>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4">
            {loadingConvs && (
              <div className="rounded-3xl border border-white/8 bg-white/[0.04] px-4 py-5 text-sm text-muted-foreground">
                {isArabic ? 'جاري تحميل الجلسات...' : 'Loading sessions...'}
              </div>
            )}
            {conversations.map(conv => (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => selectConversation(conv.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { selectConversation(conv.id); } }}
                className={`mb-2 flex w-full items-center gap-3 rounded-3xl border px-4 py-3 text-left transition-all duration-300 group ${
                  conv.id === currentId
                    ? 'border-fuchsia-400/40 bg-gradient-to-r from-fuchsia-500/18 via-violet-500/16 to-cyan-400/16 text-white shadow-[0_16px_40px_rgba(168,85,247,0.18)]'
                    : 'border-white/8 bg-white/[0.03] text-muted-foreground hover:-translate-y-0.5 hover:border-fuchsia-300/20 hover:bg-white/[0.06] hover:text-foreground'
                }`}
              >
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${
                  conv.id === currentId ? 'border-white/20 bg-white/10 text-fuchsia-200' : 'border-white/8 bg-black/20 text-muted-foreground'
                }`}>
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{conv.title || t('coach.newChat')}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.24em] opacity-60">{formatDate(conv.updated_at)}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                  className="rounded-full border border-transparent p-2 opacity-0 transition-all hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
                onClick={() => setSidebarOpen(false)}
              />
              <motion.aside
                initial={{ x: language === 'ar' ? 300 : -300 }}
                animate={{ x: 0 }}
                exit={{ x: language === 'ar' ? 300 : -300 }}
                className="fixed top-16 bottom-0 z-50 flex w-80 max-w-[88vw] flex-col border-r border-white/10 bg-[rgba(10,12,24,0.94)] backdrop-blur-2xl md:hidden"
                style={{ [language === 'ar' ? 'right' : 'left']: 0 }}
              >
                <div className="border-b border-white/10 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-cyan-200/70">
                        {isArabic ? 'جلسات المدرب' : 'Coach Sessions'}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {isArabic ? 'كل محادثاتك الذكية في مكان واحد.' : 'Every coaching conversation in one place.'}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="rounded-2xl border border-white/10 bg-white/[0.04]">
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <Button variant="hero" size="sm" onClick={createConversation} className="h-11 w-full rounded-2xl">
                    <Plus className="w-4 h-4" />
                    {t('coach.newChat')}
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-4">
                  {conversations.map(conv => (
                    <button
                      key={conv.id}
                      onClick={() => selectConversation(conv.id)}
                      className={`mb-2 flex w-full items-center gap-3 rounded-3xl border px-4 py-3 text-left transition-all ${
                        conv.id === currentId
                          ? 'border-fuchsia-400/40 bg-gradient-to-r from-fuchsia-500/18 via-violet-500/16 to-cyan-400/16 text-white'
                          : 'border-white/8 bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground'
                      }`}
                    >
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${
                        conv.id === currentId ? 'border-white/20 bg-white/10 text-fuchsia-200' : 'border-white/8 bg-black/20 text-muted-foreground'
                      }`}>
                        <MessageSquare className="w-4 h-4 shrink-0" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{conv.title || t('coach.newChat')}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.24em] opacity-60">{formatDate(conv.updated_at)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <main className="mx-auto flex min-h-0 w-full max-w-[1680px] flex-1 overflow-hidden px-3 py-3 sm:px-4 lg:px-6">
          <div className="grid min-h-0 w-full gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <section className="flex min-h-0 flex-col overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,18,34,0.92),rgba(8,10,22,0.94))] shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="relative z-20 shrink-0 border-b border-white/10 bg-[linear-gradient(180deg,rgba(14,16,30,0.96),rgba(14,16,30,0.78))] px-4 py-4 backdrop-blur-xl sm:px-5 lg:px-6">
                <div className="absolute inset-x-8 bottom-0 h-px bg-gradient-to-r from-transparent via-fuchsia-400/50 to-transparent" />
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <Button variant="ghost" size="icon" className="rounded-2xl border border-white/10 bg-white/[0.04] md:hidden" onClick={() => setSidebarOpen(true)}>
                      <Menu className="w-5 h-5" />
                    </Button>
                    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-fuchsia-400/25 bg-gradient-to-br from-fuchsia-500/30 via-violet-500/20 to-cyan-400/20 shadow-[0_0_40px_rgba(168,85,247,0.22)]">
                      <div className="absolute inset-1 rounded-[14px] border border-white/10" />
                      <Bot className="relative z-10 w-5 h-5 text-primary-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-lg font-semibold text-foreground sm:text-xl">{isArabic ? 'المدرب الذكي للياقة' : 'AI Fitness Coach'}</h1>
                        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-200">
                          {isArabic ? 'جاهز' : 'Ready'}
                        </span>
                      </div>
                      <p className="mt-1 max-w-3xl text-xs leading-6 text-muted-foreground sm:text-sm">
                        {isArabic
                          ? 'إرشاد ذكي مخصص للتمارين والتغذية والتعافي والجدولة، داخل مركز قيادة واحد أنيق.'
                          : 'Personalized fitness, nutrition, recovery, and schedule intelligence in one luxury command center.'}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setShowVoiceSettings(!showVoiceSettings)} className="rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08]">
                      <Settings2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant={showRagDebug ? 'default' : 'ghost'} size="sm" onClick={() => setShowRagDebug((prev) => !prev)} className={`rounded-full border ${showRagDebug ? 'border-fuchsia-300/40 bg-gradient-to-r from-fuchsia-500/80 to-cyan-400/70 text-white' : 'border-white/10 bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground'}`}>
                      {showRagDebug ? (isArabic ? 'عرض RAG' : 'RAG View') : (isArabic ? 'أدوات RAG' : 'RAG Tools')}
                    </Button>
                    {isSupported && (
                      <Button
                        variant={voiceMode ? 'default' : 'ghost'}
                        size="sm"
                        className={`gap-2 rounded-full border ${voiceMode ? 'border-fuchsia-300/40 bg-gradient-to-r from-fuchsia-500/80 to-violet-500/80 text-white' : 'border-white/10 bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground'}`}
                        onClick={toggleVoiceMode}
                        title={language === 'ar' ? 'رسالة صوتية واحدة' : 'Single voice turn'}
                        aria-label={language === 'ar' ? 'رسالة صوتية واحدة' : 'Single voice turn'}
                      >
                        {voiceMode ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                        <span className="hidden md:inline">
                          {voiceMode
                            ? (language === 'ar' ? 'إيقاف التسجيل' : 'Stop voice')
                            : (language === 'ar' ? 'رسالة صوتية' : 'Voice turn')}
                        </span>
                      </Button>
                    )}
                    <Button
                      variant={autoSpeak ? 'default' : 'ghost'}
                      size="icon"
                      className={`rounded-full border ${autoSpeak ? 'border-cyan-300/40 bg-cyan-400/15 text-cyan-100' : 'border-white/10 bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground'}`}
                      onClick={() => { setAutoSpeak(!autoSpeak); if (isAssistantSpeaking) stopAllSpeech(); }}
                    >
                      {autoSpeak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                    </Button>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-muted-foreground">
                      {isArabic ? 'الملف الشخصي مفعل' : 'Using your profile data'}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-muted-foreground">
                      {isSupported ? (isArabic ? 'الصوت جاهز' : 'Voice ready') : (isArabic ? 'الصوت غير متاح' : 'Voice unavailable')}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {[
                      isArabic ? 'يعتمد على ملفك الشخصي' : 'Profile-aware coaching',
                      isArabic ? 'يبني الخطط ويحفظها' : 'Builds plans + saves to schedule',
                      isArabic ? 'صوت + ملفات + RAG' : 'Voice + uploads + RAG',
                    ].map((chip) => (
                      <span
                        key={chip}
                        className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] font-medium text-foreground/90"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {showVoiceSettings && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-b border-white/10 bg-white/[0.03]">
                    <div className="flex items-center gap-3 p-3 sm:px-5 lg:px-6">
                      <span className="whitespace-nowrap text-sm text-muted-foreground">
                        {language === 'ar' ? 'صوت المدرب:' : 'Coach voice:'}
                      </span>
                      <Select value={selectedVoice || 'default'} onValueChange={handleVoiceSelect}>
                        <SelectTrigger className="h-10 flex-1 rounded-2xl border-white/10 bg-black/20">
                          <SelectValue placeholder={language === 'ar' ? 'افتراضي' : 'Default'} />
                        </SelectTrigger>
                        <SelectContent className="max-h-60">
                          <SelectItem value="default">{language === 'ar' ? 'افتراضي' : 'Default'}</SelectItem>
                          <SelectItem value={ARABIC_VOICE_AGENT_ID}>
                            {language === 'ar' ? 'المساعد الصوتي العربي' : 'Arabic Voice Agent'}
                          </SelectItem>
                          {filteredVoices.length > 0 && (
                            <>
                              <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
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
                              <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
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
                      <Button size="sm" variant="ghost" className="rounded-2xl border border-white/10 bg-white/[0.04]" onClick={() => speakWithVoice(voicePreviewText)}>
                        <Volume2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={messagesScrollRef} className="min-h-0 flex-1 overscroll-contain overflow-y-auto scroll-smooth scrollbar-thin [scrollbar-gutter:stable] px-4 py-5 sm:px-5 lg:px-6">
                {currentMessages.length === 0 && !isLoading && !isVoiceProcessing && (
                  <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="mb-6 overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.32)]">
                    <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
                      <div className="relative mb-5 flex h-20 w-20 items-center justify-center rounded-full border border-fuchsia-400/25 bg-gradient-to-br from-fuchsia-500/25 via-violet-500/18 to-cyan-400/18 shadow-[0_0_70px_rgba(168,85,247,0.22)]">
                        <div className="absolute inset-2 rounded-full border border-white/10" />
                        <Bot className="relative z-10 h-8 w-8 text-white" />
                      </div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-cyan-200/70">
                        {isArabic ? 'مركز قيادة المدرب الذكي' : 'AI COACH COMMAND CENTER'}
                      </div>
                      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                        {isArabic ? 'كيف أساعدك اليوم؟' : 'How can I coach you today?'}
                      </h2>
                      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                        {isArabic
                          ? 'اطلب خطة تمرين، إرشادًا غذائيًا، نصائح للتعافي، أو تحسينًا لجدولك — وسأبني لك ردًا مخصصًا حسب ملفك الشخصي.'
                          : 'Ask for a workout plan, nutrition guidance, recovery advice, or schedule optimization — and I’ll personalize it around your profile.'}
                      </p>
                      <p className="mt-3 text-xs text-cyan-100/80">
                        {isArabic ? 'المدرب يستطيع استخدام هدفك وبياناتك ونشاطك لتخصيص الإجابة.' : 'Your coach can use your profile, goal, and activity data to personalize answers.'}
                      </p>
                      <div className="mt-5 flex flex-wrap justify-center gap-2">
                        {quickPrompts.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => { setInput(prompt); focusInput(); }}
                            className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-foreground transition-all hover:-translate-y-0.5 hover:border-fuchsia-300/30 hover:bg-white/[0.08]"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}

                <div className="space-y-5">
                  {currentMessages.map((message, index) => (
                    (() => {
                      const messageKey = `${currentId}-${index}-${message.timestamp}`;
                      const isCopied = copiedMessageKey === messageKey;
                      const displayMessageText = getDisplayMessageContent(message.content, language);
                      const visibleMessageText = displayMessageText.trim();
                      const messageDir = getTextDirection(displayMessageText);
                      const fitbitSummaryCard = message.role === 'assistant' ? parseFitbitSummaryCard(displayMessageText) : null;
                      const copyText = buildMessageCopyText(message, language);
                      const hasAttachments = Array.isArray(message.attachments) && message.attachments.length > 0;
                      return (
                        <motion.div
                          key={`${currentId}-${index}`}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`group flex gap-4 [content-visibility:auto] [contain-intrinsic-size:auto_180px] ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                        >
                          <div className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${
                            message.role === 'user'
                              ? 'border-fuchsia-300/20 bg-gradient-to-br from-fuchsia-500/85 to-violet-500/85 text-white'
                              : 'border-cyan-300/20 bg-gradient-to-br from-violet-500/75 via-fuchsia-500/60 to-cyan-400/70 text-white shadow-[0_0_40px_rgba(34,211,238,0.12)]'
                          }`}>
                            {message.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                          </div>
                          <div className="max-w-[92%] md:max-w-[82%]">
                            {hasAttachments && (
                              <div className={`mb-2 flex flex-col gap-2 ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                                {message.attachments!.map((attachment) => renderAttachmentBadge(attachment))}
                              </div>
                            )}
                            {visibleMessageText && (
                              <>
                                <div className={`mb-2 flex items-center gap-2 px-1 text-[11px] uppercase tracking-[0.22em] ${
                                  message.role === 'user'
                                    ? 'justify-end text-fuchsia-100/75'
                                    : 'justify-start text-cyan-100/70'
                                }`}>
                                  <span>{message.role === 'user' ? (isArabic ? 'أنت' : 'You') : (isArabic ? 'المدرب الذكي' : 'AI Coach')}</span>
                                  <span className="text-white/25">•</span>
                                  <span className="tracking-[0.16em] text-white/45 normal-case">{formatMessageTime(message.timestamp)}</span>
                                </div>
                              <div
                                dir={messageDir}
                                className={`px-5 py-4.5 shadow-[0_20px_60px_rgba(0,0,0,0.18)] ${message.role === 'user' ? 'chat-bubble-user text-primary-foreground' : 'chat-bubble-ai text-foreground'}`}
                              >
                                {message.role === 'assistant' && fitbitSummaryCard ? (
                                  <FitbitSummaryCard data={fitbitSummaryCard} />
                                ) : message.role === 'assistant' ? (
                                  <div className={`chat-message-content prose prose-sm prose-invert max-w-none ${messageDir === 'rtl' ? 'chat-message-content-ar' : ''}`}>
                                    <ReactMarkdown components={markdownComponents}>{displayMessageText}</ReactMarkdown>
                                  </div>
                                ) : (
                                  <p className={`chat-message-content whitespace-pre-wrap ${messageDir === 'rtl' ? 'chat-message-content-ar' : ''}`}>{renderEmojiAwareChildren(displayMessageText, `user-${messageKey}`)}</p>
                                )}
                              </div>
                              </>
                            )}
                            <div className={`mt-2 flex items-center gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                              {copyText && (
                                <button
                                  type="button"
                                  onClick={() => void copyMessage(messageKey, copyText)}
                                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[11px] text-muted-foreground transition-all hover:border-fuchsia-300/25 hover:bg-white/[0.08] hover:text-foreground"
                                >
                                  {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                  <span>{isCopied ? (language === 'ar' ? 'تم النسخ' : 'Copied') : (language === 'ar' ? 'نسخ' : 'Copy')}</span>
                                </button>
                              )}
                              {message.role === 'assistant' && (
                                <button
                                  type="button"
                                  onClick={() => isAssistantSpeaking ? stopAllSpeech() : speakWithVoice(message.content)}
                                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[11px] text-muted-foreground transition-all hover:border-cyan-300/25 hover:bg-white/[0.08] hover:text-foreground"
                                >
                                  {isAssistantSpeaking ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                                  <span>{isAssistantSpeaking ? (language === 'ar' ? 'إيقاف' : 'Stop') : (language === 'ar' ? 'استماع' : 'Listen')}</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })()
                  ))}
                </div>

                {isLoading && !isTypingReply && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5 flex gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-violet-500/75 via-fuchsia-500/60 to-cyan-400/70">
                      <Bot className="w-4 h-4 text-primary-foreground" />
                    </div>
                    <div className="chat-bubble-ai p-4">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        <span className="text-sm text-muted-foreground">{language === 'ar' ? 'المدرب يحلل ملفك الآن...' : 'AI Coach is analyzing your profile...'}</span>
                      </div>
                    </div>
                  </motion.div>
                )}
                {isVoiceProcessing && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5 flex gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-violet-500/75 via-fuchsia-500/60 to-cyan-400/70">
                      <Bot className="w-4 h-4 text-primary-foreground" />
                    </div>
                    <div className="chat-bubble-ai p-4">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        <span className="text-sm text-muted-foreground">
                          {language === 'ar' ? 'جاري تجهيز الرد الصوتي...' : 'Processing your voice request...'}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )}
                <div aria-hidden="true" className="h-px" />
              </div>

              {showRagDebug && (
                <div className="mx-4 mb-4 rounded-[28px] border border-white/10 bg-white/[0.04] p-4 space-y-3 sm:mx-5 lg:mx-6">
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
                    <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
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
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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

              {profileUpdateFeedback && (
                <div className="mx-4 mb-4 rounded-[28px] border border-emerald-400/30 bg-emerald-400/10 p-4 space-y-2 sm:mx-5 lg:mx-6">
                  <div className="text-sm font-semibold text-foreground">
                    {language === 'ar' ? 'تم تحديث الملف الشخصي' : 'Profile updated'}
                  </div>
                  <div className="text-sm text-foreground">
                    {profileUpdateFeedback.fieldLabel}: {profileUpdateFeedback.displayValue}
                  </div>
                  <div className="text-xs text-muted-foreground">{profileUpdateFeedback.message}</div>
                </div>
              )}

              {pendingProfileConfirmation && (
                <div className="mx-4 mb-4 rounded-[28px] border border-amber-400/30 bg-amber-400/10 p-4 space-y-3 sm:mx-5 lg:mx-6">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {language === 'ar' ? 'تأكيد تعديل الملف الشخصي' : 'Confirm profile change'}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {pendingProfileConfirmation.fieldLabel}: {pendingProfileConfirmation.displayValue}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={confirmPendingProfileUpdate} disabled={isBusy}>
                      {language === 'ar' ? 'تأكيد' : 'Confirm'}
                    </Button>
                    <Button variant="outline" onClick={cancelPendingProfileUpdate} disabled={isBusy}>
                      {language === 'ar' ? 'إلغاء' : 'Cancel'}
                    </Button>
                  </div>
                </div>
              )}

              {pendingPlanOptions && pendingPlanOptions.options.length > 0 && (
                <div className="mx-4 mb-4 rounded-[28px] border border-white/10 bg-white/[0.04] p-4 space-y-3 sm:mx-5 lg:mx-6">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {language === 'ar' ? 'اختر الخطة التي تريدها' : 'Choose the plan you want'}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {language === 'ar'
                        ? 'بعد اختيار الخطة سيظهر لك زر الاعتماد أو الرفض مباشرة.'
                        : 'After choosing an option, you will get direct Approve and Reject buttons.'}
                    </p>
                  </div>
                  <div className="space-y-2">
                    {pendingPlanOptions.options.map((option) => (
                      <button
                        key={`${pendingPlanOptions.type}-${option.index}`}
                        type="button"
                        onClick={() => choosePlanOption(option.index)}
                        className="w-full rounded-xl border border-border/50 bg-background/60 px-4 py-3 text-left transition-colors hover:bg-secondary/40"
                      >
                        <div className="text-sm font-medium text-foreground">{option.index}. {option.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{option.summary}</div>
                      </button>
                    ))}
                  </div>
                  {pendingPlanOptions.page + 1 < pendingPlanOptions.totalPages && (
                    <Button variant="outline" onClick={loadMorePlanOptions} disabled={isBusy}>
                      {language === 'ar' ? 'خيارات أكثر' : 'More options'}
                    </Button>
                  )}
                </div>
              )}

              {workoutApprovalPlan && (
                <div className="mx-4 mb-4 sm:mx-5 lg:mx-6">
                  <PlanApprovalUI
                    type="workout"
                    plan={workoutApprovalPlan}
                    onApprove={handleApprovePlan}
                    onReject={handleRejectPlan}
                  />
                </div>
              )}

              {nutritionApprovalPlan && (
                <div className="mx-4 mb-4 sm:mx-5 lg:mx-6">
                  <PlanApprovalUI
                    type="nutrition"
                    plan={nutritionApprovalPlan}
                    onApprove={handleApprovePlan}
                    onReject={handleRejectPlan}
                  />
                </div>
              )}

              <AnimatePresence>
                {isListening && (
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="flex items-center justify-center gap-3 px-4 py-3">
                    <div className="flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-4 py-2 text-destructive shadow-[0_0_30px_rgba(239,68,68,0.18)]">
                      <div className="w-3 h-3 rounded-full bg-destructive animate-pulse" />
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
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="flex items-center justify-center gap-3 px-4 py-1">
                    <div className="flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-4 py-2 text-cyan-100 shadow-[0_0_34px_rgba(34,211,238,0.16)]">
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
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="flex items-center justify-center py-1">
                    <button
                      type="button"
                      onClick={clearError}
                      className="rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs text-destructive/90"
                    >
                      {voiceError}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="relative z-20 shrink-0 border-t border-white/10 bg-[linear-gradient(180deg,rgba(7,9,18,0),rgba(7,9,18,0.92)_20%,rgba(7,9,18,0.98))] px-4 pb-3 pt-3 sm:px-5 lg:px-6">
                {currentMessages.length <= 1 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {quickPrompts.slice(0, 4).map((prompt) => (
                      <button
                        key={`quick-${prompt}`}
                        type="button"
                        onClick={() => { setInput(prompt); focusInput(); }}
                        className="rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-2 text-xs text-muted-foreground transition-all hover:border-fuchsia-300/25 hover:bg-white/[0.08] hover:text-foreground"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
                <div className="glass-card rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(20,23,40,0.92),rgba(10,12,24,0.94))] p-3 shadow-[0_24px_80px_rgba(0,0,0,0.38)]" onDragOver={(event) => event.preventDefault()} onDrop={handleAttachmentDrop}>
                  {(isChatLimitReached || isUploadLimitReached || isPlanLimitReached) && (
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/20 bg-gradient-to-r from-violet-500/10 to-amber-400/10 px-4 py-3 shadow-[0_0_30px_rgba(245,158,11,.08)]">
                      <div className="flex items-start gap-2 text-xs text-amber-100"><Lock className="mt-0.5 h-4 w-4 shrink-0"/><div>{isChatLimitReached && <p>Chat limit reached. Upgrade to continue talking with your AI Coach.</p>}{isUploadLimitReached && <p>Upload limit reached. Upgrade to add more files.</p>}{isPlanLimitReached && <p>Plan generation limit reached. Upgrade to create more plans.</p>}</div></div>
                      <Button size="sm" variant="outline" onClick={() => showLimit(isChatLimitReached ? 'chat' : isUploadLimitReached ? 'upload' : 'plan')}>Upgrade</Button>
                    </div>
                  )}
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    accept=".pdf,image/*"
                    multiple
                    disabled={subscriptionLoading || !subscription || isUploadLimitReached || isBusy}
                    className="hidden"
                    onChange={handleAttachmentSelection}
                  />
                  {selectedAttachments.length > 0 && (
                    <div className="mb-3 grid gap-2 sm:grid-cols-2">
                      {selectedAttachments.map((item) => (
                        <div key={item.id} className="rounded-2xl border border-border/60 bg-background/70 p-3">
                          <div className="flex items-start gap-3">
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/50 bg-secondary/40">
                              {item.previewUrl ? (
                                <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />
                              ) : item.kind === 'pdf' ? (
                                <FileText className="w-6 h-6 text-primary" />
                              ) : (
                                <FileImage className="w-6 h-6 text-primary" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="truncate text-sm font-medium text-foreground">{item.file.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {item.kind === 'pdf'
                                      ? (language === 'ar' ? 'ملف PDF' : 'PDF document')
                                      : (language === 'ar' ? 'صورة للتحليل' : 'Image for analysis')}
                                    {' • '}
                                    {formatAttachmentSize(item.file.size)}
                                  </p>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0"
                                  onClick={() => removePendingAttachment(item.id)}
                                  disabled={isBusy}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {attachmentError && (
                    <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {attachmentError}
                    </div>
                  )}
                  <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs text-muted-foreground">
                    <span className="leading-6">
                      {language === 'ar'
                        ? 'ارفع ملفات PDF أو صور مثل تقارير التحاليل، صور الوجبات، ملصقات المكملات، أو لقطات التقدم.'
                        : 'Upload PDFs or images like lab reports, meal photos, supplement labels, or progress screenshots.'}
                    </span>
                    <span className="shrink-0 rounded-full border border-cyan-300/15 bg-cyan-400/10 px-2.5 py-1 text-cyan-100">
                      {selectedAttachments.length}/{MAX_CHAT_ATTACHMENTS}
                    </span>
                  </div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
                    <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">
                        {isArabic ? 'خطة ذكية' : 'Plan builder'}
                      </span>
                      <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">
                        {isArabic ? 'مزامنة الجدول' : 'Schedule sync'}
                      </span>
                      <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">
                        {isArabic ? 'السياق مفعل' : 'Context active'}
                      </span>
                    </div>
                    <span className="text-[11px] text-cyan-100/80">
                      {isArabic ? 'الردود تعتمد على ملفك الشخصي والجلسة الحالية' : 'Responses use your profile and current session context'}
                    </span>
                  </div>
                  <div className="flex items-end gap-2">
                    <Button title={isUploadLimitReached ? 'Upload limit reached.' : 'Attach a file'} variant="ghost" size="icon" onClick={openAttachmentPicker} disabled={isSubscriptionGateLoading || isBusy || isUploadLimitReached} className={`h-11 w-11 shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] ${isUploadLimitReached || isSubscriptionGateLoading ? 'cursor-not-allowed opacity-55' : ''}`}>
                      <Paperclip className="w-4 h-4" />
                    </Button>
                    {isSupported && (
                      <Button
                        variant={isListening ? 'destructive' : 'ghost'}
                        size="icon"
                        onClick={isListening ? stopListening : startListeningIfPossible}
                        disabled={isSubscriptionGateLoading || isBusy || isAssistantSpeaking || isChatLimitReached}
                        className={`h-11 w-11 shrink-0 rounded-2xl border ${isListening ? 'animate-pulse border-destructive/30 bg-destructive/10' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'}`}
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
                        isChatLimitReached
                          ? 'Chat message limit reached. Upgrade your plan to continue.'
                          : language === 'ar'
                          ? 'اسأل مدربك الذكي عن التمارين أو الوجبات أو التعافي أو جدولك...'
                          : 'Ask your AI Coach about workouts, meals, recovery, or your schedule...'
                      }
                      className="min-h-[56px] max-h-40 resize-y rounded-2xl border-white/10 bg-black/20 px-4 py-3 focus-visible:ring-1"
                      disabled={isBusy}
                      readOnly={isChatLimitReached}
                      rows={2}
                    />
                    <Button title={isChatLimitReached ? 'You reached your chat message limit.' : 'Send message'} variant="hero" size="icon" onClick={sendMessage} disabled={isSubscriptionGateLoading || isChatLimitReached || isBusy || (!input.trim() && selectedAttachments.length === 0)} className={`h-12 w-12 shrink-0 rounded-2xl shadow-[0_18px_38px_rgba(168,85,247,0.28)] ${isChatLimitReached || isSubscriptionGateLoading ? 'cursor-not-allowed opacity-55' : ''}`}>
                      {isChatLimitReached ? <Lock className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            <aside className="hidden min-h-0 overflow-y-auto overscroll-contain xl:flex">
              <div className="flex h-fit w-full flex-col gap-4 rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,18,34,0.9),rgba(8,10,22,0.92))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-xl">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-cyan-200/70">
                    {isArabic ? 'حالة المدرب' : 'Coach Status'}
                  </div>
                  <h2 className="mt-2 text-xl font-semibold text-white">
                    {isArabic ? 'لوحة السياق الذكي' : 'AI Context Panel'}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {isArabic ? 'عرض سريع لبيانات الملف الشخصي وحالة الجلسة والملفات المرفوعة.' : 'A quick view of your profile context, session state, and uploaded assets.'}
                  </p>
                </div>

                <div className="grid gap-3">
                  <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-100/70">
                        {isArabic ? 'وضع الجلسة' : 'Session mode'}
                      </span>
                      <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-200">
                        {isArabic ? 'نشط' : 'Online'}
                      </span>
                    </div>
                    <div className="grid gap-2 text-sm text-foreground">
                      <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{isArabic ? 'المحادثة' : 'Conversation'}</span><span>{conversations.length}</span></div>
                      <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{isArabic ? 'الملفات' : 'Files attached'}</span><span>{selectedAttachments.length}</span></div>
                      <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{isArabic ? 'الصوت' : 'Voice mode'}</span><span>{voiceMode ? (isArabic ? 'مفعل' : 'On') : (isArabic ? 'متوقف' : 'Off')}</span></div>
                      <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{isArabic ? 'RAG' : 'RAG'}</span><span>{showRagDebug ? (isArabic ? 'مرئي' : 'Visible') : (isArabic ? 'هادئ' : 'Idle')}</span></div>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-100/70">
                      {isArabic ? 'سياق الملف الشخصي' : 'Profile Context'}
                    </div>
                    <div className="space-y-3">
                      {profileContextEntries.map((item) => (
                        <div key={item.label} className="flex items-start justify-between gap-3 border-b border-white/6 pb-3 last:border-b-0 last:pb-0">
                          <span className="text-sm text-muted-foreground">{item.label}</span>
                          <span className="max-w-[58%] text-right text-sm font-medium text-foreground">{String(item.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-cyan-300/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.08),rgba(168,85,247,0.08))] p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-100/70">
                      {isArabic ? 'تلميح ذكي' : 'AI Tip'}
                    </div>
                    <p className="mt-3 text-sm leading-7 text-foreground/90">
                      {isArabic
                        ? 'كلما أضفت تفاصيل أكثر عن الهدف أو الوقت أو الإصابات أو الأجهزة المتاحة، أصبحت الخطة أدق وأكثر فائدة.'
                        : 'The more detail you share about your goal, schedule, injuries, and available equipment, the sharper your plan becomes.'}
                    </p>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}
