import { useSyncExternalStore } from 'react';
import { WatchProgress } from '../types';
import {
  getServerSnapshot,
  getSnapshot,
  subscribe,
} from '../lib/progressStore';

/** All persisted watch progress, keyed by movie id. */
export function useAllProgress(): Record<string, WatchProgress> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}