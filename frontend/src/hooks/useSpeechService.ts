/** Reactive provider selection; credentials never enter ordinary app settings. */
import { useSyncExternalStore } from 'react';
import { SPEECH_SERVICE_KEY, type SpeechService } from '@/lib/speechService';

let memoryService: SpeechService = 'step-plan';
let storageUnavailable = false;
const CHANGE_EVENT = 'resonance:speech-service';
function subscribe(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}
function getService(): SpeechService {
  if (storageUnavailable) return memoryService;
  try { return localStorage.getItem(SPEECH_SERVICE_KEY) === 'worker' ? 'worker' : 'step-plan'; }
  catch { storageUnavailable = true; return memoryService; }
}

/** Returns the selected service and a setter that updates all mounted speech consumers. */
export function useSpeechService() {
  const service = useSyncExternalStore(subscribe, getService, () => 'step-plan' as const);
  const setService = (value: SpeechService) => {
    memoryService = value;
    try { localStorage.setItem(SPEECH_SERVICE_KEY, value); storageUnavailable = false; }
    catch { storageUnavailable = true; }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  return { service, setService };
}
