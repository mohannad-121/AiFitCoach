import type { UserProfile } from './profile';
export interface CoachPlanItem {
  id?: string; exerciseId?: string; name: string; nameAr?: string; muscle?: string;
  sets?: string | number; reps?: string | number; rest_seconds?: number; notes?: string;
  ingredients?: string[]; description?: string; descriptionAr?: string; calories?: number | string;
  protein?: number; carbs?: number; fat?: number;
}
export interface CoachPlanDay { day: string; dayAr?: string; exercises?: CoachPlanItem[]; meals?: CoachPlanItem[] }
export function isCoachPlanDay(value: unknown): value is CoachPlanDay {
  if (!value || typeof value !== 'object' || !('day' in value) || typeof value.day !== 'string') return false;
  return ['exercises', 'meals'].every(key => {
    const items = (value as Record<string, unknown>)[key];
    return items === undefined || Array.isArray(items) && items.every(item => item && typeof item === 'object' && typeof item.name === 'string');
  });
}
export interface GeneratedCoachPlan {
  id?: string; title?: string; title_ar?: string; created_at?: string; duration_days?: number; daily_calories?: number;
  training_days_per_week?: number; trainingDaysPerWeek?: number; days_per_week?: number;
  days?: CoachPlanDay[]; exercises?: CoachPlanItem[]; meals?: CoachPlanItem[];
}
type ApprovedPlan = { type?: string; plan?: GeneratedCoachPlan };
export interface CoachApiResponse {
  reply?: string; action?: string | null; approved_plan?: ApprovedPlan;
  data?: { plan?: GeneratedCoachPlan; plan_id?: string; plan_type?: string; approved_plan?: ApprovedPlan;
    options?: Array<{ index: number; title?: string; summary?: string }>; page?: number; total_pages?: number;
    field?: string; field_label?: string; display_value?: string; profile_updates?: Partial<UserProfile>; supabase_updates?: Record<string, unknown>;
  } | null;
}
