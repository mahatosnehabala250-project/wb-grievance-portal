'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, RefreshCw, X, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/auth-store';
import { NAVY, NAVY_DARK } from '@/lib/constants';
import { RoleBadge } from '@/components/common';

export function LoginView() {
  const { login, isLoading, error, clearError } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await login(username, password);
    if (ok) {
      toast.success('Welcome!', { description: 'You have been logged in successfully.' });
    }
  }, [login, username, password]);

  const handleForgotPassword = useCallback(() => {
    toast.info('Forgot Password', { description: 'Please contact your system administrator to reset your password.' });
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${NAVY_DARK} 0%, ${NAVY} 40%, #1a3a7a 100%)` }}>
      {/* Animated gradient overlay */}
      <motion.div
        className="absolute inset-0 opacity-20"
        style={{ background: 'radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.4) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(16,185,129,0.3) 0%, transparent 50%), radial-gradient(ellipse at 60% 80%, rgba(234,179,8,0.3) 0%, transparent 50%)' }}
        animate={{
          background: [
            'radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.4) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(16,185,129,0.3) 0%, transparent 50%), radial-gradient(ellipse at 60% 80%, rgba(234,179,8,0.3) 0%, transparent 50%)',
            'radial-gradient(ellipse at 60% 30%, rgba(99,102,241,0.3) 0%, transparent 50%), radial-gradient(ellipse at 20% 70%, rgba(16,185,129,0.4) 0%, transparent 50%), radial-gradient(ellipse at 80% 50%, rgba(234,179,8,0.3) 0%, transparent 50%)',
            'radial-gradient(ellipse at 40% 70%, rgba(99,102,241,0.3) 0%, transparent 50%), radial-gradient(ellipse at 70% 40%, rgba(16,185,129,0.3) 0%, transparent 50%), radial-gradient(ellipse at 30% 20%, rgba(234,179,8,0.4) 0%, transparent 50%)',
          ],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* CSS dot grid background animation */}
      <div className="absolute inset-0 dot-grid-bg opacity-30" />
      {/* Subtle pattern texture */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }} />
      {/* Decorative circles */}
      <div className="absolute top-[-120px] left-[-120px] h-[400px] w-[400px] rounded-full opacity-10" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.3), transparent)' }} />
      <div className="absolute bottom-[-80px] right-[-80px] h-[300px] w-[300px] rounded-full opacity-10" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.2), transparent)' }} />

      {/* Floating Particles */}
      {[
        { left: '10%', size: 4, duration: 12, delay: 0 },
        { left: '25%', size: 3, duration: 18, delay: 2 },
        { left: '45%', size: 5, duration: 15, delay: 4 },
        { left: '65%', size: 3, duration: 20, delay: 1 },
        { left: '80%', size: 4, duration: 14, delay: 3 },
        { left: '90%', size: 2, duration: 22, delay: 5 },
        { left: '35%', size: 2, duration: 16, delay: 7 },
        { left: '55%', size: 3, duration: 19, delay: 6 },
      ].map((p, i) => (
        <div
          key={i}
          className="absolute bottom-0 rounded-full bg-white/40 float-particle"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}

      <div className="w-full max-w-md relative z-10">
        {/* Government branding header */}
        <div className="text-center mb-8">
          <motion.div
            className="inline-flex items-center justify-center h-20 w-20 rounded-2xl bg-white/15 backdrop-blur-sm shadow-lg mb-4 border border-white/20"
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Shield className="h-10 w-10 text-white" />
          </motion.div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Government of West Bengal
          </h1>
          <p className="text-blue-200/80 text-sm mt-1.5 font-medium">
            AI Public Support System
          </p>
          <p className="text-blue-300/50 text-base mt-1 font-medium tracking-wide">
            পশ্চিমবঙ্গ সরকার
          </p>
          <div className="h-0.5 w-24 bg-white/30 mx-auto mt-4 rounded-full" />
        </div>

        {/* Login Card with shimmer effect */}
        <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-sm relative overflow-hidden">
          {!mounted && (
            <div className="absolute inset-0 -translate-x-full z-10" style={{
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
              animation: 'shimmer 1.5s infinite',
            }} />
          )}
          <CardHeader className="pb-4">
            <div className="flex items-center justify-center gap-2 mb-1">
            <CardTitle className="text-lg font-bold text-center">Sign In to Portal</CardTitle>
            <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300 border-0 text-[10px] px-1.5 py-0 font-bold">v2.0</Badge>
          </div>
            <CardDescription className="text-center text-xs">
              Access the grievance management dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                  <button type="button" onClick={clearError} className="ml-auto shrink-0">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="username" className="text-xs font-semibold uppercase tracking-wider">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  className="h-11"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="h-11"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={isLoading || !username || !password}
                className="w-full h-11 text-sm font-semibold text-white transition-all duration-200 hover:shadow-lg"
                style={{ backgroundColor: NAVY }}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Authenticating...
                  </span>
                ) : (
                  'Sign In'
                )}
              </Button>
              {/* Forgot Password link */}
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                >
                  Forgot Password?
                </button>
              </div>
            </form>

            {/* Test accounts hint */}
            <div className="mt-6 pt-4 border-t">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 text-center">
                Demo Accounts
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { u: 'admin', p: 'admin123', r: 'ADMIN' },
                  { u: 'state_wb', p: 'state123', r: 'STATE' },
                  { u: 'district_nadia', p: 'nadia123', r: 'DISTRICT' },
                  { u: 'block_krishnanagar', p: 'krish123', r: 'BLOCK' },
                ].map((acc) => (
                  <button
                    key={acc.u}
                    type="button"
                    onClick={() => { setUsername(acc.u); setPassword(acc.p); }}
                    className="text-left p-2 rounded-lg border bg-muted/50 hover:bg-muted transition-colors group"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <code className="text-[10px] font-mono text-foreground group-hover:text-sky-700 transition-colors truncate">{acc.u}</code>
                      <RoleBadge role={acc.r} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-blue-200/50 text-[11px] mt-6">
          &copy; 2025 Government of West Bengal &mdash; All Rights Reserved
        </p>
      </div>
      {/* Global animation keyframes */}
      <style>{`
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
        @keyframes shimmerBg {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .shimmer-bg {
          background: linear-gradient(90deg, hsl(var(--muted)) 25%, hsl(var(--muted-foreground) / 0.08) 50%, hsl(var(--muted)) 75%);
          background-size: 200% 100%;
          animation: shimmerBg 1.5s ease-in-out infinite;
        }
        @keyframes dotDrift {
          0% { background-position: 0 0; }
          100% { background-position: 40px 40px; }
        }
        .dot-grid-bg {
          background-image: radial-gradient(circle, rgba(255,255,255,0.25) 1px, transparent 1px);
          background-size: 40px 40px;
          animation: dotDrift 15s linear infinite;
        }
        @keyframes floatUp {
          0% { transform: translateY(0) rotate(0deg); opacity: 0; }
          10% { opacity: 0.6; }
          90% { opacity: 0.6; }
          100% { transform: translateY(-100vh) rotate(360deg); opacity: 0; }
        }
        .float-particle {
          animation: floatUp linear infinite;
        }
      `}</style>
    </div>
  );
}
