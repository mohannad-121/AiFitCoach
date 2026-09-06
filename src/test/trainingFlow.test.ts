import { describe, expect, it } from 'vitest';
import { exercises, getExercisesByFilters } from '@/data/exercises';
import { resolveScheduledExercise, scheduledMuscles, workoutDayLink, muscleGroups, resolveWorkoutSelection } from '@/lib/trainingCatalog';
import { advanceRep, emptyRepCounter } from '@/lib/repCounter';

describe('schedule to workout handoff', () => {
  it('preserves plan order and prescribed sets/reps without changing library defaults', () => {
    const link = new URL(workoutDayLink([{name:'Squats',sets:'2-3',reps:'8'},{name:'Plank',sets:'2',reps:'20 sec'}],'2026-09-06'),'http://localhost');
    const selection = resolveWorkoutSelection(link.searchParams.get('exerciseIds')!.split(','),link.searchParams.get('prescription'));
    expect(selection.map(item=>item.id)).toEqual(['squats','plank']);
    expect(selection[0]).toMatchObject({sets:'2-3',reps:'8'});
    expect(exercises.find(item=>item.id==='squats')?.reps).not.toBe('8');
    expect(resolveWorkoutSelection(['squats'],'broken')[0].id).toBe('squats');
  });
  it('matches bilingual names and IDs, preserving exact prescribed movements', () => {
    expect(resolveScheduledExercise({ name: 'Romanian Deadlift' })?.id).toBe('romanian-deadlift');
    expect(resolveScheduledExercise({ nameAr: 'تمرين الضغط' })?.id).toBe('push-ups');
    expect(resolveScheduledExercise({ exerciseId: 'bicep-curls', name: 'Custom label' })?.id).toBe('bicep-curls');
    expect(resolveScheduledExercise({ name: 'Unknown chest movement' })).toBeUndefined();
    const items = [{ name: 'Squats' }, { name: 'Plank' }];
    expect(scheduledMuscles(items)).toEqual(['quads','abs']);
    const link = new URL(workoutDayLink(items, '2026-09-06'), 'http://localhost');
    expect(link.searchParams.get('exerciseIds')).toBe('squats,plank');
    expect(link.searchParams.get('date')).toBe('2026-09-06');
  });
  it('covers every shared muscle group for both genders and locations', () => {
    expect(new Set(exercises.map(item => item.id)).size).toBe(exercises.length);
    for (const group of Object.keys(muscleGroups)) for (const gender of ['male','female']) for (const place of ['home','gym']) {
      expect(getExercisesByFilters([group],null,place,gender).length, group + '/' + gender + '/' + place).toBeGreaterThan(0);
    }
  });
});

describe('camera repetition counter', () => {
  it('requires both stable endpoints and a return', () => {
    let state = emptyRepCounter();
    for (const [phase,time] of [['top',0],['top',200],['transition',300],['bottom',600],['bottom',800],['top',1000],['top',1200]] as const) state = advanceRep(state,phase,time,true);
    expect(state.count).toBe(1);
    state = advanceRep(state,'top',1600,true);
    expect(state.count).toBe(1);
  });
  it('rejects jitter, holds, and cycles interrupted by lost tracking', () => {
    let state = emptyRepCounter();
    for (let i=0;i<20;i++) state = advanceRep(state,i%2 ? 'bottom':'top',i*40,true);
    expect(state.count).toBe(0);
    state = advanceRep(state,'hold',1000,true);
    state = advanceRep(state,'hold',4000,true);
    expect(state.count).toBe(0);
    state = { ...emptyRepCounter(), start:'top', opposite:true };
    state = advanceRep(state,null,5000,false);
    state = advanceRep(state,'top',5200,true);
    state = advanceRep(state,'top',5400,true);
    expect(state.count).toBe(0);
  });
});
