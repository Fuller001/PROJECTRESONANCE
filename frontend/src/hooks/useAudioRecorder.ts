/** WebView recording with explicit Android permission and foreground-only microphone lifetime. */
import { useState, useCallback, useRef, useEffect } from 'react';
import { App } from '@capacitor/app';
import { R2T2, isAndroid } from '@/lib/r2t2';
interface RecordingResult {
  /** Compressed webm blob — small, ideal for ASR upload */
  webmBlob: Blob;
  /** PCM WAV blob — needed by voice-cloning APIs; null if conversion failed */
  wavBlob: Blob | null;
  /** Alias for wavBlob (backward compat); falls back to webmBlob */
  blob: Blob;
  duration: number;
}

interface StopRecordingOptions {
  /** Whether to generate WAV (CPU-heavy). Disable when only ASR is needed. */
  includeWav?: boolean;
}

interface UseAudioRecorderReturn {
  isRecording: boolean;
  duration: number;
  startRecording: () => Promise<void>;
  stopRecording: (options?: StopRecordingOptions) => Promise<RecordingResult | null>;
  error: string | null;
  audioLevel: number;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const unmountedRef = useRef(false);

  const generation = useRef(0);
  const starting = useRef(false);
  const pendingStop = useRef<((result: RecordingResult | null) => void) | null>(null);
  const stopLevelMonitoring = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    const ctx = audioContextRef.current;
    if (ctx && ctx.state !== 'closed') {
      ctx.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    if (!unmountedRef.current) setAudioLevel(0);
  }, []);

  const startLevelMonitoring = useCallback((stream: MediaStream) => {
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const updateLevel = () => {
      if (unmountedRef.current) return;
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      setAudioLevel(avg / 128);
      animFrameRef.current = requestAnimationFrame(updateLevel);
    };
    updateLevel();
  }, []);

  const discardRecording = useCallback(() => {
    generation.current++;
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      mediaRecorderRef.current = null;
    }
    pendingStop.current?.(null);
    pendingStop.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    chunksRef.current = [];
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    stopLevelMonitoring();
    if (!unmountedRef.current) { setIsRecording(false); setDuration(0); }
  }, [stopLevelMonitoring]);

  useEffect(() => {
    unmountedRef.current = false;
    const handle = isAndroid() ? App.addListener('pause', discardRecording) : null;
    return () => {
      unmountedRef.current = true;
      discardRecording();
      if (handle) void handle.then((listener) => listener.remove());
    };
  }, [discardRecording]);
  const startRecording = useCallback(async () => {
    if (starting.current || mediaRecorderRef.current?.state === 'recording') return;
    starting.current = true;
    const id = ++generation.current;
    try {
      setError(null);
      if (isAndroid()) await R2T2.requestMicrophone();
      if (unmountedRef.current || generation.current !== id) return;

      // Pre-flight: catch common mobile/HTTPS issues with clearer messages
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('当前浏览器不支持录音。请用微信内置浏览器或最新版 Chrome/Safari 打开');
        return;
      }
      const isSecure = window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (!isSecure) {
        setError('录音需要 HTTPS。请通过 https:// 地址访问本页面');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (unmountedRef.current || generation.current !== id) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
        // Lower bitrate = smaller upload payload for faster ASR
        audioBitsPerSecond: 24000,
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.start(250);
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setDuration(0);

      intervalRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 200);

      startLevelMonitoring(stream);
    } catch (err) {
      discardRecording();
      if (unmountedRef.current) return;
      console.error('Recording error:', err);
      const name = (err as DOMException)?.name || '';
      const msg = (err as Error)?.message || '';

      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || /denied|not allowed/i.test(msg)) {
        setError(isAndroid() ? '麦克风权限被拒绝，请在系统设置 → 应用 → 知音 → 权限中允许麦克风' : '麦克风权限被拒绝。请在浏览器设置→网站权限中允许本站使用麦克风后刷新页面');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('未检测到麦克风设备');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setError('麦克风被其他应用占用，请关闭后重试');
      } else if (name === 'SecurityError' || /secure|https/i.test(msg)) {
        setError('录音需要 HTTPS 安全上下文。请通过 https:// 地址访问');
      } else if (name === 'AbortError') {
        setError('录音被中断，请重试');
      } else {
        setError(`无法访问麦克风：${msg || '未知错误'}`);
      }
    } finally { starting.current = false; }
  }, [startLevelMonitoring, discardRecording]);
  const convertToWav = useCallback(async (webmBlob: Blob): Promise<Blob> => {
    const audioContext = new AudioContext();
    try {
      const audioBuffer = await audioContext.decodeAudioData(await webmBlob.arrayBuffer());
      const sampleRate = audioBuffer.sampleRate;
      const samples = audioBuffer.getChannelData(0);
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);
      const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
      };
      writeString(0, 'RIFF');
      view.setUint32(4, 36 + samples.length * 2, true);
      writeString(8, 'WAVE'); writeString(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      writeString(36, 'data'); view.setUint32(40, samples.length * 2, true);
      for (let i = 0; i < samples.length; i++) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7FFF, true);
      }
      return new Blob([buffer], { type: 'audio/wav' });
    } finally { await audioContext.close(); }
  }, []);

  const stopRecording = useCallback(async (options?: StopRecordingOptions): Promise<RecordingResult | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive' || pendingStop.current) { resolve(null); return; }
      pendingStop.current = resolve;
      const id = generation.current;
      recorder.onstop = async () => {
        const finalDuration = (Date.now() - startTimeRef.current) / 1000;
        const webmBlob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        mediaRecorderRef.current = null;
        chunksRef.current = [];
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        stopLevelMonitoring();
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (unmountedRef.current || generation.current !== id) { resolve(null); pendingStop.current = null; return; }
        setIsRecording(false);
        setDuration(0);
        if (finalDuration < 0.3) {
          setError('录音时间太短，请重试');
          resolve(null);
        } else {
          let wavBlob: Blob | null = null;
          if (options?.includeWav ?? true) {
            try { wavBlob = await convertToWav(webmBlob); }
            catch { setError('无法转换录音，请重新录制'); }
          }
          if (unmountedRef.current || generation.current !== id) resolve(null);
          else resolve({ webmBlob, wavBlob, blob: wavBlob ?? webmBlob, duration: finalDuration });
        }
        pendingStop.current = null;
      };
      recorder.stop();
    });
  }, [stopLevelMonitoring, convertToWav]);

  return { isRecording, duration, startRecording, stopRecording, error, audioLevel };
}
