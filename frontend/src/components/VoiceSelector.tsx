/** Touch-friendly cloud and cloned voice choices, with explicit preview identity. */
import { useId, useState } from 'react';
import { Check, Volume2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useUserVoices } from '@/hooks/useUserVoices';
import { STEP_PLAN_VOICES, type SpeechService } from '@/lib/speechService';

interface VoiceSelectorProps {
  service: SpeechService;
  selectedVoice: string;
  onVoiceChange: (voice: string) => void;
  onTestVoice: (text: string, voice: string) => Promise<void>;
  onStopVoice: () => void;
  isTestSpeaking: boolean;
  className?: string;
}

const SYSTEM_VOICES = [
  { id: 'alloy', label: '中性女声' },
  { id: 'echo', label: '温和男声' },
  { id: 'fable', label: '英式男声' },
  { id: 'onyx', label: '深沉男声' },
  { id: 'nova', label: '温柔女声' },
  { id: 'shimmer', label: '清晰女声' },
];

/** Native radio labels make the entire voice row selectable by touch or keyboard. */
export default function VoiceSelector({ service, selectedVoice, onVoiceChange, onTestVoice,
  onStopVoice, isTestSpeaking, className }: VoiceSelectorProps) {
  const [customVoiceId, setCustomVoiceId] = useState('');
  const { userVoices } = useUserVoices();
  const groupId = useId();
  const voices = service === 'step-plan'
    ? STEP_PLAN_VOICES.map((voice) => ({ ...voice, custom: false }))
    : [
      ...userVoices.map((voice) => ({ id: voice.voice_id, label: voice.label || voice.voice_id, custom: true })),
      ...SYSTEM_VOICES.filter((voice) => !userVoices.some((user) => user.voice_id === voice.id))
        .map((voice) => ({ ...voice, custom: false })),
    ];
  const customSelected = selectedVoice && !voices.some((voice) => voice.id === selectedVoice);

  const preview = async (voice: string) => {
    onVoiceChange(voice);
    await onTestVoice('你好，这是音色试听。愿每一句话，都能被听见。', voice);
  };

  return (
    <div className={cn('space-y-3', className)}>
      {isTestSpeaking && (
        <Button type="button" variant="outline" className="a11y-target w-full gap-2 border-primary/30 text-primary"
          onClick={onStopVoice}>
          <Square className="h-4 w-4" aria-hidden="true" />停止试听
        </Button>
      )}
      <fieldset className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <legend className="sr-only">选择朗读音色</legend>
        {voices.map((voice) => {
          const selected = selectedVoice === voice.id;
          return (
            <div key={voice.id} className={cn('flex min-w-0 items-center gap-1 rounded-xl border p-1',
              selected ? 'border-primary/50 bg-primary/5' : 'border-border bg-background/50')}>
              <label className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 focus-within:ring-2 focus-within:ring-ring">
                <input type="radio" name={groupId} value={voice.id} checked={selected}
                  onChange={() => onVoiceChange(voice.id)} className="sr-only" />
                <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                  selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')} aria-hidden="true">
                  {selected && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 break-words text-sm font-medium text-foreground">{voice.label}
                  {voice.custom && <span className="ml-1.5 text-xs text-primary">我的</span>}
                </span>
              </label>
              <Button type="button" variant="ghost" disabled={isTestSpeaking}
                aria-label={`试听 ${voice.label}`} onClick={() => void preview(voice.id)}
                className="a11y-target shrink-0 gap-1 rounded-lg px-2.5 text-xs">
                <Volume2 className="h-4 w-4" aria-hidden="true" />试听
              </Button>
            </div>
          );
        })}
      </fieldset>
      <details className="rounded-xl border border-border">
        <summary className="min-h-12 cursor-pointer px-3 py-3 text-sm font-medium">自定义音色</summary>
        <div className="space-y-3 border-t border-border p-3">
          <p className="text-xs leading-relaxed text-muted-foreground">已有克隆音色 ID 时，可在这里填写。</p>
          <div className="flex gap-2">
            <Input placeholder="输入音色 ID" value={customVoiceId} onChange={(e) => setCustomVoiceId(e.target.value)}
              aria-label="自定义音色 ID" className="min-h-12 min-w-0 flex-1 text-base"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customVoiceId.trim()) {
                  onVoiceChange(customVoiceId.trim()); setCustomVoiceId('');
                }
              }} />
            <Button type="button" variant="outline" className="a11y-target shrink-0" disabled={!customVoiceId.trim()}
              onClick={() => { onVoiceChange(customVoiceId.trim()); setCustomVoiceId(''); }}>使用</Button>
          </div>
          {customSelected && <p className="break-all text-xs text-muted-foreground">当前音色：{selectedVoice}</p>}
          {customSelected && <Button type="button" variant="outline" className="a11y-target w-full" disabled={isTestSpeaking}
            onClick={() => void preview(selectedVoice)}>试听自定义音色</Button>}
        </div>
      </details>
    </div>
  );
}
