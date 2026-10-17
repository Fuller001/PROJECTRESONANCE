/** Provider-specific voice selection. Original cloud and Step Plan preferences remain separate. */
import { createContext, useContext, useState, useCallback } from 'react';
import type { CloudVoice } from '@/hooks/useCloudTTS';
import { useSpeechService } from '@/hooks/useSpeechService';
import { TTS_VOICE_KEY } from '@/lib/storageKeys';
import { STEP_PLAN_DEFAULT_VOICE, STEP_PLAN_VOICE_KEY } from '@/lib/speechService';

function loadVoice(storageKey: string, fallback: CloudVoice): CloudVoice {
  try { return localStorage.getItem(storageKey) || fallback; }
  catch { return fallback; }
}

interface VoiceContextValue {
  selectedVoice: CloudVoice;
  setSelectedVoice: (voice: CloudVoice) => void;
}
const VoiceContext = createContext<VoiceContextValue | null>(null);

/** Accesses the selected service's voice. Must be called within VoiceProvider. */
export function useVoice(): VoiceContextValue {
  const context = useContext(VoiceContext);
  if (!context) throw new Error('useVoice must be used within VoiceProvider');
  return context;
}

/** Preserves both services' selections without migrating or overwriting legacy voice IDs. */
export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { service } = useSpeechService();
  const [workerVoice, setWorkerVoice] = useState(() => loadVoice(TTS_VOICE_KEY, 'alloy'));
  const [stepVoice, setStepVoice] = useState(() => loadVoice(STEP_PLAN_VOICE_KEY, STEP_PLAN_DEFAULT_VOICE));
  const selectedVoice = service === 'step-plan' ? stepVoice : workerVoice;
  const setSelectedVoice = useCallback((voice: CloudVoice) => {
    if (service === 'step-plan') setStepVoice(voice);
    else setWorkerVoice(voice);
    try { localStorage.setItem(service === 'step-plan' ? STEP_PLAN_VOICE_KEY : TTS_VOICE_KEY, voice); }
    catch { /* preference remains available in memory */ }
  }, [service]);

  return <VoiceContext.Provider value={{ selectedVoice, setSelectedVoice }}>{children}</VoiceContext.Provider>;
}