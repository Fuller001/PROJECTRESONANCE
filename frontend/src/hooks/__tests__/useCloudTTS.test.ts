/** Regression checks for cancelled Android playback and audio URL ownership. */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloudTTS } from '../useCloudTTS';

const mocks = vi.hoisted(() => ({ speak: vi.fn(), stepSpeak: vi.fn(), pause: null as (() => void) | null, resume: null as (() => void) | null }));
vi.mock('@/lib/api', () => ({ api: { tts: { speak: mocks.speak } } }));
vi.mock('@/lib/stepPlan', () => ({ speakStepPlan: mocks.stepSpeak }));
vi.mock('@/lib/r2t2', () => ({ isAndroid: () => true }));
vi.mock('@capacitor/app', () => ({ App: { addListener: (event: string, listener: () => void) => {
  if (event === 'pause') mocks.pause = listener;
  if (event === 'resume') mocks.resume = listener;
  return Promise.resolve({ remove: vi.fn() });
} } }));

interface FakeAudio {
  src: string;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  volume: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}
const audios: FakeAudio[] = [];
const revoke = vi.fn();
const create = vi.fn();
beforeEach(() => {
  audios.length = 0;
  revoke.mockClear();
  create.mockReset().mockReturnValue('blob:audio');
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
  vi.stubGlobal('Audio', vi.fn().mockImplementation((src: string) => {
    const audio: FakeAudio = { src, volume: 1, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), onended: null, onerror: null };
    audios.push(audio);
    return audio;
  }));
  mocks.speak.mockReset().mockResolvedValue(new Blob(['audio'], { type: 'audio/mpeg' }));
  mocks.stepSpeak.mockReset().mockResolvedValue(new Blob(['audio'], { type: 'audio/mpeg' }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('cloud TTS lifecycle', () => {
  it('stops playback and releases its object URL on pause', async () => {
    const { result } = renderHook(() => useCloudTTS());
    await act(async () => result.current.speak('你好'));
    expect(result.current.isSpeaking).toBe(true);
    act(() => mocks.pause?.());
    expect(audios[0].pause).toHaveBeenCalled();
    expect(audios[0].src).toBe('');
    expect(revoke).toHaveBeenCalledWith('blob:audio');
    expect(result.current.isSpeaking).toBe(false);
  });
  it('ignores an old failed request while the next request plays', async () => {
    let fail!: (reason: Error) => void;
    mocks.speak.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const { result } = renderHook(() => useCloudTTS());
    let first!: Promise<void>;
    act(() => { first = result.current.speak('第一句'); });
    await act(async () => result.current.speak('第二句'));
    await act(async () => { fail(new Error('旧请求失败')); await first; });
    expect(result.current.isSpeaking).toBe(true);
    expect(result.current.error).toBeNull();
    expect(audios).toHaveLength(1);
  });
  it('never plays a response arriving after stop or unmount', async () => {
    let finish!: (blob: Blob) => void;
    mocks.speak.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result, unmount } = renderHook(() => useCloudTTS());
    let request!: Promise<void>;
    act(() => { request = result.current.speak('你好'); });
    unmount();
    await act(async () => { finish(new Blob(['late'])); await request; });
    expect(create).not.toHaveBeenCalled();
    expect(audios).toHaveLength(0);
  });
  it('releases audio on playback failure and reports the error', async () => {
    const { result } = renderHook(() => useCloudTTS());
    await act(async () => result.current.speak('你好'));
    act(() => audios[0].onerror?.());
    expect(revoke).toHaveBeenCalledWith('blob:audio');
    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.error).toBe('音频播放失败');
  });
  it('passes the selected voice and speed and supports muted playback', async () => {
    const { result } = renderHook(() => useCloudTTS({ voice: 'echo', speed: 0.8, volume: 0 }));
    await act(async () => result.current.speak('你好', { voice: 'nova' }));
    expect(mocks.speak).toHaveBeenCalledWith(expect.objectContaining({ voice: 'nova', speed: 0.8, volume: 1 }), expect.any(AbortSignal));
    expect(audios[0].volume).toBe(0);
    expect(result.current.isSpeaking).toBe(true);
    act(() => audios[0].onended?.());
    expect(result.current.isSpeaking).toBe(false);
    expect(revoke).toHaveBeenCalledWith('blob:audio');
  });
  it('uses Step Plan voice overrides and local mute, then stops when the service changes', async () => {
    const { result, rerender } = renderHook(({ service }: { service: 'step-plan' | 'worker' }) =>
      useCloudTTS({ service, voice: 'qinqienvsheng', speed: 0.8, volume: 0 }),
    { initialProps: { service: 'step-plan' as 'step-plan' | 'worker' } });
    await act(async () => result.current.speak('你好', { voice: 'wenrounvsheng' }));
    expect(mocks.stepSpeak).toHaveBeenCalledWith({ text: '你好', voice: 'wenrounvsheng', speed: 0.8 }, expect.any(AbortSignal));
    expect(mocks.speak).not.toHaveBeenCalled();
    expect(audios[0].volume).toBe(0);
    rerender({ service: 'worker' });
    expect(audios[0].pause).toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(false);
    expect(revoke).toHaveBeenCalledWith('blob:audio');
  });
  it('aborts Step Plan on background and never plays a late result after resuming', async () => {
    let finish!: (blob: Blob) => void;
    mocks.stepSpeak.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useCloudTTS({ service: 'step-plan' }));
    let request!: Promise<void>;
    act(() => { request = result.current.speak('你好'); });
    const signal = mocks.stepSpeak.mock.calls[0][1] as AbortSignal;
    act(() => mocks.pause?.());
    expect(signal.aborted).toBe(true);
    expect(result.current.isSpeaking).toBe(false);
    act(() => mocks.resume?.());
    await act(async () => { finish(new Blob(['late'])); await request; });
    expect(create).not.toHaveBeenCalled();
    expect(audios).toHaveLength(0);
  });
});
