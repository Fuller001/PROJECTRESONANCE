/** Typed Android bridge for verified R2T2 models and bounded, on-device ASR. */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export const isAndroid = () => Capacitor.getPlatform() === 'android';

export interface R2T2Status {
  supported: boolean;
  installed: boolean;
  loaded: boolean;
  busy: boolean;
  backendMode: 'auto' | 'baseline';
  activeBackend?: string | null;
  phase: 'verifying' | 'installing' | 'missing' | 'installed' | 'downloading' | 'loading' | 'processing' | 'ready' | 'error';
  error?: string | null;
  downloadedBytes: number;
  totalBytes: number;
  totalMemoryBytes: number;
  availableMemoryBytes: number;
}

interface R2T2Plugin {
  getStatus(): Promise<R2T2Status>;
  downloadModels(): Promise<void>;
  loadModel(): Promise<void>;
  setBackendMode(options: { mode: 'auto' | 'baseline' }): Promise<R2T2Status>;
  releaseModel(): Promise<R2T2Status>;
  transcribe(options: { pcmBase64: string; sampleRate: 16000 }): Promise<{
    text: string; elapsedMs: number; audioDurationMs: number; backend?: string;
  }>;
  cancel(): Promise<void>;
  requestMicrophone(): Promise<void>;
  addListener(event: 'statusChanged', listener: (status: R2T2Status) => void): Promise<PluginListenerHandle>;
}

export const R2T2 = registerPlugin<R2T2Plugin>('R2T2');

/** Removes Qwen ASR protocol fields while preserving the recognized text. */
export function cleanR2T2Transcript(raw: string): string {
  const marker = raw.lastIndexOf('<asr_text>');
  const text = marker >= 0 ? raw.slice(marker + '<asr_text>'.length) : raw;
  return text.replace(/<\|[^>]*\|>/g, '').replace(/<asr_(?:text|end)>/g, '').trim();
}

/** Serializes bytes without spreading a multi-megabyte array onto the JS stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return btoa(parts.join(''));
}

/** Decodes a recording, mixes all channels and resamples to 16 kHz float32 LE. Always closes the decoder. */
export async function recordingToPCM(blob: Blob): Promise<string> {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const duration = audio.length / audio.sampleRate;
    if (!Number.isFinite(duration) || duration < 0.3 || duration > 30) {
      throw new Error('本地识别支持 0.3 到 30 秒的录音，请缩短后重试');
    }
    const length = Math.round(duration * 16000);
    const renderer = new OfflineAudioContext(1, length, 16000);
    const mono = renderer.createBuffer(1, audio.length, audio.sampleRate);
    const mixed = mono.getChannelData(0);
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      const input = audio.getChannelData(channel);
      for (let i = 0; i < input.length; i++) mixed[i] += input[i] / audio.numberOfChannels;
    }
    const source = renderer.createBufferSource();
    source.buffer = mono;
    source.connect(renderer.destination);
    source.start();
    const rendered = await renderer.startRendering();
    const samples = rendered.getChannelData(0);
    const bytes = new Uint8Array(samples.length * 4);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < samples.length; i++) {
      if (!Number.isFinite(samples[i])) throw new Error('录音数据无效，请重新录音');
      view.setFloat32(i * 4, Math.max(-1, Math.min(1, samples[i])), true);
    }
    return bytesToBase64(bytes);
  } finally {
    await context.close();
  }
}
