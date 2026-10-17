/** Cloud playback stops on Android pause/unmount and releases every audio object URL. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import { isAndroid } from '@/lib/r2t2';
import { api } from '@/lib/api';
import { speakStepPlan } from '@/lib/stepPlan';
import type { SpeechService } from '@/lib/speechService';

/** Plays Step Plan or legacy cloud audio with shared cancellation, voice and local-volume controls. */

export type CloudVoice =
  | 'alloy'       // 中性女声
  | 'echo'        // 温和男声
  | 'fable'       // 英式男声
  | 'onyx'        // 深沉男声
  | 'nova'        // 温柔女声
  | 'shimmer'     // 清晰女声
  | string;       // 也支持自定义音色 ID

export type CloudTtsModel = 'tts-1' | 'tts-1-hd';

export interface CloudTtsSpeakOptions {
  service?: SpeechService;
  voice?: CloudVoice;
  model?: CloudTtsModel;
  speed?: number;        // 0.25 ~ 4.0，默认 1.0
  volume?: number;       // 0 ~ 1，控制播放音量，默认 1.0
  response_format?: 'mp3' | 'wav' | 'flac' | 'opus';
  sample_rate?: 8000 | 16000 | 22050 | 24000 | 48000;
  instruction?: string;  // 可选语音指令
}

interface UseCloudTTSReturn {
  speak: (text: string, options?: CloudTtsSpeakOptions) => Promise<void>;
  stop: () => void;
  isSpeaking: boolean;
  error: string | null;
}

export function useCloudTTS(defaults?: CloudTtsSpeakOptions): UseCloudTTSReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const foreground = useRef(true);

  const releaseAudio = useCallback(() => {
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.src = '';
    }
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
  }, []);

  const stop = useCallback(() => {
    generation.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    releaseAudio();
    if (mounted.current) { setIsSpeaking(false); setError(null); }
  }, [releaseAudio]);

  useEffect(() => {
    mounted.current = true;
    foreground.current = true;
    const pause = isAndroid() ? App.addListener('pause', () => { foreground.current = false; stop(); }) : null;
    const resume = isAndroid() ? App.addListener('resume', () => { foreground.current = true; }) : null;
    return () => {
      mounted.current = false;
      stop();
      if (pause) void pause.then((listener) => listener.remove());
      if (resume) void resume.then((listener) => listener.remove());
    };
  }, [stop]);
  useEffect(() => { stop(); }, [defaults?.service, stop]);
  const speak = useCallback(async (text: string, options?: CloudTtsSpeakOptions) => {
    const trimmed = (text || '').trim();
    if (!trimmed || !mounted.current || !foreground.current) return;

    stop();
    const id = generation.current;
    setError(null);
    setIsSpeaking(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const merged = { ...defaults, ...options };
    const payload = {
      text: trimmed,
      voice: merged.voice,
      model: merged.model,
      speed: merged.speed,
      volume: 1,
      response_format: merged.response_format,
      sample_rate: merged.sample_rate,
      instruction: merged.instruction,
    };

    try {
      const audioBlob = merged.service === 'step-plan'
        ? await speakStepPlan({ text: trimmed, voice: merged.voice, speed: merged.speed }, controller.signal)
        : await api.tts.speak(payload, controller.signal);

      if (controller.signal.aborted || generation.current !== id || !mounted.current) return;

      const audioUrl = URL.createObjectURL(audioBlob);
      audioUrlRef.current = audioUrl;
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.volume = Math.min(1, Math.max(0, merged.volume ?? 1));

      const cleanup = () => {
        if (generation.current !== id || !mounted.current) return;
        releaseAudio();
        setIsSpeaking(false);
      };
      audio.onended = cleanup;
      audio.onerror = () => {
        if (generation.current !== id || !mounted.current) return;
        setError('音频播放失败');
        cleanup();
      };

      await audio.play();
    } catch (err) {
      if (generation.current !== id || !mounted.current) return;
      releaseAudio();
      if ((err as Error)?.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : '语音合成播放失败');
      }
      setIsSpeaking(false);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [defaults, stop, releaseAudio]);

  return { speak, stop, isSpeaking, error };
}