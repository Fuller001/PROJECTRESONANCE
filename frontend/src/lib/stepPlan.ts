/** Step Plan speech transport. Android keeps credentials native; browsers use session memory only. */
import { registerPlugin } from '@capacitor/core';
import { isAndroid } from './r2t2';
import { STEP_PLAN_BASE_URL, STEP_PLAN_DEFAULT_VOICE, STEP_PLAN_MODEL } from './speechService';

export interface StepPlanStatus { configured: boolean }
export interface StepPlanSpeech { text: string; voice?: string; speed?: number }
interface NativeAudio { audioBase64: string; contentType: string }
interface StepPlanBridge {
  getStatus(): Promise<StepPlanStatus>;
  saveKey(options: { apiKey: string }): Promise<StepPlanStatus>;
  clearKey(): Promise<StepPlanStatus>;
  speak(options: Required<StepPlanSpeech> & { requestId: string }): Promise<NativeAudio>;
  cancel(options: { requestId: string }): Promise<void>;
}
const native = registerPlugin<StepPlanBridge>('StepPlan');
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
let browserKey = '';
let requestSequence = 0;

function abortError(): DOMException { return new DOMException('朗读已停止', 'AbortError'); }

/** Rejects masked keys and header injection without ever echoing the value. */
export function validateStepPlanKey(value: string): string {
  const key = value.trim();
  if (key.length < 8 || key.length > 512 || key.includes('...') || key.includes('*')) {
    throw new Error('请输入完整 API Key，不能使用带省略号的脱敏密钥');
  }
  if (!/^[\x21-\x7e]+$/.test(key)) throw new Error('API Key 不能包含空格、换行或中文字符');
  return key;
}

/** Returns only credential presence. The saved Android key is never readable by JavaScript. */
export async function getStepPlanStatus(): Promise<StepPlanStatus> {
  return isAndroid() ? native.getStatus() : { configured: !!browserKey };
}

/** Saves a full credential encrypted on Android, or in volatile memory on the web. */
export async function saveStepPlanKey(value: string): Promise<StepPlanStatus> {
  const key = validateStepPlanKey(value);
  if (isAndroid()) return native.saveKey({ apiKey: key });
  browserKey = key;
  return { configured: true };
}

/** Removes the saved credential. Callers stop current playback before invoking this. */
export async function clearStepPlanKey(): Promise<StepPlanStatus> {
  if (isAndroid()) return native.clearKey();
  browserKey = '';
  return { configured: false };
}

function httpError(status: number): Error {
  if (status === 401) return new Error('Step Plan API Key 无效或已过期，请在设置中重新填写');
  if (status === 403) return new Error('当前 API Key 无权使用 Step Plan 语音服务，请检查套餐和模型权限');
  if (status === 429) return new Error('Step Plan 额度不足或请求过于频繁，请检查套餐后重试');
  if (status === 404 || status === 405) return new Error(`Step Plan 语音接口暂不可用（HTTP ${status}），请检查套餐是否支持语音合成`);
  return new Error(`Step Plan 朗读请求失败（HTTP ${status}），请稍后重试`);
}

function audioBlob(audio: NativeAudio): Blob {
  if (!audio.contentType?.toLowerCase().startsWith('audio/')) {
    throw new Error('Step Plan 未返回音频，请检查套餐和模型配置');
  }
  if (!audio.audioBase64 || audio.audioBase64.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4) {
    throw new Error('Step Plan 返回的音频为空或过大，请缩短文字后重试');
  }
  const binary = atob(audio.audioBase64);
  if (binary.length > MAX_AUDIO_BYTES) throw new Error('音频文件过大，请缩短朗读文字');
  return new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], { type: audio.contentType });
}

async function nativeSpeech(payload: Required<StepPlanSpeech>, signal?: AbortSignal): Promise<Blob> {
  const requestId = `tts_${Date.now().toString(36)}_${++requestSequence}`;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      void native.cancel({ requestId }).catch(() => { /* native lifecycle cancellation is also active */ });
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { signal.removeEventListener('abort', onAbort); reject(abortError()); return; }
    native.speak({ ...payload, requestId }).then((audio) => {
      if (signal?.aborted) { reject(abortError()); return; }
      try { resolve(audioBlob(audio)); } catch (error) { reject(error); }
    }, (error: unknown) => {
      if (signal?.aborted || (error as { code?: string })?.code === 'ABORTED') reject(abortError());
      else reject(error);
    }).finally(() => signal?.removeEventListener('abort', onAbort));
  });
}

/** Synthesizes a single utterance using the documented Step Plan audio/speech contract, with no retries. */
export async function speakStepPlan(options: StepPlanSpeech, signal?: AbortSignal): Promise<Blob> {
  if (signal?.aborted) throw abortError();
  const text = options.text.trim();
  const voice = options.voice ?? STEP_PLAN_DEFAULT_VOICE;
  const speed = options.speed ?? 1;
  if (!text || Array.from(text).length > 1000) throw new Error('单次朗读请输入 1 到 1000 个字符');
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(voice)) throw new Error('音色 ID 无效，请重新选择音色');
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error('语速应在 0.5 到 2.0 之间');
  if (isAndroid()) return nativeSpeech({ text, voice, speed }, signal);
  if (!browserKey) throw new Error('请先在设置中填写并保存完整的 Step Plan API Key');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 75000);
  try {
    const response = await fetch(`${STEP_PLAN_BASE_URL}/audio/speech`, {
      method: 'POST', credentials: 'omit', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${browserKey}`, Accept: 'audio/mpeg' },
      body: JSON.stringify({ model: STEP_PLAN_MODEL, input: text, voice, speed, volume: 1, response_format: 'mp3' }),
    });
    if (!response.ok) throw httpError(response.status);
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('audio/')) {
      throw new Error('Step Plan 未返回音频，请检查套餐和模型配置');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Step Plan 未返回音频，请稍后重试');
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_AUDIO_BYTES) { await reader.cancel(); throw new Error('音频文件过大，请缩短朗读文字'); }
        parts.push(new Uint8Array(value));
      }
    } finally { reader.releaseLock(); }
    if (signal?.aborted) throw abortError();
    if (!size) throw new Error('Step Plan 未返回音频，请稍后重试');
    return new Blob(parts, { type: response.headers.get('content-type')! });
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new Error('Step Plan 连接超时，请检查网络后重试');
    if (error instanceof TypeError) throw new Error('无法连接 Step Plan，请检查网络；网页端可能受跨域限制，请使用 Android 应用');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}
