import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { Exercise } from '@/data/exercises';
import { getExerciseVideoUrl, isLocalExerciseVideo } from '@/data/exerciseVideoResolver';
import { bilingualLabel, repairMojibake } from '@/lib/text';
import { buildExerciseInstructions } from '@/components/workout/exerciseInstructions';

interface ExerciseCardProps {
  exercise: Exercise;
  selectedGender?: 'male' | 'female' | null;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  onCollapse?: () => void;
}

const muscleLabelsEn: Record<string, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  abs: 'Abs',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
};

const muscleLabelsAr: Record<string, string> = {
  chest: 'الصدر',
  back: 'الظهر',
  shoulders: 'الأكتاف',
  biceps: 'البايسبس',
  triceps: 'الترايسبس',
  abs: 'البطن',
  quads: 'الفخذ الأمامي',
  hamstrings: 'الفخذ الخلفي',
  glutes: 'المؤخرة',
  calves: 'السمانة',
};

export function ExerciseCard({
  exercise,
  selectedGender = null,
  isExpanded = false,
  onToggleExpanded,
  onCollapse,
}: ExerciseCardProps) {
  const { language } = useLanguage();
  const resolvedVideoUrl = getExerciseVideoUrl(exercise, selectedGender);
  const localVideo = isLocalExerciseVideo(resolvedVideoUrl);
  const hasVideo = localVideo && resolvedVideoUrl.length > 0;
  const externalDemoUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${exercise.name} exercise form`)}`;

  const englishName = repairMojibake(exercise.name);
  const arabicName = repairMojibake(exercise.nameAr || exercise.name);
  const name = bilingualLabel(englishName, arabicName, language);
  const noVideoLabel = bilingualLabel('Open demo', 'فتح شرح', language);
  const descriptionPoints = buildExerciseInstructions(exercise);
  const howToTitle = bilingualLabel('How to do this exercise', 'طريقة أداء التمرين', language);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-2xl overflow-hidden group hover:border-primary/50 transition-all duration-300"
      >
        <div
          className="relative h-72 bg-secondary overflow-hidden cursor-pointer"
          onClick={() => {
            if (hasVideo) {
              onToggleExpanded?.();
              return;
            }
            window.open(externalDemoUrl, '_blank', 'noopener,noreferrer');
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent z-10" />
          <div className="absolute inset-0 flex items-center justify-center z-20">
            {hasVideo ? (
              <div className="w-16 h-16 rounded-full bg-primary/90 flex items-center justify-center group-hover:scale-110 transition-transform shadow-glow">
                <Play className="w-7 h-7 text-primary-foreground ml-1" />
              </div>
            ) : (
              <span className="text-sm px-4 py-2 rounded-full bg-background/70 text-muted-foreground border border-border/50">
                {noVideoLabel}
              </span>
            )}
          </div>
          {hasVideo ? (
            <video
              src={resolvedVideoUrl}
              className="w-full h-full object-cover"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              src="/placeholder.svg"
              alt={name}
              className="w-full h-full object-cover"
            />
          )}
          <div className="absolute inset-x-0 bottom-0 z-20 p-5">
            <h3 className="text-xl font-semibold text-white drop-shadow-md">{englishName}</h3>
          </div>
        </div>
        {isExpanded && hasVideo && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="border-t border-border/30 bg-card/95"
          >
            <div className="flex items-center justify-between border-b border-border/30 px-5 py-4">
              <h4 className="text-lg font-semibold text-foreground">{englishName}</h4>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => onCollapse?.()}
                aria-label="Close exercise details"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="grid gap-0 lg:grid-cols-[1.35fr_0.95fr]">
              <div className="relative aspect-video w-full bg-black">
                {localVideo ? (
                  <video
                    src={resolvedVideoUrl}
                    className="w-full h-full object-contain bg-black"
                    controls
                    autoPlay
                    playsInline
                  />
                ) : (
                  <iframe
                    src={`${resolvedVideoUrl}?autoplay=1`}
                    className="w-full h-full"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                    title={name}
                  />
                )}
              </div>

              <div className="max-h-[34rem] overflow-y-auto border-t border-border/30 bg-card p-6 lg:border-l lg:border-t-0">
                <p className="mb-4 text-sm font-medium uppercase tracking-[0.18em] text-primary">{howToTitle}</p>
                <ol className="space-y-4 text-sm leading-7 text-muted-foreground">
                  {descriptionPoints.map((point, index) => (
                    <li key={`${exercise.id}-point-${index + 1}`} className="rounded-xl border border-border/40 bg-background/30 p-4">
                      <p className="font-medium text-foreground">{index + 1}. {point.en}</p>
                      <p className="mt-2 text-right" dir="rtl">{point.ar}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>
    </>
  );
}
