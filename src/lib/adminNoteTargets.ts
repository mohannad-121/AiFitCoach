export type ScheduleTargetView = 'workout' | 'nutrition';

export type ScheduleNoteTarget = {
  view: ScheduleTargetView;
  date?: string | null;
  itemName?: string | null;
};

const TARGET_PREFIX = '[[fitcoach_schedule_target:';
const TARGET_SUFFIX = ']]';

export function encodeAdminNoteTarget(noteText: string, target?: ScheduleNoteTarget | null): string {
  const cleanText = stripAdminNoteTarget(noteText).cleanText.trim();
  if (!target) {
    return cleanText;
  }

  const normalizedTarget: ScheduleNoteTarget = {
    view: target.view,
    date: target.date || null,
    itemName: target.itemName || null,
  };

  return `${cleanText}\n${TARGET_PREFIX}${JSON.stringify(normalizedTarget)}${TARGET_SUFFIX}`;
}

export function stripAdminNoteTarget(noteText: string): { cleanText: string; target: ScheduleNoteTarget | null } {
  const text = String(noteText || '');
  const startIndex = text.lastIndexOf(TARGET_PREFIX);
  if (startIndex < 0) {
    return { cleanText: text.trim(), target: null };
  }

  const endIndex = text.indexOf(TARGET_SUFFIX, startIndex + TARGET_PREFIX.length);
  if (endIndex < 0) {
    return { cleanText: text.trim(), target: null };
  }

  const payload = text.slice(startIndex + TARGET_PREFIX.length, endIndex);
  const cleanText = `${text.slice(0, startIndex)}${text.slice(endIndex + TARGET_SUFFIX.length)}`.trim();

  try {
    const parsed = JSON.parse(payload) as ScheduleNoteTarget;
    if (!parsed || (parsed.view !== 'workout' && parsed.view !== 'nutrition')) {
      return { cleanText, target: null };
    }

    return {
      cleanText,
      target: {
        view: parsed.view,
        date: parsed.date || null,
        itemName: parsed.itemName || null,
      },
    };
  } catch {
    return { cleanText, target: null };
  }
}

export function buildScheduleTargetUrl(target: ScheduleNoteTarget): string {
  const params = new URLSearchParams();
  params.set('view', target.view);
  if (target.date) {
    params.set('focusDate', target.date);
  }
  if (target.itemName) {
    params.set('highlightItem', target.itemName);
  }

  const query = params.toString();
  return query ? `/schedule?${query}` : '/schedule';
}