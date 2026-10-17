/** Routes share the selected cloud voice and live speech settings. */
import { Routes, Route } from 'react-router-dom';
import { usePhrases } from '@/hooks/usePhrases';
import { useSettings } from '@/hooks/useSettings';
import { useCloudTTS } from '@/hooks/useCloudTTS';
import { useSpeechService } from '@/hooks/useSpeechService';
import { lazy, Suspense } from 'react';
import { DelayedSkeleton } from '@/components/DelayedSkeleton';
import { AuthGate } from '@/components/AuthGate';
import { OnboardingGate } from '@/components/OnboardingGate';
import { VoiceProvider, useVoice } from '@/components/VoiceProvider';
import UsagePage from './pages/UsagePage';
const TrainingPage = lazy(() => import('./pages/TrainingPage'));
const PhrasesPage = lazy(() => import('./pages/PhrasesPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotFound = lazy(() => import('./pages/NotFound'));

/** Inner content that needs voice state from VoiceProvider context. */
function AppRoutesContent() {
  const { selectedVoice, setSelectedVoice } = useVoice();
  const { settings, setSettings } = useSettings();
  const { service, setService } = useSpeechService();
  const cloud = useCloudTTS({ service, voice: selectedVoice, speed: settings.ttsRate, volume: settings.ttsVolume });
  return (
    <Suspense fallback={<DelayedSkeleton variant="page" />}>

        <Routes>
          <Route
            path="/"
            element={
              <UsagePage
                onSpeak={cloud.speak}
                onStop={cloud.stop}
                isSpeaking={cloud.isSpeaking}
                selectedVoice={selectedVoice}
                onVoiceChange={setSelectedVoice}
                ttsError={cloud.error}
              />
            }
          />
          <Route path="/training" element={<TrainingPage />} />
          <Route path="/phrases" element={<PhrasesPage />} />
          <Route
            path="/settings"
            element={<SettingsPage settings={settings} onUpdate={setSettings}
              speechService={service} onSpeechServiceChange={setService}
              selectedVoice={selectedVoice} onVoiceChange={setSelectedVoice}
              onTestVoice={(text, voice) => cloud.speak(text, { voice })}
              onStopVoice={cloud.stop} isTestSpeaking={cloud.isSpeaking} ttsError={cloud.error} />}
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
    </Suspense>
  );
}

export default function AppRoutes() {
  const { isLoaded } = usePhrases();

  return (
    <OnboardingGate isDataLoaded={isLoaded}>
      <AuthGate>
        <VoiceProvider>
          <AppRoutesContent />
        </VoiceProvider>
      </AuthGate>
    </OnboardingGate>
  );
}