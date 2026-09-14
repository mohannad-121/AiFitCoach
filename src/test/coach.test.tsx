import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { CoachPage } from '@/pages/Coach';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (key: string) => key,
    dir: 'ltr',
    setLanguage: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
  }),
}));

vi.mock('@/contexts/UserContext', () => ({
  useUser: () => ({
    profile: {
      name: 'Test User',
      age: 25,
      gender: 'male',
      weight: 70,
      height: 175,
      goal: 'fitness',
      location: 'home',
      fitnessLevel: 'beginner',
      trainingDaysPerWeek: 3,
      equipment: '',
      injuries: '',
      activityLevel: 'moderate',
      dietaryPreferences: '',
      chronicConditions: '',
      allergies: '',
    },
  }),
}));

vi.mock('@/hooks/useVoiceChat', () => ({
  useVoiceChat: () => ({
    isListening: false,
    isProcessing: false,
    isSupported: false,
    error: null,
    clearError: vi.fn(),
    startListening: vi.fn(),
    stopListening: vi.fn(),
    cancelVoiceRequest: vi.fn(),
  }),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    subscription: {
      plan: 'free', status: 'active', currentPeriodStart: null, currentPeriodEnd: null, isUnlimited: false,
      usage: { uploadsUsed: 0, uploadsLimit: 2, chatMessagesUsed: 0, chatMessagesLimit: 30, generatedPlansUsed: 0, generatedPlansLimit: 1 },
    },
    loading: false,
    error: '',
    refresh: vi.fn(),
  }),
}));

vi.mock('@/components/layout/Navbar', () => ({
  Navbar: () => <div data-testid="navbar" />,
}));

vi.mock('@/components/ai/PlanApprovalUI', () => ({
  PlanApprovalUI: () => <div data-testid="plan-approval" />,
}));

const makeQuery = () => {
  const query = {
    select: () => query, eq: () => query, order: () => query, limit: () => query,
    maybeSingle: () => Promise.resolve({ data: null }), insert: () => query,
    update: () => query, delete: () => query, not: () => query, like: () => query,
    single: () => Promise.resolve({ data: null }),
    then: <T,>(resolve: (value: { data: unknown[] }) => T) => Promise.resolve({ data: [] }).then(resolve),
  };
  return query;
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => makeQuery(),
  },
}));

describe('CoachPage', () => {
  it('renders chat input', () => {
    render(
      <MemoryRouter>
        <CoachPage />
      </MemoryRouter>
    );

    expect(screen.getByPlaceholderText('Ask your coach...')).toBeInTheDocument();
  });
});
