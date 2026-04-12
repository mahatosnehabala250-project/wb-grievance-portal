'use client';

import { useState, useEffect, useCallback } from 'react';
import { Trophy, Medal, Award, TrendingUp, MapPin, Building2, ChevronRight, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { motion } from 'framer-motion';
import { NAVY } from '@/lib/constants';
import { authHeaders } from '@/lib/helpers';
import { RoleBadge } from '@/components/common';

interface Officer {
  id: string;
  name: string;
  username: string;
  role: string;
  location: string;
  district: string | null;
  assigned: number;
  resolved: number;
  inProgress: number;
  open: number;
  resolutionRate: number;
}

interface LeaderboardProps {
  onViewAll?: () => void;
}

export function PerformanceLeaderboard({ onViewAll }: LeaderboardProps) {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/leaderboard', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setOfficers(json.leaderboard || []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);

  const top5 = officers.slice(0, 5);

  const getRankIcon = (index: number) => {
    if (index === 0) return <Trophy className="h-5 w-5 text-yellow-500" />;
    if (index === 1) return <Medal className="h-5 w-5 text-gray-400" />;
    if (index === 2) return <Award className="h-5 w-5 text-amber-600" />;
    return <span className="h-5 w-5 flex items-center justify-center text-xs font-bold text-muted-foreground">{index + 1}</span>;
  };

  const getRankBg = (index: number) => {
    if (index === 0) return 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200/50 dark:border-yellow-800/30';
    if (index === 1) return 'bg-gray-50 dark:bg-gray-900/20 border-gray-200/50 dark:border-gray-700/30';
    if (index === 2) return 'bg-orange-50 dark:bg-orange-950/20 border-orange-200/50 dark:border-orange-800/30';
    return '';
  };

  return (
    <Card className="premium-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${NAVY}, #1a3a7a)` }}>
              <TrendingUp className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold">Performance Leaderboard</CardTitle>
              <p className="text-[11px] text-muted-foreground">Top performing officers</p>
            </div>
          </div>
          {onViewAll && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onViewAll}>
              View All <ChevronRight className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-32 mb-1" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
            ))}
          </div>
        ) : top5.length > 0 ? (
          <div className="space-y-2">
            {top5.map((officer, idx) => (
              <motion.div
                key={officer.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.08, duration: 0.25 }}
                className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all hover:shadow-sm ${getRankBg(idx)}`}
              >
                {/* Rank */}
                <div className="shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-background shadow-sm">
                  {getRankIcon(idx)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold truncate">{officer.name}</p>
                    <RoleBadge role={officer.role} />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                    <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{officer.location}</span>
                    {officer.district && (
                      <span className="flex items-center gap-0.5"><Building2 className="h-3 w-3" />{officer.district}</span>
                    )}
                  </div>
                </div>

                {/* Stats + Rate */}
                <div className="text-right shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm font-black ${officer.resolutionRate >= 50 ? 'text-emerald-600' : officer.resolutionRate >= 25 ? 'text-amber-600' : 'text-red-600'}`}>
                      {officer.resolutionRate}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                    <span className="text-emerald-600">{officer.resolved} resolved</span>
                    <span>{officer.assigned} total</span>
                  </div>
                  <Progress value={officer.resolutionRate} className="h-1.5 mt-1.5 w-20"
                    style={{ '--progress-color': officer.resolutionRate >= 50 ? '#16A34A' : officer.resolutionRate >= 25 ? '#D97706' : '#DC2626' } as React.CSSProperties}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center">
            <Users className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No officer data available</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
