/** Local inference never sends cloud traffic; reset invalidates decoding and native results. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLocalASR } from '../useLocalASR';
const mocks = vi.hoisted(() => ({ pcm: vi.fn(), transcribe: vi.fn(), cancel: vi.fn(), pause: null as (() => void) | null }));
vi.mock('@/lib/r2t2', () => ({
  isAndroid: () => true, recordingToPCM: mocks.pcm,
  cleanR2T2Transcript: (text: string) => text.replace('<|im_end|>', '').trim(),
  R2T2: { transcribe: mocks.transcribe, cancel: mocks.cancel },
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: (_event: string, listener: () => void) => {
  mocks.pause = listener; return Promise.resolve({ remove: vi.fn() });
} } }));
beforeEach(() => { mocks.pcm.mockReset().mockResolvedValue('AQID'); mocks.transcribe.mockReset(); mocks.cancel.mockReset().mockResolvedValue(undefined); });

describe('local ASR', () => {
  it('recognizes using the native plugin when offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    mocks.transcribe.mockResolvedValue({ text: '你好<|im_end|>', elapsedMs: 20 });
    const { result } = renderHook(() => useLocalASR());
    await act(async () => { expect(await result.current.transcribe(new Blob(['audio']))).toBe('你好'); });
    expect(result.current.finalText).toBe('你好');
    expect(mocks.transcribe).toHaveBeenCalledWith({ pcmBase64: 'AQID', sampleRate: 16000 });
  });
  it('does not enter native inference after cancellation during audio conversion', async () => {
    let finish: (value: string) => void;
    mocks.pcm.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useLocalASR());
    let promise: Promise<string | null>;
    act(() => { promise = result.current.transcribe(new Blob(['audio'])); });
    act(() => result.current.reset());
    await act(async () => { finish('AQID'); await promise; });
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(result.current.finalText).toBe('');
  });
  it('cancels on pause and ignores a native result arriving later', async () => {
    let finish: (value: { text: string }) => void;
    mocks.transcribe.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useLocalASR());
    let promise: Promise<string | null>;
    await act(async () => { promise = result.current.transcribe(new Blob(['audio'])); });
    act(() => mocks.pause?.());
    await act(async () => { finish({ text: '旧结果' }); await promise; });
    expect(mocks.cancel).toHaveBeenCalled();
    expect(result.current.finalText).toBe('');
    expect(result.current.isProcessing).toBe(false);
  });
  it('reports missing models without falling back to the cloud', async () => {
    mocks.transcribe.mockRejectedValue(new Error('请在设置中下载模型'));
    const { result } = renderHook(() => useLocalASR());
    await act(async () => { await result.current.transcribe(new Blob(['audio'])); });
    expect(result.current.error?.userAction).toBe('请在设置中下载模型');
    expect(result.current.error?.fallbackActive).toBe(false);
  });
});
