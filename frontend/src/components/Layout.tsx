/** Responsive app shell with safe-area navigation and touch-first page spacing. */
import { ReactNode, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Keyboard, Mic, Settings, BookOpen, MessageSquare } from 'lucide-react';
import SkipToContent from './SkipToContent';
import KeyboardShortcutsPanel from './KeyboardShortcutsPanel';
import BuildBadge from './BuildBadge';
import { useKeyboardShortcuts, useShortcutHelpPanel } from '@/hooks/useKeyboardShortcuts';
import { useAccessibility } from '@/hooks/useAccessibility';
import { shortcutGroups } from '@/data/shortcutGroups';


interface LayoutProps {
  children: ReactNode;
}

const tabs = [
  { path: '/', label: '使用', icon: Mic, shortcutKey: '1' },
  { path: '/settings', label: '设置', icon: Settings, shortcutKey: '2' },
  { path: '/training', label: '训练', icon: BookOpen, shortcutKey: '3' },
  { path: '/phrases', label: '短语', icon: MessageSquare, shortcutKey: '4' },
];


/** True on mobile UA, touch-only devices, or prefers-reduced-motion */
function detectMotionDisabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (/Android|iPhone|iPad|iPod|Mobile|miniProgram|MicroMessenger/i.test(navigator.userAgent)) return true;
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return true;
  }
  return false;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isOpen: shortcutsOpen, toggle: toggleShortcuts, close: closeShortcuts } = useShortcutHelpPanel();
  const { isMotionReduced: a11yReduced } = useAccessibility();
  const isMotionReduced = a11yReduced || detectMotionDisabled();
  

  // Plain number key navigation (normal priority, page shortcuts override via capture phase)
  const navShortcuts = useMemo(
    () =>
      tabs.map((tab) => ({
        key: tab.shortcutKey,
        label: tab.label,
        description: `导航到${tab.label}`,
        handler: () => navigate(tab.path),
      })),
    [navigate]
  );

  useKeyboardShortcuts(navShortcuts, 'normal');

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);

  // Motion variants — disabled when reduce-motion is on
  const pageVariants = isMotionReduced
    ? { initial: {}, animate: {}, exit: {} }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
      };

  const tabIndicatorTransition = isMotionReduced
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 400, damping: 30 };

  return (
    <div className="app-shell flex min-h-screen min-w-0 flex-col bg-background">
      <SkipToContent />

      {/* Header */}
      <header
        className="sticky top-0 z-50 border-b border-white/10 bg-[#0f172a] text-white"
        role="banner"
        style={{ paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))' }}
      >
        <div className="container flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <div className="flex flex-col">
              <h1 className="text-lg font-bold leading-tight tracking-tight">知音</h1>
              <p className="text-[10px] text-white/50 tracking-widest uppercase">Z H I Y I N</p>
            </div>
            <nav className="hidden md:flex items-center gap-1" role="navigation" aria-label="主导航">
              {tabs.map((tab) => {
                const isActive = location.pathname === tab.path || (tab.path === '/' ? location.pathname === '/' : location.pathname.startsWith(tab.path));
                return (
                  <button
                    key={tab.path}
                    onClick={() => navigate(tab.path)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`relative flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'text-white bg-white/10'
                        : 'text-white/60 hover:text-white/90 hover:bg-white/5'
                    }`}
                  >
                    {tab.label}
                    {isActive && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute inset-0 rounded-lg bg-white/10"
                        transition={tabIndicatorTransition}
                      />
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {/* Keyboard help toggle */}
            <button
              onClick={toggleShortcuts}
              className="keyboard-only a11y-target rounded-lg p-2 text-white/60 hover:text-white/90 hover:bg-white/10 transition-colors"
              aria-label="显示键盘快捷键帮助"
              title="键盘快捷键 (?)"
            >
              <Keyboard className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="main-content" className="app-main min-w-0 flex-1" role="main" aria-label="主要内容" style={{ minHeight: '200px' }}>
        {isMotionReduced ? (
          <div className="container px-4 py-6 md:py-8">
            {children}
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              {...pageVariants}
              transition={{ duration: 0.2 }}
              className="container px-4 py-6 md:py-8"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {/* Mobile Bottom Nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 shadow-[0_-4px_24px_hsl(var(--foreground)/0.04)] backdrop-blur-xl md:hidden"
        style={{ paddingBottom: 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))' }}
        role="navigation"
        aria-label="移动端导航"
      >
        <div className="mx-auto grid max-w-lg grid-cols-4 gap-1 px-2 py-2">
          {tabs.map((tab) => {
            const isActive = location.pathname === tab.path;
            return (
              <button
                key={tab.path}
                onClick={() => navigate(tab.path)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={tab.label}
                className={`a11y-target relative flex min-w-0 flex-col items-center gap-1 rounded-2xl px-1 py-2.5 text-xs font-semibold transition-colors ${
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground active:text-foreground'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="mobileActiveTab"
                    className="absolute inset-0 rounded-xl bg-primary/10"
                    transition={tabIndicatorTransition}
                  />
                )}
                <tab.icon className={`relative z-10 h-5 w-5 ${isActive ? 'text-primary' : ''}`} aria-hidden="true" />
                <span className="relative z-10" aria-hidden="true">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Keyboard Shortcuts Help Panel */}
      <KeyboardShortcutsPanel
        isOpen={shortcutsOpen}
        onClose={closeShortcuts}
        groups={shortcutGroups}
      />

      {/* Build timestamp badge (bottom-right, desktop only) */}
      <BuildBadge />
    </div>
  );
}
