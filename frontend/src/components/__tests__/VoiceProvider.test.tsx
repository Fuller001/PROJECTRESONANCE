/** Provider preferences stay independent and remain usable when browser storage cannot be written. */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceProvider, useVoice } from '../VoiceProvider';
import { useSpeechService } from '@/hooks/useSpeechService';
import { SPEECH_SERVICE_KEY, STEP_PLAN_VOICE_KEY } from '@/lib/speechService';
import { TTS_VOICE_KEY } from '@/lib/storageKeys';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** Exposes the public provider and voice controls together as used by the app. */
function useControls() {
  return { ...useVoice(), ...useSpeechService() };
}

describe('provider-specific voices', () => {
  it('preserves the legacy voice and restores both selections across service changes', () => {
    localStorage.setItem(TTS_VOICE_KEY, 'nova');
    const { result } = renderHook(useControls, { wrapper: VoiceProvider });
    expect(result.current.service).toBe('step-plan');
    expect(result.current.selectedVoice).toBe('qinqienvsheng');
    act(() => result.current.setSelectedVoice('wenrounvsheng'));
    act(() => result.current.setService('worker'));
    expect(result.current.selectedVoice).toBe('nova');
    act(() => result.current.setSelectedVoice('echo'));
    act(() => result.current.setService('step-plan'));
    expect(result.current.selectedVoice).toBe('wenrounvsheng');
    expect(localStorage.getItem(TTS_VOICE_KEY)).toBe('echo');
    expect(localStorage.getItem(STEP_PLAN_VOICE_KEY)).toBe('wenrounvsheng');
  });

  it('switches all consumers in memory if reads work but persistence fails', () => {
    localStorage.setItem(SPEECH_SERVICE_KEY, 'step-plan');
    const { result } = renderHook(useControls, { wrapper: VoiceProvider });
    const writes = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    act(() => result.current.setService('worker'));
    expect(result.current.service).toBe('worker');
    act(() => result.current.setSelectedVoice('echo'));
    expect(result.current.selectedVoice).toBe('echo');
    act(() => result.current.setService('step-plan'));
    expect(result.current.selectedVoice).toBe('qinqienvsheng');
    writes.mockRestore();
    act(() => result.current.setService('step-plan'));
  });
});
