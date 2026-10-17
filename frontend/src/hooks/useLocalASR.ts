/** On-device ASR state; cancellation invalidates decoding work and late native results. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import { R2T2, isAndroid, recordingToPCM, cleanR2T2Transcript } from '@/lib/r2t2';
import type { UseCloudASRReturn } from './useCloudASR';
import type { ASRError } from '@/types/asrError';

export function useLocalASR(): UseCloudASRReturn {
  const [finalText, setFinalText] = useState('');
  const [error, setError] = useState<ASRError | null>(null);
  const [isProcessing, setProcessing] = useState(false);
  const generation = useRef(0);
  const active = useRef(false);

  const reset = useCallback(() => {
    generation.current++;
    if (active.current && isAndroid()) void R2T2.cancel().catch(() => {});
    active.current = false;
    setFinalText('');
    setError(null);
    setProcessing(false);
  }, []);

  useEffect(() => {
    if (!isAndroid()) return;
    const listener = App.addListener('pause', reset);
    return () => {
      generation.current++;
      if (active.current) void R2T2.cancel().catch(() => {});
      active.current = false;
      void listener.then((handle) => handle.remove());
    };
  }, [reset]);

  const transcribe = useCallback(async (blob: Blob): Promise<string | null> => {
    if (active.current) return null;
    const id = ++generation.current;
    active.current = true;
    setFinalText('');
    setError(null);
    setProcessing(true);
    const start = Date.now();
    try {
      if (!isAndroid()) throw new Error('请在 Android 应用中使用本地识别');
      const pcmBase64 = await recordingToPCM(blob);
      if (generation.current !== id) return null;
      const result = await R2T2.transcribe({ pcmBase64, sampleRate: 16000 });
      if (generation.current !== id) return null;
      const text = cleanR2T2Transcript(result.text);
      if (!text) throw new Error('未能识别到语音内容，请重试');
      setFinalText(text);
      return text;
    } catch (cause) {
      if (generation.current !== id) return null;
      setError({
        code: 'ALL_FAILED',
        userMessage: '本地识别未完成',
        userAction: cause instanceof Error ? cause.message : '请在设置中检查模型状态后重试',
        retryable: true,
        fallbackActive: false,
        diagnostics: { status: null, attempts: 1, totalDurationMs: Date.now() - start,
          timestamp: new Date().toISOString(), model: 'Confucius4-R2T2 Q4_K_M' },
      });
      return null;
    } finally {
      if (generation.current === id) { active.current = false; setProcessing(false); }
    }
  }, []);

  return { finalText, error, isProcessing, errorMessage: error?.userMessage ?? null, transcribe, reset };
}
