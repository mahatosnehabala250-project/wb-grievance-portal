'use client';

import { useState, useEffect } from 'react';
import { X, Info, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';

type BannerType = 'info' | 'warning' | 'success' | 'urgent';

interface AnnouncementBannerProps {
  message: string;
  type?: BannerType;
  dismissible?: boolean;
}

const STORAGE_KEY = 'wb_announcement_dismissed';

const typeConfig: Record<BannerType, {
  icon: React.ElementType;
  bgColor: string;
  borderColor: string;
  textColor: string;
  iconColor: string;
  pulse?: boolean;
}> = {
  info: {
    icon: Info,
    bgColor: 'bg-sky-50 dark:bg-sky-950/40',
    borderColor: 'border-sky-200 dark:border-sky-800',
    textColor: 'text-sky-800 dark:text-sky-200',
    iconColor: 'text-sky-500',
  },
  warning: {
    icon: AlertTriangle,
    bgColor: 'bg-amber-50 dark:bg-amber-950/40',
    borderColor: 'border-amber-200 dark:border-amber-800',
    textColor: 'text-amber-800 dark:text-amber-200',
    iconColor: 'text-amber-500',
  },
  success: {
    icon: CheckCircle,
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/40',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
    textColor: 'text-emerald-800 dark:text-emerald-200',
    iconColor: 'text-emerald-500',
  },
  urgent: {
    icon: AlertCircle,
    bgColor: 'bg-red-50 dark:bg-red-950/40',
    borderColor: 'border-red-200 dark:border-red-800',
    textColor: 'text-red-800 dark:text-red-200',
    iconColor: 'text-red-500',
    pulse: true,
  },
};

export function AnnouncementBanner({
  message,
  type = 'info',
  dismissible = true,
}: AnnouncementBannerProps) {
  const [dismissed, setDismissed] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(STORAGE_KEY);
    // If no stored value or it was dismissed more than 24h ago, show the banner
    if (stored) {
      try {
        const dismissedAt = parseInt(stored, 10);
        const now = Date.now();
        // Reset after 24 hours
        if (now - dismissedAt > 24 * 60 * 60 * 1000) {
          localStorage.removeItem(STORAGE_KEY);
          setDismissed(false);
        } else {
          setDismissed(true);
        }
      } catch {
        setDismissed(false);
      }
    } else {
      setDismissed(false);
    }
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
  };

  if (!mounted || dismissed) return null;

  const config = typeConfig[type];
  const Icon = config.icon;

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="overflow-hidden"
        >
          <div
            className={`relative flex items-center gap-3 px-4 py-2.5 border ${config.bgColor} ${config.borderColor}`}
          >
            {/* Subtle gradient accent on left */}
            <div
              className={`absolute left-0 top-0 bottom-0 w-1 ${
                type === 'info' ? 'bg-sky-500' :
                type === 'warning' ? 'bg-amber-500' :
                type === 'success' ? 'bg-emerald-500' :
                'bg-red-500'
              }`}
            />

            <div className={`flex items-center gap-2 min-w-0 flex-1 ${config.textColor}`}>
              <div className={`shrink-0 ${config.pulse ? 'animate-pulse' : ''}`}>
                <Icon className={`h-4 w-4 ${config.iconColor}`} />
              </div>
              <p className="text-xs font-medium truncate">{message}</p>
            </div>

            {dismissible && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 shrink-0 hover:bg-black/5 dark:hover:bg-white/5"
                onClick={handleDismiss}
                aria-label="Dismiss announcement"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
