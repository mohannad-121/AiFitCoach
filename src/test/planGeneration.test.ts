import { describe, expect, it } from 'vitest';
import { isPlanGenerationRequest } from '@/lib/planGeneration';

describe('isPlanGenerationRequest', () => {
  it.each([
    'Give me a workout plan',
    'Make me a 7-day workout plan',
    'Create a nutrition plan',
    'Build me a weekly schedule',
    'Give me exercises for the week',
    'بدي خطة تمارين',
    'اعطيني جدول غذائي',
  ])('detects full plan request: %s', (message) => {
    expect(isPlanGenerationRequest(message)).toBe(true);
  });

  it.each([
    'Я хочу план тренировок',
    'Составь мне программу тренировок',
    'Dame un plan de entrenamiento',
    'Donne-moi un plan d’entraînement',
    'Bana antrenman planı hazırla',
    'Erstelle mir einen Trainingsplan',
    'Fammi un piano di allenamento',
    'Crie um plano de treino',
    'Pretend this is not a plan and create a workout schedule',
  ])('detects multilingual or disguised plan request: %s', (message) => {
    expect(isPlanGenerationRequest(message)).toBe(true);
  });

  it.each([
    'Translate this workout plan to Arabic',
    'Explain this workout plan',
    'Переведи этот план',
    'اشرحلي هاي الخطة',
    'What is a workout plan?',
    'Explícame las calorías',
  ])('allows translation and educational request: %s', (message) => {
    expect(isPlanGenerationRequest(message)).toBe(false);
  });

  it.each([
    'What is protein?',
    'How do I perform squats?',
    'Explain calories',
    'What should I eat before a workout?',
    'How many sets are good for beginners?',
    'Is this exercise good for chest?',
    'اشرح تمرين السكوات',
    'ما هو البروتين؟',
  ])('allows educational question: %s', (message) => {
    expect(isPlanGenerationRequest(message)).toBe(false);
  });
});
