'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ─── Types ───

interface DonorProfile {
  id: string;
  phone: string;
  name: string;
  blood_group: string;
  gender: string;
  date_of_birth: string | null;
  weight_kg: number | null;
  district: string;
  block: string;
  last_donated_date: string | null;
  last_donation_type: string | null;
  next_eligible_date: string | null;
  is_available: boolean;
  is_paused: boolean;
  total_donations: number;
  total_offers_accepted: number;
  donations_this_year: number;
  deferral_until: string | null;
  deferral_reason: string | null;
  permanently_deferred: boolean;
  created_at: string;
}

interface DonationRecord {
  id: string;
  donated_date: string;
  donation_type: string;
  units: number;
  hospital: string;
  hemoglobin_level: number | null;
  certificate_url?: string | null;
}

// ─── Helpers ───

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getEligibilityBadge(profile: DonorProfile) {
  if (profile.permanently_deferred) {
    return <Badge variant="destructive">Permanently Deferred</Badge>;
  }
  if (profile.deferral_until && new Date(profile.deferral_until) > new Date()) {
    return <Badge variant="secondary">Deferred until {formatDate(profile.deferral_until)}</Badge>;
  }
  if (profile.is_paused) {
    return <Badge variant="outline">Paused</Badge>;
  }
  if (profile.next_eligible_date && new Date(profile.next_eligible_date) > new Date()) {
    return <Badge variant="secondary">Cooldown until {formatDate(profile.next_eligible_date)}</Badge>;
  }
  return <Badge className="bg-green-600 text-white">Eligible</Badge>;
}


// ─── Main Component ───

export default function DonorProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<DonorProfile | null>(null);
  const [donations, setDonations] = useState<DonationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    district: '',
    block: '',
    weight_kg: '',
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Pause toggle
  const [pauseLoading, setPauseLoading] = useState(false);

  // Self-defer form
  const [showDeferForm, setShowDeferForm] = useState(false);
  const [deferReason, setDeferReason] = useState('');
  const [deferDays, setDeferDays] = useState('14');
  const [deferLoading, setDeferLoading] = useState(false);
  const [deferError, setDeferError] = useState<string | null>(null);

  // ─── Auth helper ───
  const getToken = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('donor_token');
  }, []);

  const authHeaders = useCallback((): HeadersInit => {
    const token = getToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }, [getToken]);

  // ─── Fetch profile ───
  const fetchProfile = useCallback(async () => {
    const token = getToken();
    if (!token) {
      router.replace('/donor/login');
      return;
    }

    try {
      const res = await fetch('/api/blood-donors/me', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('donor_token');
        router.replace('/donor/login');
        return;
      }

      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Failed to load profile');
        return;
      }

      setProfile(data.data);
      setEditForm({
        name: data.data.name || '',
        district: data.data.district || '',
        block: data.data.block || '',
        weight_kg: data.data.weight_kg?.toString() || '',
      });
    } catch {
      setError('Server से connection नहीं हो पा रहा।');
    } finally {
      setLoading(false);
    }
  }, [getToken, router]);

  // ─── Fetch donation history ───
  const fetchDonations = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch('/api/blood-donors/me/donations', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.data)) {
          setDonations(data.data);
        }
      }
      // If endpoint doesn't exist yet (v1 mock), silently ignore
    } catch {
      // Silently ignore — donation history is optional for v1
    }
  }, [getToken]);

  useEffect(() => {
    fetchProfile();
    fetchDonations();
  }, [fetchProfile, fetchDonations]);

  // ─── Handle edit save ───
  const handleSaveProfile = async () => {
    setEditError(null);
    setEditLoading(true);

    const updates: Record<string, unknown> = {};
    if (editForm.name !== profile?.name) updates.name = editForm.name;
    if (editForm.district !== profile?.district) updates.district = editForm.district;
    if (editForm.block !== profile?.block) updates.block = editForm.block;
    if (editForm.weight_kg && Number(editForm.weight_kg) !== profile?.weight_kg) {
      updates.weight_kg = Number(editForm.weight_kg);
    }

    if (Object.keys(updates).length === 0) {
      setEditing(false);
      setEditLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/blood-donors/me', {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(updates),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setEditError(data.details?.join(', ') || data.error || 'Update failed');
        return;
      }

      // Refresh profile
      await fetchProfile();
      setEditing(false);
    } catch {
      setEditError('Server error. कृपया दोबारा प्रयास करें।');
    } finally {
      setEditLoading(false);
    }
  };

  // ─── Handle pause/resume toggle ───
  const handlePauseToggle = async () => {
    if (!profile) return;
    setPauseLoading(true);

    try {
      const res = await fetch('/api/blood-donors/me', {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ is_available: profile.is_paused }),
      });

      if (res.ok) {
        // Also update is_paused via the update-status endpoint
        const statusRes = await fetch('/api/blood-donors/update-status', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            donor_id: profile.id,
            command: profile.is_paused ? 'RESUME' : 'PAUSE',
          }),
        });

        if (statusRes.ok) {
          await fetchProfile();
        }
      }
    } catch {
      // Silently handle
    } finally {
      setPauseLoading(false);
    }
  };

  // ─── Handle self-deferral ───
  const handleSelfDefer = async () => {
    if (!profile || !deferReason) return;
    setDeferError(null);
    setDeferLoading(true);

    try {
      const res = await fetch('/api/blood-donors/defer', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          donor_id: profile.id,
          reason: deferReason,
          duration_days: Number(deferDays),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setDeferError(data.error || 'Deferral failed');
        return;
      }

      setShowDeferForm(false);
      setDeferReason('');
      setDeferDays('14');
      await fetchProfile();
    } catch {
      setDeferError('Server error. कृपया दोबारा प्रयास करें।');
    } finally {
      setDeferLoading(false);
    }
  };

  // ─── Handle logout ───
  const handleLogout = () => {
    localStorage.removeItem('donor_token');
    router.replace('/donor/login');
  };

  // ─── Loading state ───
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-red-50 to-white">
        <div className="text-center space-y-2">
          <div className="text-4xl animate-pulse">🩸</div>
          <p className="text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  // ─── Error state ───
  if (error || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-red-50 to-white px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center space-y-4">
            <p className="text-destructive">{error || 'Profile not found'}</p>
            <Button onClick={() => router.replace('/donor/login')}>Back to Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }


  // ─── Render ───
  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50 to-white px-4 py-6 pb-20">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">🩸 Donor Profile</h1>
            <p className="text-sm text-muted-foreground">JanSeva Rakta Sahayak</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Logout
          </Button>
        </div>

        {/* ─── Profile Info Card ─── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Personal Info</CardTitle>
              {!editing && (
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {editing ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-name">Name</Label>
                  <Input
                    id="edit-name"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="edit-district">District</Label>
                    <Input
                      id="edit-district"
                      value={editForm.district}
                      onChange={(e) => setEditForm({ ...editForm, district: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-block">Block</Label>
                    <Input
                      id="edit-block"
                      value={editForm.block}
                      onChange={(e) => setEditForm({ ...editForm, block: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-weight">Weight (kg)</Label>
                  <Input
                    id="edit-weight"
                    type="number"
                    min={45}
                    max={200}
                    value={editForm.weight_kg}
                    onChange={(e) => setEditForm({ ...editForm, weight_kg: e.target.value })}
                  />
                </div>

                {editError && (
                  <p className="text-sm text-destructive">{editError}</p>
                )}

                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={handleSaveProfile} disabled={editLoading}>
                    {editLoading ? 'Saving...' : 'Save'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(false);
                      setEditError(null);
                      setEditForm({
                        name: profile.name || '',
                        district: profile.district || '',
                        block: profile.block || '',
                        weight_kg: profile.weight_kg?.toString() || '',
                      });
                    }}
                    disabled={editLoading}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Name</span>
                  <p className="font-medium">{profile.name || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Blood Group</span>
                  <p className="font-medium">{profile.blood_group || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Gender</span>
                  <p className="font-medium capitalize">{profile.gender || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Date of Birth</span>
                  <p className="font-medium">{formatDate(profile.date_of_birth)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Weight</span>
                  <p className="font-medium">{profile.weight_kg ? `${profile.weight_kg} kg` : '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">District</span>
                  <p className="font-medium">{profile.district || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Block</span>
                  <p className="font-medium">{profile.block || '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Registered</span>
                  <p className="font-medium">{formatDate(profile.created_at)}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─── Eligibility & Status Card ─── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Eligibility Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Current Status</span>
              {getEligibilityBadge(profile)}
            </div>

            {profile.next_eligible_date && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Next Eligible Date</span>
                <span className="font-medium">{formatDate(profile.next_eligible_date)}</span>
              </div>
            )}

            {profile.deferral_until && new Date(profile.deferral_until) > new Date() && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Deferral Reason</span>
                <span className="font-medium capitalize">{profile.deferral_reason || '—'}</span>
              </div>
            )}

            {profile.last_donated_date && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Last Donation</span>
                <span className="font-medium">{formatDate(profile.last_donated_date)}</span>
              </div>
            )}

            {profile.last_donation_type && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Last Donation Type</span>
                <span className="font-medium capitalize">
                  {profile.last_donation_type.replace('_', ' ')}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─── Lifetime Stats Card ─── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Lifetime Stats</CardTitle>
            <CardDescription>Your contribution to saving lives</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-red-600">{profile.total_donations}</p>
                <p className="text-xs text-muted-foreground">Donations</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-orange-600">{profile.total_offers_accepted}</p>
                <p className="text-xs text-muted-foreground">Offers Accepted</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600">{profile.total_donations * 3}</p>
                <p className="text-xs text-muted-foreground">Lives Saved</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ─── Notifications Toggle ─── */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Notifications</p>
                <p className="text-xs text-muted-foreground">
                  {profile.is_paused
                    ? 'Paused — you will not receive blood request alerts'
                    : 'Active — you will receive blood request alerts'}
                </p>
              </div>
              <Switch
                checked={!profile.is_paused}
                onCheckedChange={handlePauseToggle}
                disabled={pauseLoading || profile.permanently_deferred}
              />
            </div>
          </CardContent>
        </Card>

        {/* ─── Self-Deferral Section ─── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Health Self-Report</CardTitle>
            <CardDescription>
              Report a temporary health condition to defer yourself
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!showDeferForm ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeferForm(true)}
                disabled={profile.permanently_deferred}
              >
                Report Health Condition
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="defer-reason">Reason</Label>
                  <Select value={deferReason} onValueChange={setDeferReason}>
                    <SelectTrigger id="defer-reason">
                      <SelectValue placeholder="Select reason" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="illness">Recent Illness (fever, cold, cough)</SelectItem>
                      <SelectItem value="surgery">Surgery / Medical Procedure</SelectItem>
                      <SelectItem value="pregnancy">Pregnancy / Breastfeeding</SelectItem>
                      <SelectItem value="tattoo">Tattoo / Piercing (last 6 months)</SelectItem>
                      <SelectItem value="vaccination">Recent Vaccination</SelectItem>
                      <SelectItem value="medication">Medication / Antibiotics</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="defer-days">Deferral Duration (days)</Label>
                  <Select value={deferDays} onValueChange={setDeferDays}>
                    <SelectTrigger id="defer-days">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="14">14 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                      <SelectItem value="90">90 days</SelectItem>
                      <SelectItem value="180">180 days (tattoo/piercing)</SelectItem>
                      <SelectItem value="365">1 year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {deferError && (
                  <p className="text-sm text-destructive">{deferError}</p>
                )}

                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleSelfDefer}
                    disabled={deferLoading || !deferReason}
                  >
                    {deferLoading ? 'Submitting...' : 'Submit Deferral'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowDeferForm(false);
                      setDeferError(null);
                    }}
                    disabled={deferLoading}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─── Donation History ─── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Donation History</CardTitle>
            <CardDescription>
              {donations.length > 0
                ? `${donations.length} donation${donations.length > 1 ? 's' : ''} recorded`
                : 'No donations recorded yet'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {donations.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Your donation history will appear here once recorded.
              </p>
            ) : (
              <div className="space-y-3">
                {donations.map((donation) => (
                  <div
                    key={donation.id}
                    className="flex items-center justify-between border rounded-lg p-3"
                  >
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">
                        {formatDate(donation.donated_date)}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {donation.donation_type.replace('_', ' ')} • {donation.hospital}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {donation.units} unit{donation.units > 1 ? 's' : ''}
                      </Badge>
                      {donation.certificate_url && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-7"
                          onClick={() => window.open(donation.certificate_url!, '_blank')}
                        >
                          📄 Certificate
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
