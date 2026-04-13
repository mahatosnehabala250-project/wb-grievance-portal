'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, RefreshCw, X, AlertTriangle, FileText, User, Lock, ChevronRight, Loader2, Globe, Building2, MapPin, UserCog } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/auth-store';
import { useI18nStore } from '@/lib/i18n-store';
import { NAVY, NAVY_DARK } from '@/lib/constants';
import { RoleBadge } from '@/components/common';

export function LoginView() {
  const { login, isLoading, error, clearError } = useAuthStore();
  const { t } = useI18nStore();
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

  const handleTermsOfService = useCallback(() => {
    toast.info('Terms of Service', {
      description: 'By using this portal, you agree to the Government of West Bengal e-Governance terms of service, data usage policy, and acceptable use guidelines.',
      duration: 8000,
    });
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

      {/* Animated Background Gradient Mesh Blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute w-[500px] h-[500px] rounded-full opacity-30 blur-[100px]"
          style={{ background: 'radial-gradient(circle, #0A2463 0%, transparent 70%)' }}
          animate={{ x: [0, 120, -60, 0], y: [0, -80, 40, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute w-[400px] h-[400px] rounded-full opacity-20 blur-[80px]"
          style={{ background: 'radial-gradient(circle, #065F46 0%, transparent 70%)', top: '10%', right: '-10%' }}
          animate={{ x: [0, -100, 60, 0], y: [0, 60, -30, 0] }}
          transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        />
        <motion.div
          className="absolute w-[350px] h-[350px] rounded-full opacity-[0.15] blur-[90px]"
          style={{ background: 'radial-gradient(circle, #D97706 0%, transparent 70%)', bottom: '5%', left: '-5%' }}
          animate={{ x: [0, 80, -40, 0], y: [0, -50, 80, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut', delay: 4 }}
        />
        <motion.div
          className="absolute w-[300px] h-[300px] rounded-full opacity-20 blur-[70px]"
          style={{ background: 'radial-gradient(circle, #0A2463 0%, transparent 70%)', bottom: '20%', right: '10%' }}
          animate={{ x: [0, -60, 90, 0], y: [0, 40, -60, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        />
      </div>

      {/* Animated Background Orbs — navy, emerald, amber with low opacity */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 350, height: 350, top: '-5%', left: '-8%',
          background: 'radial-gradient(circle, rgba(10,36,99,0.18) 0%, transparent 70%)',
          animation: 'float-orb 15s ease-in-out infinite',
        }}
      />
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 280, height: 280, top: '60%', right: '-5%',
          background: 'radial-gradient(circle, rgba(5,150,105,0.14) 0%, transparent 70%)',
          animation: 'float-orb 20s ease-in-out infinite',
          animationDelay: '-5s',
        }}
      />
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 220, height: 220, bottom: '10%', left: '5%',
          background: 'radial-gradient(circle, rgba(217,119,6,0.12) 0%, transparent 70%)',
          animation: 'float-orb 25s ease-in-out infinite',
          animationDelay: '-10s',
        }}
      />
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 180, height: 180, top: '30%', right: '20%',
          background: 'radial-gradient(circle, rgba(10,36,99,0.10) 0%, transparent 70%)',
          animation: 'float-orb 18s ease-in-out infinite',
          animationDelay: '-3s',
        }}
      />

      {/* Mesh/ Grid pattern overlay */}
      <div className="absolute inset-0 mesh-pattern" />

      {/* CSS dot grid background animation */}
      <div className="absolute inset-0 dot-grid-bg opacity-30" />

      {/* Subtle pattern texture */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }} />

      {/* Noise texture overlay */}
      <div className="noise-overlay" />

      {/* Floating Particles — enhanced with more particles and varying opacity */}
      {[
        { left: '5%', size: 3, duration: 14, delay: 0, opacity: 0.5 },
        { left: '15%', size: 4, duration: 12, delay: 2, opacity: 0.3 },
        { left: '25%', size: 2, duration: 18, delay: 4, opacity: 0.4 },
        { left: '35%', size: 3, duration: 15, delay: 1, opacity: 0.6 },
        { left: '45%', size: 5, duration: 16, delay: 6, opacity: 0.3 },
        { left: '55%', size: 2, duration: 20, delay: 3, opacity: 0.5 },
        { left: '65%', size: 4, duration: 14, delay: 7, opacity: 0.4 },
        { left: '75%', size: 3, duration: 19, delay: 5, opacity: 0.3 },
        { left: '85%', size: 2, duration: 22, delay: 1, opacity: 0.6 },
        { left: '95%', size: 4, duration: 17, delay: 8, opacity: 0.35 },
        { left: '10%', size: 2, duration: 13, delay: 10, opacity: 0.45 },
        { left: '50%', size: 3, duration: 16, delay: 9, opacity: 0.5 },
      ].map((p, i) => (
        <div
          key={i}
          className="absolute bottom-0 rounded-full bg-white float-particle"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
            opacity: p.opacity,
          }}
        />
      ))}

      <div className="w-full max-w-md relative z-10">
        {/* Login Card Glow Effect */}
        <div className="login-card-glow" />
        {/* Government branding header with emblem */}
        <div className="text-center mb-8">
          {/* Government of West Bengal Emblem Area */}
          <div className="flex justify-center mb-3">
            <motion.div
              className="relative"
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            >
              {/* Pulsing glow ring */}
              <div className="absolute -inset-3 rounded-[28px] glow-ring" />
              <div className="gov-emblem h-16 w-16 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/15 flex items-center justify-center relative z-[2]"
                style={{ boxShadow: '0 0 30px rgba(255,255,255,0.15), 0 0 60px rgba(10,36,99,0.4), 0 8px 32px rgba(0,0,0,0.3)' }}
              >
                <div className="relative">
                  <Shield className="h-8 w-8 text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
                  <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-amber-400/80 flex items-center justify-center">
                    <span className="text-[7px] font-black text-amber-900">WB</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Government of West Bengal
            </h1>
            {/* Government of India sub-line with emblem */}
            <p className="text-blue-200/60 text-[11px] mt-1 font-medium flex items-center justify-center gap-1.5">
              <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-white/10 border border-white/20">
                <span className="text-[8px]">wheel</span>
              </span>
              Government of India
            </p>
            <p className="text-blue-200/80 text-sm mt-1.5 font-medium">
              AI Public Support System
            </p>
            <p className="text-blue-300/40 text-xs mt-0.5 font-medium tracking-wider">
              e-Governance Initiative
            </p>
            <p className="text-blue-300/50 text-base mt-1 font-medium tracking-wide">
              পশ্চিমবঙ্গ সরকার
            </p>
          </motion.div>
          <div className="h-0.5 w-24 bg-gradient-to-r from-transparent via-white/30 to-transparent mx-auto mt-4 rounded-full" />
        </div>

        {/* Login Card with enhanced glass-morphism + shimmer sweep */}
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <div className="login-card-border-rotate">
          <Card className="login-card-glass shimmer-sweep border-0 relative overflow-hidden premium-login-card">
            {!mounted && (
              <div className="absolute inset-0 -translate-x-full z-10" style={{
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
                animation: 'shimmer 1.5s infinite',
              }} />
            )}
            <CardHeader className="pb-4 relative z-[2]">
              <div className="flex items-center justify-center gap-2 mb-1">
                <CardTitle className="text-lg font-bold text-center">{t('signInToPortal')}</CardTitle>
                <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300 border-0 text-[10px] px-1.5 py-0 font-bold">v2.0</Badge>
              </div>
              <CardDescription className="text-center text-xs">
                Access the grievance management dashboard
              </CardDescription>
            </CardHeader>
            <CardContent className="relative z-[2]">
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
                  <Label htmlFor="username" className="text-xs font-semibold uppercase tracking-wider">{t('username')}</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                    <Input
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={t('enterUsername')}
                      className="h-11 pl-10 enhanced-input"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider">{t('password')}</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('enterPassword')}
                      className="h-11 pl-10 enhanced-input"
                      required
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={isLoading || !username || !password}
                  className="w-full h-11 text-sm font-semibold text-white transition-all duration-200 hover:shadow-lg hover:scale-[1.01] active:scale-[0.98] enhanced-login-btn"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" style={{ filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.6))' }} />
                      {t('authenticating')}
                    </span>
                  ) : (
                    t('login')
                  )}
                </Button>
                {/* Forgot Password link */}
                <div className="text-center pt-1 space-y-1.5">
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                  >
                    {t('forgotPassword')}
                  </button>
                  <div>
                    <button
                      type="button"
                      onClick={handleTermsOfService}
                      className="text-xs text-muted-foreground/60 hover:text-foreground/80 underline underline-offset-2 transition-colors flex items-center justify-center gap-1 mx-auto"
                    >
                      <FileText className="h-3 w-3" />
                      Terms of Service
                    </button>
                  </div>
                </div>
              </form>

              {/* Enhanced Demo Accounts with icon accents and better hover states */}
              <div className="mt-6 pt-4 border-t">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 text-center">
                  {t('demoAccounts')}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { u: 'admin', p: 'admin123', r: 'ADMIN', icon: Shield, borderColor: '#0A2463', iconBg: '#0A2463' },
                    { u: 'state_wb', p: 'state123', r: 'STATE', icon: Globe, borderColor: '#059669', iconBg: '#059669' },
                    { u: 'district_nadia', p: 'nadia123', r: 'DISTRICT', icon: Building2, borderColor: '#d97706', iconBg: '#d97706' },
                    { u: 'block_krishnanagar', p: 'krish123', r: 'BLOCK', icon: MapPin, borderColor: '#dc2626', iconBg: '#dc2626' },
                  ].map((acc) => (
                    <motion.button
                      key={acc.u}
                      type="button"
                      onClick={() => { setUsername(acc.u); setPassword(acc.p); }}
                      className="demo-btn demo-btn-enhanced text-left p-2.5 rounded-lg border bg-muted/50 hover:bg-muted hover:shadow-md transition-all group"
                      style={{ borderLeftWidth: '3px', borderLeftColor: acc.borderColor }}
                      whileHover={{ scale: 1.03, filter: 'brightness(1.08)' }}
                      whileTap={{ scale: 0.97 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: acc.iconBg }}>
                          <acc.icon className="h-3.5 w-3.5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <code className="text-[10px] font-mono text-foreground group-hover:text-foreground transition-colors truncate block">{acc.u}</code>
                          <RoleBadge role={acc.r} />
                        </div>
                        <ChevronRight className="h-3 w-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </motion.button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
          </div>
        </motion.div>

        {/* Animated decorative line above footer */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.5, duration: 0.8, ease: 'easeOut' }}
          className="w-32 h-[2px] mx-auto mt-6 rounded-full footer-shimmer-line"
        />

        {/* Government Copyright */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center text-[11px] mt-3"
        >
          <span className="shimmer-text">Powered by</span>{' '}
          <span className="text-blue-200/50">Government of West Bengal</span>
          <span className="text-blue-200/30 mx-1">&middot;</span>
          <span className="text-blue-200/30">&copy; 2025</span>
        </motion.p>
        {/* National e-Governance Plan powered-by text */}
        <p className="text-center text-[9px] mt-1 text-blue-300/30 tracking-wide">
          Powered by National e-Governance Plan
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

        /* 1. Pulsing glow ring around logo */
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 15px rgba(255,255,255,0.2), 0 0 30px rgba(10,36,99,0.3), 0 0 45px rgba(6,95,70,0.15); opacity: 0.6; }
          50% { box-shadow: 0 0 25px rgba(255,255,255,0.35), 0 0 50px rgba(10,36,99,0.5), 0 0 75px rgba(6,95,70,0.25); opacity: 1; }
        }
        .glow-ring {
          animation: glowPulse 3s ease-in-out infinite;
          background: conic-gradient(from 0deg, rgba(10,36,99,0.3), rgba(6,95,70,0.2), rgba(217,119,6,0.2), rgba(10,36,99,0.3));
          filter: blur(2px);
          z-index: 1;
        }

        /* 3. Premium login card glassmorphism */
        .premium-login-card {
          background: rgba(255,255,255,0.08) !important;
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          border: 1px solid rgba(255,255,255,0.12) !important;
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.05),
            0 4px 6px -1px rgba(0,0,0,0.15),
            0 10px 20px -5px rgba(0,0,0,0.2),
            0 25px 50px -12px rgba(0,0,0,0.3),
            inset 0 1px 0 0 rgba(255,255,255,0.1) !important;
          transition: transform 0.3s ease, box-shadow 0.3s ease !important;
          position: relative;
        }
        .premium-login-card::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0.02), rgba(255,255,255,0.08));
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
          z-index: 1;
        }
        .premium-login-card:hover {
          transform: scale(1.005);
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.08),
            0 4px 6px -1px rgba(0,0,0,0.15),
            0 10px 20px -5px rgba(0,0,0,0.2),
            0 30px 60px -12px rgba(0,0,0,0.35),
            0 0 40px rgba(10,36,99,0.15),
            inset 0 1px 0 0 rgba(255,255,255,0.12) !important;
        }

        /* 4. Enhanced form inputs with navy left border on focus */
        .enhanced-input {
          border-left: 3px solid transparent;
          transition: border-color 0.3s ease, box-shadow 0.3s ease, background-color 0.2s ease;
          placeholder-color: rgba(100,116,139,0.4);
        }
        .enhanced-input:focus {
          border-left-color: #0A2463 !important;
          box-shadow: 0 0 0 1px rgba(10,36,99,0.15), 0 0 0 3px rgba(10,36,99,0.08);
          background-color: rgba(255,255,255,0.06);
        }
        .enhanced-input::placeholder {
          color: rgba(100,116,139,0.45);
          font-style: italic;
          font-size: 0.8rem;
        }

        /* 5. Enhanced login button with gradient */
        .enhanced-login-btn {
          background: linear-gradient(135deg, #0A2463 0%, #1a3a7a 50%, #0A2463 100%) !important;
          background-size: 200% 200% !important;
          transition: all 0.3s ease !important;
          box-shadow: 0 4px 15px rgba(10,36,99,0.4);
        }
        .enhanced-login-btn:hover:not(:disabled) {
          filter: brightness(1.25);
          background-position: 100% 100% !important;
          box-shadow: 0 6px 25px rgba(10,36,99,0.5), 0 0 15px rgba(10,36,99,0.15);
        }
        .enhanced-login-btn:active:not(:disabled) {
          transform: scale(0.98);
        }
        .enhanced-login-btn:disabled {
          opacity: 0.6;
          filter: brightness(0.9);
        }

        /* 7. Shimmer text for "Powered by" */
        @keyframes shimmerText {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        .shimmer-text {
          background: linear-gradient(90deg, rgba(147,197,253,0.4) 0%, rgba(255,255,255,0.8) 50%, rgba(147,197,253,0.4) 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmerText 4s linear infinite;
          font-weight: 600;
        }

        /* 7. Animated decorative line above footer */
        @keyframes footerLineGlow {
          0%, 100% { background-position: 0% 50%; opacity: 0.4; }
          50% { background-position: 100% 50%; opacity: 0.8; }
        }
        .footer-shimmer-line {
          background: linear-gradient(90deg, transparent, rgba(147,197,253,0.5), rgba(255,255,255,0.7), rgba(147,197,253,0.5), transparent);
          background-size: 200% 100%;
          animation: footerLineGlow 3s ease-in-out infinite;
        }

        /* 8. Noise texture overlay */
        .noise-overlay {
          position: absolute;
          inset: 0;
          opacity: 0.02;
          pointer-events: none;
          z-index: 1;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E");
          background-repeat: repeat;
          background-size: 128px 128px;
          mix-blend-mode: overlay;
        }
      `}</style>
    </div>
  );
}
