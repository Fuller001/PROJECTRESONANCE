/** Direct Step Plan/settings access, plus legacy cloud authentication and Android offline entry. */
import { Suspense, lazy } from 'react';
import { useDeviceId } from '@/hooks/useDeviceId';
import { useAuth } from '@/hooks/useAuth';
import { useASREnginePreference } from '@/hooks/useASREnginePreference';
import { isAndroid } from '@/lib/r2t2';
import { DelayedSkeleton } from '@/components/DelayedSkeleton';
import { useLocation } from 'react-router-dom';
import { useSpeechService } from '@/hooks/useSpeechService';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
interface AuthGateProps { children: React.ReactNode }

export function AuthGate({ children }: AuthGateProps) {
  const { preference, setPreference } = useASREnginePreference();
  const { pathname } = useLocation();
  const { service } = useSpeechService();
  if (service === 'step-plan') return <>{children}</>;
  if (pathname === '/settings') return <>{children}</>;
  if (isAndroid() && preference === 'local') return <>{children}</>;
  return (
    <>
      {isAndroid() && (
        <div className="max-w-lg mx-auto mb-4 rounded-xl border border-border p-4 space-y-2">
          <p className="text-sm text-muted-foreground">本地语音识别可离线使用，无需登录。首次使用需下载模型。</p>
          <button className="a11y-target rounded-lg bg-primary px-4 py-3 text-primary-foreground font-medium"
            onClick={() => setPreference('local')}>使用本地识别</button>
        </div>
      )}
      <CloudAuthGate>{children}</CloudAuthGate>
    </>
  );
}

function CloudAuthGate({ children }: AuthGateProps) {
  const { deviceId, isLoading: deviceLoading } = useDeviceId();
  const auth = useAuth(deviceId);
  if (auth.status === 'loading' || deviceLoading) return <DelayedSkeleton variant="page" />;
  if (auth.status === 'guest') return (
    <Suspense fallback={<DelayedSkeleton variant="page" />}>
      <LoginPage onBindPhone={auth.bindPhone} />
    </Suspense>
  );
  return <>{children}</>;
}