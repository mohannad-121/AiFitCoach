import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { WorkoutsPage } from '@/pages/Workouts';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (key: string) => key,
    dir: 'ltr',
    setLanguage: vi.fn(),
  }),
}));

vi.mock('@/contexts/UserContext', () => ({
  useUser: () => ({
    profile: {
      location: null,
      goal: null,
      gender: null,
    },
  }),
}));

vi.mock('@/components/layout/Navbar', () => ({
  Navbar: () => <div data-testid="navbar" />,
}));

vi.mock('@/components/workout/AnatomyBody', () => ({
  advancedToGroupMap: {
    side_delts: 'shoulders',
    rear_delts: 'shoulders',
    front_delts: 'shoulders',
  },
  AnatomyBody: ({ onMuscleToggle }: { onMuscleToggle: (muscleId: string) => void }) => (
    <button type="button" onClick={() => onMuscleToggle('side_delts')}>
      Select Side Delts
    </button>
  ),
}));

vi.mock('@/components/workout/ExerciseCard', () => ({
  ExerciseCard: ({ exercise }: { exercise: { name: string } }) => <div>{exercise.name}</div>,
}));

describe('WorkoutsPage', () => {
  it('maps side delts selection to shoulder exercises including lateral raises', () => {
    render(
      <MemoryRouter>
        <WorkoutsPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select Side Delts' }));

    expect(screen.getByText('Lateral Raises')).toBeInTheDocument();
  });
});