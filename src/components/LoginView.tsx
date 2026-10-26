'use client';

import { useCallback, useState } from 'react';
import { AlertTriangle, ChevronRight, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Sign-in. What an account sees is decided by the account itself — the token
 * is built from its own row in /api/auth/login — so the page asks for nothing
 * else. The left side states the ground this office covers, in the same trail
 * the app uses for every place: district, seats, blocks, panchayats, villages,
 * booths. Figures are Purulia's LGD and ECI counts, the only district served.
 */
const COVERAGE: { n: string; label: string }[] = [
  { n: '9', label: 'assembly seats' },
  { n: '20', label: 'blocks' },
  { n: '170', label: 'panchayats' },
  { n: '2,711', label: 'villages' },
  { n: '2,802', label: 'booths' },
];

export function LoginView() {
  const { login, isLoading, error, clearError } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await login(username.trim(), password);
    if (ok) toast.success('স্বাগতম', { description: 'Signed in' });
  }, [login, username, password]);

  const ready = username.trim() !== '' && password !== '';

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground lg:flex-row">
      {/* The ground this office covers */}
      <section className="relative flex flex-col justify-between border-b border-border bg-card px-6 py-8 sm:px-10 lg:w-[44%] lg:border-b-0 lg:border-r lg:px-14 lg:py-14">
        <div>
          <div className="flex items-center gap-3">
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-xl font-semibold text-primary-foreground" lang="bn">ব</span>
            <div>
              <p className="text-base font-semibold leading-tight" lang="bn">বাংলার সহায়ক</p>
              <p className="text-xs text-muted-foreground">Banglar Sahayak</p>
            </div>
          </div>

          <h1 className="mt-10 max-w-md text-[32px] font-semibold leading-[1.15] tracking-tight text-balance sm:text-[40px]" lang="bn">
            মানুষের প্রতিটি অভিযোগ, কার কাছে আছে, কতদিন অপেক্ষা
          </h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            Every complaint from your area, who is working on it, and what has waited too long. From one village to the whole district.
          </p>
        </div>

        <div className="mt-10 lg:mt-0">
          <p className="text-sm font-medium text-foreground">Purulia</p>
          <ol aria-label="What Purulia is made of" className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1.5 text-sm">
            {COVERAGE.map((c, i) => (
              <li key={c.label} className="flex items-baseline gap-2">
                <span><span className="font-semibold tabular-nums text-foreground">{c.n}</span> <span className="text-muted-foreground">{c.label}</span></span>
                {i < COVERAGE.length - 1 && <ChevronRight className="h-3.5 w-3.5 self-center text-muted-foreground/50" aria-hidden />}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Sign in */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">Use the username and password your office gave you.</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-md border border-late/40 bg-late/10 p-3 text-sm text-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-late" aria-hidden />
                <span className="flex-1">{error}</span>
                <button type="button" onClick={clearError} aria-label="Dismiss" className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => { setUsername(e.target.value); if (error) clearError(); }}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                required
                className="h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (error) clearError(); }}
                  autoComplete="current-password"
                  required
                  className="h-11 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" disabled={isLoading || !ready} className="h-11 w-full text-[15px] font-semibold">
              {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in</> : 'Sign in'}
            </Button>

            <div>
              <button type="button" onClick={() => setForgotOpen((v) => !v)} aria-expanded={forgotOpen}
                className="rounded-sm text-sm text-muted-foreground underline decoration-foreground/25 underline-offset-[3px] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Forgot your password?
              </button>
              {forgotOpen && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Ask whoever runs this office&apos;s accounts, usually the district president&apos;s office, to set a new one. Passwords are never sent by message.
                </p>
              )}
            </div>
          </form>

          <footer className="mt-12 space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
            <p>A private citizen-service initiative, not a government website.</p>
            <p>
              Built by NeuroSetu.{' '}
              <a href="/terms-of-service.html" target="_blank" rel="noopener noreferrer"
                className="underline decoration-foreground/25 underline-offset-[3px] hover:text-foreground">Terms of service</a>
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}
