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

describe('ExerciseCard', () => {
  it('expands inline to show exercise instructions without embedding a video', () => {
    const onToggleExpanded = vi.fn();
    const onCollapse = vi.fn();

    const { rerender } = render(
      <ExerciseCard
        exercise={exercises.find(item => item.id === 'push-ups')!}
        isExpanded={false}
        onToggleExpanded={onToggleExpanded}
        onCollapse={onCollapse}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /view instructions/i }));

    expect(onToggleExpanded).toHaveBeenCalledTimes(1);

    rerender(
      <ExerciseCard
        exercise={exercises.find(item => item.id === 'push-ups')!}
        isExpanded={true}
        onToggleExpanded={onToggleExpanded}
        onCollapse={onCollapse}
      />
    );

    expect(screen.getByText(/Exercise instructions/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Close instructions')).toBeInTheDocument();
    expect(screen.getByText(/1\. Set up for Push-Ups/i)).toBeInTheDocument();
    expect(screen.queryByText('تمرين الضغط')).not.toBeInTheDocument();
    expect(document.querySelector('video, iframe')).not.toBeInTheDocument();
  });
});
