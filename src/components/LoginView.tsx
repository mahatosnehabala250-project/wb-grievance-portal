'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, AlertTriangle, X, User, Lock, ChevronRight, Loader2, Globe, Building2, MapPin, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/auth-store';
import { useI18nStore } from '@/lib/i18n-store';
import { NAVY } from '@/lib/constants';
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
      toast.success('স্বাগতম!', { description: 'সফলভাবে লগইন হয়েছে।' });
    }
  }, [login, username, password]);

  const handleForgotPassword = useCallback(() => {
    toast.info('পাসওয়ার্ড রিসেট', { description: 'পাসওয়ার্ড পুনরুদ্ধারের জন্য আপনার সিস্টেম অ্যাডমিনিস্ট্রেটরের সাথে যোগাযোগ করুন।' });
  }, []);

  const handleTermsOfService = useCallback(() => {
    window.open('/terms-of-service.html', '_blank');
  }, []);

  const demoAccounts = [
    { u: 'admin',          p: 'Admin@1234', r: 'ADMIN',    icon: Shield,    color: '#0A2463' },
    { u: 'state_wb1',      p: 'Admin@1234', r: 'STATE',    icon: Globe,     color: '#065F46' },
    { u: 'dist_purulia1',  p: 'Admin@1234', r: 'DISTRICT', icon: Building2, color: '#92400E' },
    { u: 'block_manbazar1',p: 'Admin@1234', r: 'BLOCK',    icon: MapPin,    color: '#7F1D1D' },
  ];

  return (
    <div className="min-h-screen flex" style={{ fontFamily: "'Noto Sans Bengali', 'Inter', sans-serif" }}>

      {/* ── LEFT PANEL — deep navy with WB identity ── */}
      <div
        className="hidden lg:flex flex-col justify-between w-[42%] p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #050E24 0%, #0A2463 60%, #0D2D78 100%)' }}
      >
        {/* Subtle geometric pattern */}
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />

        {/* Accent line top */}
        <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'linear-gradient(90deg, #F59E0B, #D97706, #F59E0B)' }} />

        {/* Top: WB Emblem + Name */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="flex items-center gap-4 mb-12">
            <div className="h-14 w-14 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center backdrop-blur-sm"
              style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.3)' }}>
              <Shield className="h-7 w-7 text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-lg leading-tight">বাংলার সহায়ক</p>
              <p className="text-white/50 text-xs tracking-widest uppercase mt-0.5">Banglar Sahayak</p>
            </div>
          </div>

          {/* Main headline */}
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-full px-3 py-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
              </span>
              <span className="text-amber-300 text-xs font-semibold tracking-wide">LIVE SYSTEM — PURULIA PILOT</span>
            </div>

            <h2 className="text-4xl font-black text-white leading-tight tracking-tight">
              নাগরিক<br />
              <span style={{ color: '#F59E0B' }}>অভিযোগ</span><br />
              ব্যবস্থাপনা
            </h2>

            <p className="text-white/50 text-sm leading-relaxed max-w-xs">
              পশ্চিমবঙ্গের নাগরিকদের সরকারি অভিযোগ দ্রুত সমাধানের জন্য AI-চালিত পোর্টাল।
            </p>
          </div>
        </motion.div>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="grid grid-cols-3 gap-4 mb-8"
        >
          {[
            { label: 'জেলা', value: '23' },
            { label: 'ব্লক', value: '341' },
            { label: 'প্রকল্প', value: '37' },
          ].map((s) => (
            <div key={s.label} className="bg-white/5 border border-white/8 rounded-xl p-3 text-center">
              <p className="text-2xl font-black text-white">{s.value}</p>
              <p className="text-white/40 text-[11px] mt-0.5 uppercase tracking-wide">{s.label}</p>
            </div>
          ))}
        </motion.div>

        {/* Bottom branding */}
        <div className="text-white/25 text-[11px] space-y-1">
          <p className="flex items-center gap-2">
            <span className="h-px w-6 bg-white/20" />
            Government of West Bengal
          </p>
          <p className="pl-8">পশ্চিমবঙ্গ সরকার — নাগরিক সেবা পোর্টাল</p>
          <p className="pl-8 mt-2 text-white/15">© 2026 — All Rights Reserved</p>
        </div>
      </div>

      {/* ── RIGHT PANEL — clean white/light login form ── */}
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 dark:bg-gray-950 px-6 py-12 relative">

        {/* Top accent line */}
        <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'linear-gradient(90deg, #0A2463, #1a3a7a, #0A2463)' }} />

        {/* Mobile-only header */}
        <div className="lg:hidden text-center mb-8">
          <div className="h-14 w-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: NAVY }}>
            <Shield className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-black" style={{ color: NAVY }}>বাংলার সহায়ক</h1>
          <p className="text-slate-500 text-sm mt-1">West Bengal Public Grievance Portal</p>
        </div>

        <motion.div
          className="w-full max-w-md"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Form card */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-slate-200 dark:border-gray-800 p-8"
            style={{ boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 20px 40px -10px rgba(10,36,99,0.12)' }}>

            {/* Card header */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Officer Login</h2>
                <span className="text-[10px] font-bold bg-slate-100 dark:bg-gray-800 text-slate-500 px-2 py-0.5 rounded-full uppercase tracking-wider">Secure Portal</span>
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-sm">
                অভিযোগ ব্যবস্থাপনা ড্যাশবোর্ডে প্রবেশ করুন
              </p>
              {/* Thin colored divider */}
              <div className="mt-4 h-px bg-gradient-to-r from-blue-600/30 via-blue-400/20 to-transparent" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Error */}
              {error && (
                <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span className="flex-1">{error}</span>
                  <button type="button" onClick={clearError}><X className="h-4 w-4" /></button>
                </div>
              )}

              {/* Username */}
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  Username
                </Label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => { setUsername(e.target.value); if (error) clearError(); }}
                    placeholder="Enter your username"
                    className="h-12 pl-10 bg-slate-50 dark:bg-gray-800 border-slate-200 dark:border-gray-700 rounded-xl text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600/20 transition-all"
                    required
                    autoComplete="username"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (error) clearError(); }}
                    placeholder="Enter your password"
                    className="h-12 pl-10 bg-slate-50 dark:bg-gray-800 border-slate-200 dark:border-gray-700 rounded-xl text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600/20 transition-all"
                    required
                    autoComplete="current-password"
                  />
                </div>
              </div>

              {/* Login button */}
              <Button
                type="submit"
                disabled={isLoading || !username || !password}
                className="w-full h-12 text-sm font-bold text-white rounded-xl mt-2 transition-all duration-200"
                style={{
                  background: isLoading || !username || !password
                    ? '#94A3B8'
                    : 'linear-gradient(135deg, #0A2463 0%, #1a3a7a 100%)',
                  boxShadow: '0 4px 14px rgba(10,36,99,0.35)',
                }}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Authenticating...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    লগইন করুন
                    <ChevronRight className="h-4 w-4" />
                  </span>
                )}
              </Button>

              {/* Links */}
              <div className="flex items-center justify-between pt-1">
                <button type="button" onClick={handleForgotPassword}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                  Forgot password?
                </button>
                <button type="button" onClick={handleTermsOfService}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  Terms of Service
                </button>
              </div>
            </form>

            {/* Demo accounts */}
            <div className="mt-6 pt-5 border-t border-slate-100 dark:border-gray-800">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 text-center">
                Demo Accounts — Click to fill
              </p>
              <div className="grid grid-cols-2 gap-2">
                {demoAccounts.map((acc) => (
                  <motion.button
                    key={acc.u}
                    type="button"
                    onClick={() => { setUsername(acc.u); setPassword(acc.p); if (error) clearError(); }}
                    className="text-left p-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 hover:bg-white dark:hover:bg-gray-750 hover:shadow-sm transition-all group"
                    style={{ borderLeftWidth: '3px', borderLeftColor: acc.color }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: acc.color }}>
                        <acc.icon className="h-3.5 w-3.5 text-white" />
                      </div>
                      <div className="min-w-0">
                        <code className="text-[10px] font-mono text-slate-700 dark:text-slate-300 truncate block">{acc.u}</code>
                        <RoleBadge role={acc.r} />
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>
          </div>

          {/* Footer note */}
          <p className="text-center text-[11px] text-slate-400 mt-6 flex items-center justify-center gap-1.5">
            <Shield className="h-3 w-3" />
            Secured by বাংলার সহায়ক
            <span className="text-slate-300">·</span>
            Government of West Bengal
          </p>
        </motion.div>
      </div>

    </div>
  );
}
