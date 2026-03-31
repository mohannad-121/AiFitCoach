-- Add allergies column to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS allergies text NOT NULL DEFAULT '';