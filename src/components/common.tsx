'use client';

import { motion } from 'framer-motion';
import { AlertTriangle, FileText, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { NAVY, STATUS_MAP, URGENCY_MAP, ROLE_COLORS } from '@/lib/constants';
import { fmtRole } from '@/lib/helpers';
import { useCountUp } from '@/hooks/useCountUp';

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] || STATUS_MAP.OPEN;
  return (
    <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }}>
      <Badge variant="outline" className={`text-[11px] font-semibold px-2 py-0.5 gap-1 ${s.bg} ${s.text} ${s.border}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${s.dotColor}`} />
        {s.label}
      </Badge>
    </motion.div>
  );
}

export function UrgencyBadge({ urgency }: { urgency: string }) {
  const u = URGENCY_MAP[urgency] || URGENCY_MAP.MEDIUM;
  return (
    <Badge variant="outline" className={`text-[11px] font-semibold px-2 py-0.5 ${u.bg} ${u.text} ${u.border}`}>
      {u.icon && <AlertTriangle className="h-3 w-3 mr-0.5" />}
      {u.label}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[role] || 'bg-gray-100 text-gray-600'}`}>
      {fmtRole(role)}
    </span>
  );
}

export function StatCard({ title, value, icon: Icon, color, bgColor, delay = 0, suffix = '', trend = 0 }: {
  title: string; value: number; icon: React.ElementType; color: string; bgColor: string; delay?: number; suffix?: string; trend?: number;
}) {
  const display = useCountUp(value, 700, delay);
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: delay / 1000 }}>
      <Card className="border-0 shadow-sm hover:shadow-lg hover:scale-[1.02] transition-all duration-300 overflow-hidden group relative border-l-4" style={{ borderLeftColor: color, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 3px rgba(0,0,0,0.08)' }}>
        {/* Gradient accent bar at top */}
        <div className="h-[3px] w-full" style={{ background: `linear-gradient(90deg, ${color}, ${color}88, transparent)` }} />
        <CardContent className="p-5 pl-6 relative">
          {/* Watermark icon - large faded background */}
          <div className="absolute top-2 right-2 opacity-[0.04] pointer-events-none">
            <Icon className="h-16 w-16" style={{ color }} />
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 flex-1 min-w-0">
              <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
              <div className="flex items-center gap-1.5">
                <p className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
                  {display}{suffix}
                </p>
                {trend !== 0 && (
                  <span className={`flex items-center text-xs font-bold ${trend > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {trend > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                    {Math.abs(trend)}%
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-center rounded-xl p-3 group-hover:scale-110 transition-transform duration-300" style={{ backgroundColor: bgColor }}>
              <Icon className="h-5 w-5" style={{ color }} />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function MiniStat({ label, value, icon: Icon, color, bgColor, delay, suffix = '' }: {
  label: string; value: number; icon: React.ElementType; color: string; bgColor: string; delay: number; suffix?: string;
}) {
  const display = useCountUp(value, 600, delay);
  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-all">
      <CardContent className="p-3 sm:p-4 flex items-center gap-3">
        <div className="flex items-center justify-center rounded-lg p-2 shrink-0" style={{ backgroundColor: bgColor }}>
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
        <div className="min-w-0">
          <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
          <p className="text-lg sm:text-xl font-black tabular-nums text-foreground">{display}{suffix}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: {
  cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number;
}) {
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  return (
    <text x={cx + r * Math.cos(-midAngle * RADIAN)} y={cy + r * Math.sin(-midAngle * RADIAN)}
      fill="white" textAnchor="middle" dominantBaseline="central" className="text-[11px] font-bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export function LoadingSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
        <span className="text-xs font-medium text-muted-foreground">Loading...</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[120px] rounded-xl bg-muted overflow-hidden relative">
            <div className="absolute inset-0 shimmer-bg" style={{ animationDelay: `${i * 150}ms` }} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="h-[300px] rounded-xl bg-muted overflow-hidden relative shimmer-bg lg:col-span-2" />
        <div className="h-[300px] rounded-xl bg-muted overflow-hidden relative shimmer-bg" style={{ animationDelay: '200ms' }} />
      </div>
    </div>
  );
}

export function EmptyState({ message, icon: Icon, action, onAction }: { message: string; icon?: React.ElementType; action?: string; onAction?: () => void }) {
  const Ic = Icon || FileText;
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 3, ease: 'easeInOut', repeat: Infinity }}
        className="mb-4"
      >
        <div className="h-16 w-16 rounded-full flex items-center justify-center border-2 border-dashed border-muted-foreground/20" style={{ background: 'linear-gradient(135deg, #E3F2FD, #F3E8FF, #FEF3C7)' }}>
          <Ic className="h-8 w-8" style={{ color: NAVY }} />
        </div>
      </motion.div>
      <p className="text-muted-foreground text-sm font-medium max-w-xs">{message}</p>
      {action && onAction && (
        <Button variant="outline" size="sm" className="mt-4 text-xs gap-1.5" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}
