/** Shared, persisted ASR choice. Local mode never implicitly falls back to a cloud service. */
import { useSyncExternalStore } from 'react';
import { isAndroid } from '@/lib/r2t2';

export type ASREnginePreference = 'auto' | 'cloud' | 'browser' | 'local';
const STORAGE_KEY = 'resonance_asr_engine_pref';
const listeners = new Set<() => void>();
let memoryPreference: ASREnginePreference | undefined;

/** Reads the preference before the initial render so offline entry needs no network round trip. */
export function getASREnginePreference(): ASREnginePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'local') return isAndroid() ? value : 'auto';
    if (value === 'auto' || value === 'cloud' || value === 'browser') return value;
  } catch { return memoryPreference ?? (isAndroid() ? 'local' : 'auto'); }
  return isAndroid() ? 'local' : 'auto';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
}

/** Updates every mounted consumer, including the authentication gate and recording page. */
export function setASREnginePreference(next: ASREnginePreference): void {
  memoryPreference = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Keep the in-memory selection. */ }
  listeners.forEach((listener) => listener());
}

export function useASREnginePreference() {
  const preference = useSyncExternalStore(subscribe, getASREnginePreference, () => 'auto' as const);
  return { preference, setPreference: setASREnginePreference };
}
