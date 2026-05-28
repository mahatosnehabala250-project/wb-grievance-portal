'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

const WB_DISTRICTS = [
  'Alipurduar', 'Bankura', 'Birbhum', 'Cooch Behar', 'Dakshin Dinajpur',
  'Darjeeling', 'Hooghly', 'Howrah', 'Jalpaiguri', 'Jhargram', 'Kalimpong',
  'Kolkata', 'Malda', 'Murshidabad', 'Nadia', 'North 24 Parganas',
  'Paschim Bardhaman', 'Paschim Medinipur', 'Purba Bardhaman', 'Purba Medinipur',
  'Purulia', 'South 24 Parganas', 'Uttar Dinajpur'
];

type Step = 'form' | 'otp' | 'success';

export default function DonorRegisterPage() {
  const [step, setStep] = useState<Step>('form');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '', phone: '', blood_group: '', gender: '',
    district: '', block: '', last_donated: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Validate
      if (!form.name || !form.phone || !form.blood_group || !form.gender || !form.district) {
        setError('সব mandatory field পূরণ করুন।');
        setLoading(false);
        return;
      }
      const phone = form.phone.replace(/\D/g, '');
      if (phone.length < 10) {
        setError('সঠিক phone number দিন।');
        setLoading(false);
        return;
      }
      const fullPhone = phone.startsWith('91') ? phone : '91' + phone.slice(-10);

      const { error: err } = await supabase.rpc('register_blood_donor', {
        p_phone: fullPhone,
        p_name: form.name.trim(),
        p_gender: form.gender,
        p_blood_group: form.blood_group,
        p_district: form.district,
        p_block: form.block || '',
        p_last_donated: form.last_donated || null
      });

      if (err) throw err;
      setStep('success');
    } catch (e: any) {
      setError(e.message || 'কিছু সমস্যা হয়েছে। আবার চেষ্টা করুন।');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-950 via-red-900 to-rose-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          {/* Success animation */}
          <div className="relative mb-8">
            <div className="w-32 h-32 mx-auto relative">
              <div className="absolute inset-0 bg-red-500/20 rounded-full animate-ping" />
              <div className="absolute inset-4 bg-red-500/30 rounded-full animate-ping" style={{ animationDelay: '0.2s' }} />
              <div className="relative w-full h-full bg-gradient-to-br from-red-400 to-red-600 rounded-full flex items-center justify-center shadow-2xl shadow-red-500/50">
                <span className="text-5xl">🩸</span>
              </div>
            </div>
          </div>

          <h1 className="text-3xl font-bold text-white mb-3">
            ধন্যবাদ!
          </h1>
          <p className="text-red-200 text-lg mb-2">
            আপনি সফলভাবে রক্তদাতা হিসেবে নথিভুক্ত হয়েছেন।
          </p>
          <p className="text-red-300 text-sm mb-8">
            জরুরি প্রয়োজনে আপনাকে WhatsApp-এ notify করা হবে।
          </p>

          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 mb-6 text-left space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">👤</span>
              <div>
                <p className="text-red-300 text-xs">নাম</p>
                <p className="text-white font-semibold">{form.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-2xl">🩸</span>
              <div>
                <p className="text-red-300 text-xs">রক্তের গ্রুপ</p>
                <p className="text-white font-bold text-lg">{form.blood_group}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-2xl">📍</span>
              <div>
                <p className="text-red-300 text-xs">জেলা</p>
                <p className="text-white font-semibold">{form.district}{form.block ? `, ${form.block}` : ''}</p>
              </div>
            </div>
          </div>

          <div className="bg-green-500/20 border border-green-500/30 rounded-xl p-4 mb-6">
            <p className="text-green-300 text-sm">
              ✅ আপনার WhatsApp-এ একটি confirmation message যাবে।
            </p>
          </div>

          <p className="text-red-400 text-xs">
            বাংলার সহায়ক — NeuroSetu AI
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-950 via-red-900 to-rose-950">
      {/* Hero */}
      <div className="relative overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-red-500/10 rounded-full blur-3xl" />
          <div className="absolute top-40 -left-20 w-48 h-48 bg-rose-500/10 rounded-full blur-3xl" />
        </div>

        <div className="relative px-4 pt-12 pb-8 text-center max-w-lg mx-auto">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-1.5 mb-6">
            <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
            <span className="text-red-200 text-xs font-medium tracking-wider">RAKTA SAHAYAK</span>
          </div>

          <div className="text-6xl mb-4">🩸</div>

          <h1 className="text-3xl font-bold text-white mb-3 leading-tight">
            রক্তদাতা হন<br />
            <span className="text-red-300">জীবন বাঁচান</span>
          </h1>

          <p className="text-red-200/80 text-sm leading-relaxed max-w-sm mx-auto">
            আপনার নাম নথিভুক্ত করুন। জরুরি প্রয়োজনে আমরা আপনাকে
            WhatsApp-এ notify করব।
          </p>

          {/* Stats */}
          <div className="flex justify-center gap-6 mt-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-white">∞</p>
              <p className="text-red-300 text-xs">Lives Saved</p>
            </div>
            <div className="w-px bg-white/20" />
            <div className="text-center">
              <p className="text-2xl font-bold text-white">24/7</p>
              <p className="text-red-300 text-xs">Available</p>
            </div>
            <div className="w-px bg-white/20" />
            <div className="text-center">
              <p className="text-2xl font-bold text-white">Free</p>
              <p className="text-red-300 text-xs">Always</p>
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="px-4 pb-12 max-w-lg mx-auto">
        <div className="bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 p-6 shadow-2xl">
          <h2 className="text-white font-bold text-lg mb-6 text-center">
            নিবন্ধন ফর্ম
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name */}
            <div>
              <label className="text-red-200 text-xs font-medium mb-1.5 block">
                পুরো নাম <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="আপনার নাম লিখুন"
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-red-400/50 focus:border-red-400/50 text-sm"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="text-red-200 text-xs font-medium mb-1.5 block">
                WhatsApp নম্বর <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 text-sm">+91</span>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="10 digit number"
                  maxLength={10}
                  className="w-full bg-white/10 border border-white/20 rounded-xl pl-12 pr-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-red-400/50 text-sm"
                />
              </div>
            </div>

            {/* Blood Group */}
            <div>
              <label className="text-red-200 text-xs font-medium mb-1.5 block">
                রক্তের গ্রুপ <span className="text-red-400">*</span>
              </label>
              <div className="grid grid-cols-4 gap-2">
                {BLOOD_GROUPS.map(bg => (
                  <button
                    key={bg}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, blood_group: bg }))}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-all ${
                      form.blood_group === bg
                        ? 'bg-red-500 text-white shadow-lg shadow-red-500/30 scale-105'
                        : 'bg-white/10 text-white/70 border border-white/20 hover:bg-white/20'
                    }`}
                  >
                    {bg}
                  </button>
                ))}
              </div>
            </div>

            {/* Gender */}
            <div>
              <label className="text-red-200 text-xs font-medium mb-1.5 block">
                লিঙ্গ <span className="text-red-400">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[{ val: 'male', label: '👨 পুরুষ' }, { val: 'female', label: '👩 মহিলা' }].map(g => (
                  <button
                    key={g.val}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, gender: g.val }))}
                    className={`py-3 rounded-xl text-sm font-medium transition-all ${
                      form.gender === g.val
                        ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
                        : 'bg-white/10 text-white/70 border border-white/20 hover:bg-white/20'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              {form.gender === 'female' && (
                <p className="text-yellow-300/70 text-xs mt-2">
                  ℹ️ মহিলা donors 120 দিন পর পর donate করতে পারেন।
                </p>
              )}
            </div>

            {/* District */}
            <div>
              <label className="text-red-200 text-xs font-medium mb-1.5 block">
                জেলা <span className="text-red-400">*</span>
              </label>
              <select
                value={form.district}
                onChange={e => setForm(f => ({ ...f, district: e.target.value }))}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-400/50 text-sm appearance-none"
              >
                <option value="" className="bg-red-950">জেলা বেছে নিন</option>
                {WB_DISTRICTS.map(d => (
                  <option key={d} value={d} className="bg-red-950">{d}</option>
                ))}
              </select>
            </div>

            {/* Block */}
            <div>
              <label className="text-red-200 text-xs font-medium mb-1.5 block">
                ব্লক <span className="text-white/40">(optional)</span>
              </label>
              <input
                type="text"
                value={form.block}
                onChange={e => setForm(f => ({ ...f, block: e.target.value }))}
                placeholder="আপনার ব্লকের নাম"
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-red-400/50 text-sm"
              />
            </div>

            {/* Last Donated */}
            <div>
              <label className="text-red-200 text-xs font-medium mb-1.5 block">
                শেষ রক্তদান কবে? <span className="text-white/40">(optional)</span>
              </label>
              <input
                type="date"
                value={form.last_donated}
                onChange={e => setForm(f => ({ ...f, last_donated: e.target.value }))}
                max={new Date().toISOString().split('T')[0]}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-400/50 text-sm"
              />
              <p className="text-white/30 text-xs mt-1">কখনো না দিলে খালি রাখুন।</p>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-3">
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-red-500 to-rose-500 text-white font-bold py-4 rounded-xl text-base shadow-lg shadow-red-500/30 hover:shadow-red-500/50 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  নথিভুক্ত হচ্ছে...
                </span>
              ) : '🩸 রক্তদাতা হিসেবে নথিভুক্ত হন'}
            </button>
          </form>

          {/* WhatsApp alternative */}
          <div className="mt-6 pt-6 border-t border-white/10 text-center">
            <p className="text-white/40 text-xs mb-3">অথবা WhatsApp-এ register করুন</p>
            <a
              href="https://wa.me/919475128733?text=%E0%A6%A1%E0%A7%8B%E0%A6%A8%E0%A6%BE%E0%A6%B0+%E0%A6%B9%E0%A6%A4%E0%A7%87+%E0%A6%9A%E0%A6%BE%E0%A6%87"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-green-500/20 border border-green-500/30 text-green-300 rounded-xl px-6 py-3 text-sm hover:bg-green-500/30 transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              WhatsApp-এ Register করুন
            </a>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-red-400/50 text-xs mt-6">
          বাংলার সহায়ক — NeuroSetu AI • West Bengal
        </p>
      </div>
    </div>
  );
}
