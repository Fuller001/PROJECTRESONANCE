/** Mobile settings for cloud speech, local models and accessibility. */
import { useState } from 'react';
import { AppSettings, DEFAULT_SETTINGS } from '@/types';
import AccessibilitySettings from '@/components/AccessibilitySettings';
import AccessibleStepper from '@/components/AccessibleStepper';
import ASREngineCard from '@/components/ASREngineCard';
import DiagnosticsPanel from '@/components/DiagnosticsPanel';
import VoiceSelector from '@/components/VoiceSelector';
import StepPlanSettings from '@/components/StepPlanSettings';
import type { SpeechService } from '@/lib/speechService';
import { ChevronRight, Volume2, RotateCcw } from 'lucide-react';

interface SettingsPageProps {
  speechService: SpeechService;
  onSpeechServiceChange: (service: SpeechService) => void;
  settings: AppSettings;
  onUpdate: (settings: AppSettings) => void;
  selectedVoice: string;
  onVoiceChange: (voice: string) => void;
  onTestVoice: (text: string, voice: string) => Promise<void>;
  onStopVoice: () => void;
  isTestSpeaking: boolean;
  ttsError: string | null;
}

/**
 * Settings page — restructured into:
 *   1. Basic settings (always visible): ASR engine, TTS voice, Accessibility
 *   2. Advanced settings (collapsed by default): Privacy/Diagnostics
 *   3. Reset (footer)
 */
export default function SettingsPage({ settings, onUpdate, selectedVoice, onVoiceChange,
  onTestVoice, onStopVoice, isTestSpeaking, ttsError, speechService, onSpeechServiceChange }: SettingsPageProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const update = (key: keyof AppSettings, value: number | string) => {
    onUpdate({ ...settings, [key]: value });
  };

  return (
    <section className="max-w-2xl mx-auto space-y-5" aria-labelledby="settings-heading">
      {/* Page header */}
      <header>
        <h2
          id="settings-heading"
          className="text-2xl md:text-3xl font-extrabold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent"
        >
          设置
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">基础设置即开即用，进阶选项已折叠</p>
      </header>

      {/* ============ BASIC SETTINGS ============ */}
      <div className="space-y-5">
        {/* 1. ASR engine — large visual card */}
        <ASREngineCard />

        {/* 2. TTS voice */}
        <div className="rounded-2xl border border-border bg-card p-5 md:p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent/15 to-primary/15">
              <Volume2 className="h-5 w-5 text-accent" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-base">朗读声音</h3>
              <p className="text-xs text-muted-foreground">调整文字朗读的语速、音量与音色</p>
            </div>
          </div>

          <StepPlanSettings service={speechService} onServiceChange={onSpeechServiceChange} onStop={onStopVoice} />
          {speechService === 'worker' && <p className="text-sm leading-relaxed text-muted-foreground">原云端朗读需要联网及登录。选择音色后，可以直接试听。</p>}
          <VoiceSelector service={speechService} selectedVoice={selectedVoice} onVoiceChange={onVoiceChange}
            onTestVoice={onTestVoice} onStopVoice={onStopVoice} isTestSpeaking={isTestSpeaking} />
          {ttsError && <p className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{ttsError}</p>}
          <div className="space-y-4">
            <AccessibleStepper
              label="语速"
              value={settings.ttsRate}
              min={0.5}
              max={2}
              step={0.1}
              onChange={(v) => update('ttsRate', v)}
              format={(v) => `${v.toFixed(1)}x`}
              id="ttsRate"
            />
            <AccessibleStepper
              label="音量"
              value={settings.ttsVolume}
              min={0}
              max={1}
              step={0.1}
              onChange={(v) => update('ttsVolume', v)}
              format={(v) => `${Math.round(v * 100)}%`}
              id="ttsVolume"
            />

          </div>
        </div>

        {/* 3. Accessibility */}
        <AccessibilitySettings />
      </div>

      {/* ============ ADVANCED ============ */}
      <details
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
        className="group rounded-2xl border border-border bg-card overflow-hidden"
      >
        <summary className="a11y-target flex items-center justify-between cursor-pointer px-5 py-4 hover:bg-muted/30 transition-colors list-none">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden="true" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">高级设置</div>
              <div className="text-xs text-muted-foreground">隐私与诊断日志</div>
            </div>
          </div>
        </summary>

        <div className="border-t border-border p-5 space-y-5">

          {/* Privacy + diagnostics */}
          <DiagnosticsPanel />
        </div>
      </details>

      {/* ============ FOOTER ============ */}
      <button
        onClick={() => onUpdate(DEFAULT_SETTINGS)}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-sm font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/5 transition-colors a11y-target"
        aria-label="恢复默认设置"
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        恢复默认设置
      </button>
    </section>
  );
}
