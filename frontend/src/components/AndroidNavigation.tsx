/** Routes Android back gestures through React; the root moves the app to the background. */
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App } from '@capacitor/app';
import { isAndroid } from '@/lib/r2t2';

export default function AndroidNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isAndroid()) return;
    const handle = App.addListener('backButton', () => {
      if (location.pathname !== '/') navigate('/');
      else void App.minimizeApp();
    });
    return () => { void handle.then((listener) => listener.remove()); };
  }, [location.pathname, navigate]);
  return null;
}
