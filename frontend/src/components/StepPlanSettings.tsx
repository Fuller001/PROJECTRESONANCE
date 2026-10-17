/** User-controlled Step Plan credentials: status only, password input, encrypted native storage. */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clearStepPlanKey, getStepPlanStatus, saveStepPlanKey } from '@/lib/stepPlan';
import { STEP_PLAN_BASE_URL, STEP_PLAN_MODEL, type SpeechService } from '@/lib/speechService';
import { isAndroid } from '@/lib/r2t2';

interface StepPlanSettingsProps {
  service: SpeechService;
  onServiceChange: (service: SpeechService) => void;
  onStop: () => void;
}

/** Edits credentials without reading them back or persisting them in exported application settings. */
export default function StepPlanSettings({ service, onServiceChange, onStop }: StepPlanSettingsProps) {
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    getStepPlanStatus().then((state) => {
      if (alive.current) setConfigured(state.configured);
    }).catch(() => {
      if (alive.current) setError('无法读取密钥状态，请重新保存 API Key');
    }).finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; };
  }, []);

  const changeKey = async (remove: boolean) => {
    onStop();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const state = remove ? await clearStepPlanKey() : await saveStepPlanKey(key);
      if (!alive.current) return;
      setConfigured(state.configured);
      setKey('');
      setMessage(remove ? 'API Key 已移除' : 'API Key 已保存，可以选择音色试听');
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : '密钥操作失败，请重试');
    } finally { if (alive.current) setLoading(false); }
  };

  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-border bg-background/50 p-3">
      <label className="block text-sm font-medium" htmlFor="speech-service">朗读服务</label>
      <select id="speech-service" value={service} disabled={loading}
        className="min-h-12 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base"
        onChange={(event) => { onStop(); setKey(''); onServiceChange(event.target.value as SpeechService); }}>
        <option value="step-plan">Step Plan · 阶跃星辰</option>
        <option value="worker">原云端服务</option>
      </select>
      {service === 'step-plan' && <>
        <p className="text-sm text-muted-foreground">使用 Step Plan 套餐 Credit，保存完整 Key 后即可试听，无需登录原云端服务。</p>
        <p className="text-sm font-medium" role="status">{loading ? '正在读取或保存密钥…' : configured ? 'API Key 已配置' : '尚未配置 API Key'}</p>
        <label className="block text-sm font-medium" htmlFor="step-plan-api-key">Step Plan API Key</label>
        <Input id="step-plan-api-key" type="password" value={key} disabled={loading}
          placeholder={configured ? '输入新的完整 Key 以替换' : '粘贴完整 API Key'}
          autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          className="min-h-12 min-w-0 text-base" aria-describedby="step-plan-key-help"
          onChange={(event) => setKey(event.target.value)} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" className="a11y-target min-w-0 flex-1" disabled={loading || !key.trim()}
            onClick={() => void changeKey(false)}>{configured ? '替换 API Key' : '保存 API Key'}</Button>
          <Button type="button" variant="outline" className="a11y-target min-w-0 flex-1" disabled={loading || !configured}
            onClick={() => void changeKey(true)}>移除 API Key</Button>
        </div>
        <p id="step-plan-key-help" className="text-xs leading-relaxed text-muted-foreground">
          {isAndroid() ? '密钥在本机加密保存，不会随词表导出。保存后不会回显完整 Key。' : '网页仅在当前会话内存中保存 Key，刷新后需重新填写。'}
        </p>
        <details className="min-w-0 rounded-lg border border-border p-2">
          <summary className="a11y-target cursor-pointer text-sm">连接信息</summary>
          <dl className="mt-2 space-y-2 text-xs text-muted-foreground">
            <div><dt>Base URL</dt><dd className="break-all">{STEP_PLAN_BASE_URL}</dd></div>
            <div><dt>模型</dt><dd className="break-all">{STEP_PLAN_MODEL}</dd></div>
          </dl>
        </details>
      </>}
      {message && <p className="break-words text-sm text-primary" role="status">{message}</p>}
      {error && <p className="break-words text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
