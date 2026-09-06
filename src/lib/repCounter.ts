import type { RepPhase } from './poseFeedback';

export interface RepCounter { count: number; start: RepPhase; opposite: boolean; candidate: RepPhase; since: number; lastCount: number; }
export const emptyRepCounter = (): RepCounter => ({ count: 0, start: null, opposite: false, candidate: null, since: 0, lastCount: -Infinity });

// A repetition needs both endpoints and a return, each held long enough to reject jitter.
export function advanceRep(state: RepCounter, phase: RepPhase, now: number, usable: boolean): RepCounter {
  if (!usable || !phase) return { ...emptyRepCounter(), count: state.count, lastCount: state.lastCount };
  if (phase === 'hold' || phase === 'transition') return { ...state, candidate: null, since: now };
  if (phase !== state.candidate) return { ...state, candidate: phase, since: now };
  if (now - state.since < 180) return state;
  if (!state.start) return { ...state, start: phase };
  if (phase !== state.start) return { ...state, opposite: true };
  if (state.opposite && now - state.lastCount >= 700) return { ...state, count: state.count + 1, opposite: false, lastCount: now };
  return state;
}
