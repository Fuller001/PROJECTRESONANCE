/** Android model setup with progress, cancellation and explicit memory release. */
import { useCallback, useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { R2T2, type R2T2Status } from '@/lib/r2t2';
import { Button } from '@/components/ui/button';

const PHASES: Record<R2T2Status['phase'], string> = {
  verifying: '正在校验模型', installing: '正在准备内置模型', missing: '尚未安装模型', installed: '模型已校验，识别时自动加载',
  downloading: '正在下载模型', loading: '正在加载模型', processing: '正在本地识别',
  ready: '本地引擎已就绪', error: '操作未完成',
};
const gigabytes = (bytes: number) => (bytes / 1e9).toFixed(2);

export default function R2T2ModelCard() {
  const [status, setStatus] = useState<R2T2Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setStatus(await R2T2.getStatus()); } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取模型状态');
    }
  }, []);
  useEffect(() => {
    let disposed = false;
    const handles: PluginListenerHandle[] = [];
    const retain = (handle: PluginListenerHandle) => {
      if (disposed) void handle.remove(); else handles.push(handle);
    };
    void R2T2.addListener('statusChanged', (next) => { if (!disposed) setStatus(next); })
      .then(retain).then(() => { if (!disposed) void refresh(); })
      .catch(() => { if (!disposed) setError('本地插件不可用，请重新安装应用'); });
    void App.addListener('resume', refresh).then(retain);
    return () => { disposed = true; handles.forEach((handle) => { void handle.remove(); }); };
  }, [refresh]);

  const run = async (operation: () => Promise<unknown>) => {
    setError(null);
    try { await operation(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试');
    } finally { await refresh(); }
  };
  const busy = !status || status.busy;
  const progress = status ? Math.min(100, Math.round(status.downloadedBytes / status.totalBytes * 100)) : 0;
  return (
    <div className="rounded-xl border border-border p-4 space-y-3" aria-label="本地模型管理">
      <h4 className="font-semibold">Confucius4-R2T2 本地模型</h4>
      <p className="text-sm leading-relaxed text-muted-foreground">离线识别，录音与文字保留在手机。单次最长 30 秒。</p>
      {!status?.installed && <p className="text-sm leading-relaxed text-muted-foreground">APK 已内置约 1.46 GB 模型，首次启动会自动准备，不需要网络。请保持应用在前台；中断后可重试。</p>}
      <p className="text-xs text-muted-foreground">下载即表示您接受 <a className="underline" href="/licenses/R2T2-MODEL-LICENSE-zh.txt" target="_blank" rel="noreferrer">网易有道模型使用许可</a>。运行时与模型许可见 <a className="underline" href="/licenses/NOTICE.txt" target="_blank" rel="noreferrer">第三方声明</a>。</p>
      <p role="status" aria-live="polite">{status ? PHASES[status.phase] : '正在读取状态…'}</p>
      {status && !status.supported && <p role="alert">本地模型需要 ARM64 Android 设备。</p>}
      {status && (status.phase === 'downloading' || status.phase === 'verifying' || status.phase === 'installing') && <>
        <progress className="w-full h-3" max={100} value={progress} aria-label="模型准备进度" />
        <p className="text-xs text-muted-foreground">{gigabytes(status.downloadedBytes)} / {gigabytes(status.totalBytes)} GB（{progress}%）</p>
      </>}
      <details className="rounded-lg border border-border">
        <summary className="min-h-12 cursor-pointer px-3 py-3 text-sm font-medium">性能与设备信息</summary>
        <div className="space-y-3 border-t border-border p-3">
      {status && <p className="text-xs text-muted-foreground">可用内存 {gigabytes(status.availableMemoryBytes)} GB / 总内存 {gigabytes(status.totalMemoryBytes)} GB</p>}
      {status && <div className="space-y-2">
        <label className="text-sm block" htmlFor="r2t2-cpu-mode">本地识别性能</label>
        <select id="r2t2-cpu-mode" className="w-full rounded-md border border-input bg-background min-h-12 p-3 text-sm"
          disabled={busy} value={status.backendMode}
          onChange={(event) => {
            const mode = event.target.value === 'baseline' ? 'baseline' : 'auto';
            void run(() => R2T2.setBackendMode({ mode }));
          }}>
          <option value="auto">自动优化（推荐）</option>
          <option value="baseline">基础 CPU（兼容模式）</option>
        </select>
        <p className="text-xs text-muted-foreground">自动优化会选择手机支持的 CPU 指令。切换后下次识别重新加载模型。</p>
        {status.activeBackend && <p className="text-xs text-muted-foreground">当前引擎：{status.activeBackend}</p>}
      </div>}
        </div>
      </details>
      {(error || status?.error) && <p className="text-sm text-destructive" role="alert">{error || status?.error}</p>}
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap [&>button]:min-h-12 [&>button]:whitespace-normal">
        {!status?.installed && <Button disabled={busy || !status?.supported} onClick={() => void run(() => R2T2.downloadModels())}>准备内置模型</Button>}
        {status?.installed && !status.loaded && <Button disabled={busy} onClick={() => void run(() => R2T2.loadModel())}>加载模型</Button>}
        {status?.loaded && <Button variant="outline" disabled={busy} onClick={() => void run(() => R2T2.releaseModel())}>释放模型内存</Button>}
        {status?.busy && <Button variant="outline" onClick={() => void run(() => R2T2.cancel())}>取消操作</Button>}
        <Button variant="ghost" disabled={busy} onClick={() => void refresh()}>刷新状态</Button>
      </div>
    </div>
  );
}
