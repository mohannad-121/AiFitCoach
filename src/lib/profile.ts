import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
export const profileSchema = z.object({
  name: z.string().trim().min(2).max(100), age: z.number().int().min(13).max(120),
  gender: z.enum(['male', 'female']), weight: z.number().min(25).max(350), height: z.number().min(100).max(250),
  goal: z.enum(['bulking', 'cutting', 'fitness']), location: z.enum(['home', 'gym']),
  fitnessLevel: z.enum(['beginner', 'intermediate', 'advanced']), trainingDaysPerWeek: z.number().int().min(1).max(7),
  activityLevel: z.enum(['low', 'moderate', 'high']), equipment: z.string().default(''), injuries: z.string().default(''),
  dietaryPreferences: z.string().default(''), chronicConditions: z.string().default(''), allergies: z.string().default(''),
  avatarUrl: z.string().optional(), onboardingCompleted: z.boolean(),
});
export type UserProfile = z.infer<typeof profileSchema>;
export type OnboardingDraft = Partial<Omit<UserProfile, 'onboardingCompleted'>>;
export const hasConfiguredSupabase = Boolean(import.meta.env.VITE_SUPABASE_URL && (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY));
export async function saveProfileForUser(userId: string, value: UserProfile) {
  const profile = profileSchema.parse(value);
  if (!hasConfiguredSupabase && userId.startsWith('mock_')) return profile;
  const payload = {
    user_id: userId, name: profile.name, age: profile.age, gender: profile.gender,
    weight: profile.weight, height: profile.height, goal: profile.goal, location: profile.location,
    fitness_level: profile.fitnessLevel, training_days_per_week: profile.trainingDaysPerWeek,
    equipment: profile.equipment, injuries: profile.injuries, activity_level: profile.activityLevel,
    dietary_preferences: profile.dietaryPreferences, chronic_conditions: profile.chronicConditions,
    allergies: profile.allergies, onboarding_completed: profile.onboardingCompleted, updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('profiles').select('id').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1);
  if (error) throw error;
  const result = data?.[0]
    ? await supabase.from('profiles').update(payload).eq('id', data[0].id).eq('user_id', userId).select('id').single()
    : await supabase.from('profiles').insert(payload).select('id').single();
  if (result.error) throw result.error;
  return profile;
}
