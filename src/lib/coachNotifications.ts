import { ScheduleNoteTarget, stripAdminNoteTarget } from '@/lib/adminNoteTargets';

export const AI_BACKEND_URL = (import.meta.env.VITE_AI_BACKEND_URL || 'http://127.0.0.1:8002').replace(/\/$/, '');

export type CoachNotification = {
  id: string;
  user_id: string;
  author_name: string;
  author_role: 'coach' | 'doctor';
  note_category: 'general' | 'workout' | 'nutrition';
  note_text: string;
  related_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CoachNotificationsResponse = {
  user_id: string;
  storage_ready: boolean;
  count: number;
  notifications: CoachNotification[];
};

export type ParsedCoachNotification = CoachNotification & {
  clean_text: string;
  schedule_target: ScheduleNoteTarget | null;
};

const readIdsKey = (userId: string) => `fitcoach_coach_notifications_read_${userId}`;
const lastNotifiedAtKey = (userId: string) => `fitcoach_coach_notifications_last_notified_${userId}`;

function readStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
  } catch {
    return [];
  }
}

function writeStringArray(key: string, values: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(new Set(values)).slice(-500)));
  } catch {
    // Ignore storage failures.
  }
}

export async function fetchCoachNotifications(userId: string, limit = 50): Promise<CoachNotificationsResponse> {
  const response = await fetch(`${AI_BACKEND_URL}/coach-notifications?user_id=${encodeURIComponent(userId)}&limit=${limit}`);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.detail || 'Failed loading coach notifications');
  }

  const notifications = Array.isArray(payload?.notifications)
    ? (payload.notifications as CoachNotification[])
    : [];

  return {
    user_id: String(payload?.user_id || userId),
    storage_ready: Boolean(payload?.storage_ready),
    count: Number(payload?.count || notifications.length || 0),
    notifications,
  };
}

export function parseCoachNotification(notification: CoachNotification): ParsedCoachNotification {
  const { cleanText, target } = stripAdminNoteTarget(notification.note_text);
  return {
    ...notification,
    clean_text: cleanText,
    schedule_target: target,
  };
}

export function getReadCoachNotificationIds(userId: string): string[] {
  return readStringArray(readIdsKey(userId));
}

export function markCoachNotificationsRead(userId: string, notificationIds: string[]) {
  const existing = getReadCoachNotificationIds(userId);
  writeStringArray(readIdsKey(userId), [...existing, ...notificationIds]);
 }

export function getLastCoachNotificationTimestamp(userId: string): string | null {
  try {
    return localStorage.getItem(lastNotifiedAtKey(userId));
  } catch {
    return null;
  }
}

export function setLastCoachNotificationTimestamp(userId: string, value: string) {
  try {
    localStorage.setItem(lastNotifiedAtKey(userId), value);
  } catch {
    // Ignore storage failures.
  }
}

export function truncateNotificationText(value: string, maxLength = 140): string {
  const clean = stripAdminNoteTarget(value).cleanText.trim().replace(/\s+/g, ' ');
  if (clean.length <= maxLength) {
    return clean;
  }
  return `${clean.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}