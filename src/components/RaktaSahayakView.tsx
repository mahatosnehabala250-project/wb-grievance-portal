'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Heart, Droplets, Users, AlertCircle, CheckCircle2,
  Clock, MapPin, Phone, Activity, RefreshCw, Search,
  TrendingUp, UserCheck, UserX, Pause, Play
} from 'lucide-react';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const BLOOD_COLORS: Record<string, string> = {
  'A+': 'bg-red-100 text-red-700 border-red-200',
  'A-': 'bg-red-50 text-red-600 border-red-100',
  'B+': 'bg-orange-100 text-orange-700 border-orange-200',
  'B-': 'bg-orange-50 text-orange-600 border-orange-100',
  'O+': 'bg-green-100 text-green-700 border-green-200',
  'O-': 'bg-green-50 text-green-600 border-green-100',
  'AB+': 'bg-purple-100 text-purple-700 border-purple-200',
  'AB-': 'bg-purple-50 text-purple-600 border-purple-100',
};

function BloodGroupBadge({ group }: { group: string }) {
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${BLOOD_COLORS[group] || 'bg-gray-100 text-gray-600'}`}>
      {group}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, color }: any) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
      <div className={`p-2.5 rounded-lg ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}

export function RaktaSahayakView() {
  const [tab, setTab] = useState<'requests' | 'donors'>('requests');
  const [requests, setRequests] = useState<any[]>([]);
  const [donors, setDonors] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalDonors: 0, activeRequests: 0, filledToday: 0, availableDonors: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [bgFilter, setBgFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch blood requests
      const { data: reqData } = await supabase
        .from('blood_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      // Fetch donors
      const { data: donorData } = await supabase
        .from('blood_donors')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (reqData) setRequests(reqData);
      if (donorData) setDonors(donorData);

      // Stats
      const today = new Date().toISOString().slice(0, 10);
      setStats({
        totalDonors: donorData?.length || 0,
        activeRequests: reqData?.filter(r => r.status === 'OPEN' || r.status === 'PARTIALLY_FILLED').length || 0,
        filledToday: reqData?.filter(r => r.filled_at?.startsWith(today)).length || 0,
        availableDonors: donorData?.filter(d => d.is_available && !d.is_paused).length || 0,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filter requests
  const filteredRequests = requests.filter(r => {
    const matchSearch = !search || r.hospital_name?.toLowerCase().includes(search.toLowerCase()) ||
      r.seeker_name?.toLowerCase().includes(search.toLowerCase()) ||
      r.request_no?.toLowerCase().includes(search.toLowerCase());
    const matchBg = bgFilter === 'all' || r.blood_group === bgFilter;
    const matchStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchSearch && matchBg && matchStatus;
  });

  // Filter donors
  const filteredDonors = donors.filter(d => {
    const matchSearch = !search || d.name?.toLowerCase().includes(search.toLowerCase()) ||
      d.phone?.includes(search) || d.district?.toLowerCase().includes(search.toLowerCase());
    const matchBg = bgFilter === 'all' || d.blood_group === bgFilter;
    return matchSearch && matchBg;
  });

  // Blood group counts for donors
  const bgCounts = BLOOD_GROUPS.reduce((acc, bg) => {
    acc[bg] = donors.filter(d => d.blood_group === bg && d.is_available && !d.is_paused).length;
    return acc;
  }, {} as Record<string, number>);

  const statusColor = (s: string) => {
    if (s === 'OPEN') return 'text-orange-500 bg-orange-50 border-orange-200';
    if (s === 'PARTIALLY_FILLED') return 'text-blue-500 bg-blue-50 border-blue-200';
    if (s === 'FILLED') return 'text-green-500 bg-green-50 border-green-200';
    if (s === 'CANCELLED') return 'text-gray-400 bg-gray-50 border-gray-200';
    if (s === 'EXPIRED') return 'text-red-400 bg-red-50 border-red-200';
    return 'text-gray-500 bg-gray-50 border-gray-200';
  };

  const statusLabel = (s: string) => {
    if (s === 'OPEN') return '⏳ Open';
    if (s === 'PARTIALLY_FILLED') return '🔄 Partial';
    if (s === 'FILLED') return '✅ Filled';
    if (s === 'CANCELLED') return '❌ Cancelled';
    if (s === 'EXPIRED') return '⌛ Expired';
    return s;
  };

  const fmtDate = (d: string) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

  const isEligible = (d: any) => !d.next_eligible_date || new Date(d.next_eligible_date) <= new Date();

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Droplets className="h-6 w-6 text-red-500" />
            রক্ত সহায়ক
            <span className="text-sm font-normal text-muted-foreground ml-1">Rakta Sahayak</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Emergency blood donor matching system</p>
        </div>
        <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Donors" value={stats.totalDonors} color="bg-blue-100 text-blue-600" />
        <StatCard icon={UserCheck} label="Available Now" value={stats.availableDonors} color="bg-green-100 text-green-600" />
        <StatCard icon={AlertCircle} label="Active Requests" value={stats.activeRequests} color="bg-orange-100 text-orange-600" />
        <StatCard icon={CheckCircle2} label="Filled Today" value={stats.filledToday} color="bg-purple-100 text-purple-600" />
      </div>

      {/* Blood Group Availability */}
      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-red-500" />
          Available Donors by Blood Group
        </p>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
          {BLOOD_GROUPS.map(bg => (
            <div key={bg} className={`rounded-lg border p-2 text-center cursor-pointer transition-all ${bgFilter === bg ? 'ring-2 ring-primary' : ''} ${BLOOD_COLORS[bg]}`}
              onClick={() => setBgFilter(bgFilter === bg ? 'all' : bg)}>
              <div className="font-bold text-sm">{bg}</div>
              <div className="text-lg font-bold">{bgCounts[bg]}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        <button onClick={() => setTab('requests')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'requests' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          🩸 Blood Requests ({requests.length})
        </button>
        <button onClick={() => setTab('donors')} className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'donors' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          ❤️ Donors ({donors.length})
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tab === 'requests' ? "Search hospital, name, request no..." : "Search name, phone, district..."}
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </div>
        <select value={bgFilter} onChange={e => setBgFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
          <option value="all">All Blood Groups</option>
          {BLOOD_GROUPS.map(bg => <option key={bg} value={bg}>{bg}</option>)}
        </select>
        {tab === 'requests' && (
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
            <option value="all">All Status</option>
            <option value="OPEN">Open</option>
            <option value="PARTIALLY_FILLED">Partially Filled</option>
            <option value="FILLED">Filled</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="EXPIRED">Expired</option>
          </select>
        )}
      </div>

      {/* Requests Table */}
      {tab === 'requests' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {filteredRequests.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Droplets className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No blood requests found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    {['Request No', 'Blood Group', 'Units', 'Hospital', 'District', 'Status', 'Time'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredRequests.map(r => (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-bold text-foreground">{r.request_no}</span>
                      </td>
                      <td className="px-4 py-3"><BloodGroupBadge group={r.blood_group} /></td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-semibold">
                          {r.units_filled || 0}/{r.units_needed}
                        </span>
                        <div className="w-16 bg-muted rounded-full h-1.5 mt-1">
                          <div className="bg-red-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, ((r.units_filled || 0) / r.units_needed) * 100)}%` }} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">{r.hospital_name}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" />{r.district}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full border ${statusColor(r.status)}`}>
                          {statusLabel(r.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3 inline mr-1" />
                        {fmtDate(r.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Donors Table */}
      {tab === 'donors' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {filteredDonors.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Heart className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No donors found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    {['Name', 'Blood Group', 'Phone', 'Location', 'Last Donated', 'Next Eligible', 'Status', 'Donations'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredDonors.map(d => {
                    const eligible = isEligible(d);
                    const active = d.is_available && !d.is_paused && eligible;
                    return (
                      <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-sm font-medium text-foreground">{d.name}</td>
                        <td className="px-4 py-3"><BloodGroupBadge group={d.blood_group} /></td>
                        <td className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" />{d.phone?.replace('91', '')}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          <MapPin className="h-3 w-3 inline mr-1" />
                          {d.block ? `${d.block}, ` : ''}{d.district}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {d.last_donated_date ? new Date(d.last_donated_date).toLocaleDateString('en-IN') : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {d.next_eligible_date ? (
                            <span className={eligible ? 'text-green-600' : 'text-orange-500'}>
                              {eligible ? '✅ Now' : new Date(d.next_eligible_date).toLocaleDateString('en-IN')}
                            </span>
                          ) : '✅ Now'}
                        </td>
                        <td className="px-4 py-3">
                          {active ? (
                            <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 border border-green-200 flex items-center gap-1 w-fit">
                              <Play className="h-3 w-3" />Active
                            </span>
                          ) : d.is_paused ? (
                            <span className="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700 border border-yellow-200 flex items-center gap-1 w-fit">
                              <Pause className="h-3 w-3" />Paused
                            </span>
                          ) : !eligible ? (
                            <span className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700 border border-orange-200 flex items-center gap-1 w-fit">
                              <Clock className="h-3 w-3" />Cooldown
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 border border-gray-200 flex items-center gap-1 w-fit">
                              <UserX className="h-3 w-3" />Inactive
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-bold text-foreground">{d.total_donations || 0}</span>
                          {d.total_donations >= 10 && <span className="ml-1">🏅</span>}
                          {d.total_donations >= 5 && d.total_donations < 10 && <span className="ml-1">⭐</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
