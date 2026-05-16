import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExerciseCard } from '@/components/workout/ExerciseCard';
import { exercises } from '@/data/exercises';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (key: string) => key,
    dir: 'ltr',
    setLanguage: vi.fn(),
  }),
}));

vi.mock('@/data/exerciseVideoResolver', () => ({
  getExerciseVideoUrl: () => '/videos/demo.mp4',
  isLocalExerciseVideo: () => true,
}));

describe('ExerciseCard', () => {
  it('expands inline to show the video and exercise instructions', () => {
    const onToggleExpanded = vi.fn();
    const onCollapse = vi.fn();

    const { rerender } = render(
      <ExerciseCard
        exercise={exercises[0]}
        selectedGender={null}
        isExpanded={false}
        onToggleExpanded={onToggleExpanded}
        onCollapse={onCollapse}
      />
    );

    fireEvent.click(screen.getByText('Push-Ups'));

    expect(onToggleExpanded).toHaveBeenCalledTimes(1);

    rerender(
      <ExerciseCard
        exercise={exercises[0]}
        selectedGender={null}
        isExpanded={true}
        onToggleExpanded={onToggleExpanded}
        onCollapse={onCollapse}
      />
    );

    expect(screen.getByText(/How to do this exercise/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Close exercise details')).toBeInTheDocument();
    expect(screen.getByText(/1\. Set up for Push-Ups/i)).toBeInTheDocument();
    expect(screen.queryByText('تمرين الضغط')).not.toBeInTheDocument();
  });
});