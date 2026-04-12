'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  LayoutDashboard,
  Shield,
  TrendingUp,
  Activity,
  RefreshCw,
  Building2,
  ChevronRight,
  MapPin,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

// --- Types ---
interface DashboardStats {
  totalComplaints: number;
  criticalIssues: number;
  resolvedToday: number;
  totalResolved: number;
  openIssues: number;
  inProgress: number;
}

interface BlockData {
  block: string;
  count: number;
}

interface IssueTypeData {
  issueType: string;
  count: number;
}

interface StatusData {
  status: string;
  count: number;
}

interface Complaint {
  id: string;
  issueType: string;
  block: string;
  status: string;
  urgency: string;
  createdAt: string;
}

interface DashboardData {
  stats: DashboardStats;
  complaintsByBlock: BlockData[];
  complaintsByIssueType: IssueTypeData[];
  statusBreakdown: StatusData[];
  latestComplaints: Complaint[];
}

// --- Color Palette ---
const GOV_BLUE = '#1565C0';
const GOV_BLUE_LIGHT = '#42A5F5';
const GOV_BLUE_DARK = '#0D47A1';
const GOV_NAVY = '#0A2463';
const GOV_WHITE = '#FFFFFF';
const GOV_GRAY_LIGHT = '#F5F7FA';
const GOV_GRAY = '#E8ECF0';
const GOV_TEXT = '#1A2332';
const GOV_TEXT_SECONDARY = '#5A6B7F';

const PIE_COLORS = ['#22C55E', '#F59E0B', '#EF4444', '#3B82F6', '#8B5CF6'];

const CHART_CONFIG = {
  complaints: { label: 'Complaints', color: GOV_BLUE },
};

// --- Helper: Status Badge ---
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { className: string }> = {
    Open: { className: 'bg-red-100 text-red-800 border-red-200' },
    'In Progress': { className: 'bg-amber-100 text-amber-800 border-amber-200' },
    Resolved: { className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  };
  const v = variants[status] || { className: 'bg-gray-100 text-gray-800 border-gray-200' };
  return (
    <Badge variant="outline" className={v.className}>
      {status}
    </Badge>
  );
}

// --- Helper: Urgency Badge ---
function UrgencyBadge({ urgency }: { urgency: string }) {
  const variants: Record<string, { className: string; icon: React.ReactNode }> = {
    Critical: {
      className: 'bg-red-500 text-white border-red-600',
      icon: <AlertTriangle className="h-3 w-3 mr-1" />,
    },
    High: {
      className: 'bg-orange-100 text-orange-800 border-orange-300',
      icon: <AlertTriangle className="h-3 w-3 mr-1" />,
    },
    Medium: {
      className: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      icon: <Clock className="h-3 w-3 mr-1" />,
    },
    Low: {
      className: 'bg-blue-100 text-blue-800 border-blue-300',
      icon: <Clock className="h-3 w-3 mr-1" />,
    },
  };
  const v = variants[urgency] || variants.Medium;
  return (
    <Badge variant="outline" className={v.className}>
      {v.icon}
      {urgency}
    </Badge>
  );
}

// --- Stat Card ---
function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  trendLabel,
  color,
  bgColor,
  loading,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  trend?: string;
  trendLabel?: string;
  color: string;
  bgColor: string;
  loading?: boolean;
}) {
  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300 overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <p className="text-sm font-medium text-[#5A6B7F] uppercase tracking-wider">
              {title}
            </p>
            {loading ? (
              <Skeleton className="h-10 w-24" />
            ) : (
              <>
                <p className="text-3xl font-bold text-[#1A2332]">{value}</p>
                {trend && trendLabel && (
                  <div className="flex items-center gap-1 text-xs">
                    <TrendingUp
                      className="h-3 w-3"
                      style={{ color }}
                    />
                    <span style={{ color }} className="font-medium">
                      {trend}
                    </span>
                    <span className="text-[#5A6B7F]">{trendLabel}</span>
                  </div>
                )}
              </>
            )}
          </div>
          <div
            className="flex items-center justify-center rounded-xl p-3"
            style={{ backgroundColor: bgColor }}
          >
            <Icon className="h-6 w-6" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Loading Skeleton for Chart ---
function ChartSkeleton() {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-2 h-[300px] px-4">
          {[40, 65, 50, 80, 55, 70, 45, 60, 75, 85, 55, 90].map((h, i) => (
            <Skeleton
              key={i}
              className="w-full rounded-t-md flex-shrink-0"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Table Skeleton ---
function TableSkeleton() {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-72" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Custom pie label ---
function renderCustomLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
}) {
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      className="text-xs font-bold"
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

// --- Main Dashboard ---
export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/complaints');
      if (!response.ok) throw new Error('Failed to fetch data');
      const result = await response.json();
      setData(result);
      setLastUpdated(new Date());
    } catch (err) {
      setError('Unable to load complaint data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: GOV_GRAY_LIGHT }}>
      {/* ===== HEADER ===== */}
      <header
        className="sticky top-0 z-50 shadow-md"
        style={{
          background: `linear-gradient(135deg, ${GOV_NAVY} 0%, ${GOV_BLUE_DARK} 50%, ${GOV_BLUE} 100%)`,
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-18">
            {/* Left: Logo & Title */}
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm p-2">
                <Shield className="h-6 w-6 sm:h-7 sm:w-7 text-white" />
              </div>
              <div>
                <h1 className="text-white font-bold text-base sm:text-lg leading-tight">
                  West Bengal Grievance Portal
                </h1>
                <p className="text-blue-200 text-xs hidden sm:block">
                  District Administration Dashboard
                </p>
              </div>
            </div>

            {/* Center: Nav (desktop only) */}
            <nav className="hidden md:flex items-center gap-1">
              {[
                { label: 'Dashboard', icon: LayoutDashboard, active: true },
                { label: 'Analytics', icon: TrendingUp },
                { label: 'Reports', icon: FileText },
              ].map((item) => (
                <button
                  key={item.label}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    item.active
                      ? 'bg-white/20 text-white'
                      : 'text-blue-100 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              ))}
            </nav>

            {/* Right: Refresh & Status */}
            <div className="flex items-center gap-2 sm:gap-3">
              {lastUpdated && (
                <span className="text-blue-200 text-xs hidden lg:block">
                  Updated {lastUpdated.toLocaleTimeString()}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchData}
                disabled={loading}
                className="text-white hover:bg-white/15 transition-colors"
              >
                <RefreshCw
                  className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
                />
                <span className="hidden sm:inline ml-2 text-xs">Refresh</span>
              </Button>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-400/30">
                <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-300 text-xs font-medium hidden sm:inline">
                  Live
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ===== MAIN CONTENT ===== */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {/* Page Title */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold" style={{ color: GOV_TEXT }}>
              Complaints Overview
            </h2>
            <p className="text-sm mt-1" style={{ color: GOV_TEXT_SECONDARY }}>
              Monitor and manage citizen grievances across all blocks
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm" style={{ color: GOV_TEXT_SECONDARY }}>
            <MapPin className="h-4 w-4" />
            <span>Nadia District, West Bengal</span>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
              <p className="text-red-700 text-sm">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchData}
                className="ml-auto border-red-200 text-red-700 hover:bg-red-100"
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ===== KPI STAT CARDS ===== */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          <StatCard
            title="Total Complaints"
            value={data?.stats.totalComplaints ?? '—'}
            icon={FileText}
            trend="+12%"
            trendLabel="from last month"
            color={GOV_BLUE}
            bgColor="#E3F2FD"
            loading={loading}
          />
          <StatCard
            title="Critical Issues"
            value={data?.stats.criticalIssues ?? '—'}
            icon={AlertTriangle}
            trend="-5%"
            trendLabel="from last week"
            color="#EF4444"
            bgColor="#FEF2F2"
            loading={loading}
          />
          <StatCard
            title="Resolved Today"
            value={data?.stats.resolvedToday ?? '—'}
            icon={CheckCircle2}
            trend="+23%"
            trendLabel="efficiency rate"
            color="#22C55E"
            bgColor="#F0FDF4"
            loading={loading}
          />
        </div>

        {/* ===== Secondary Stats Row ===== */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
          <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="flex items-center justify-center rounded-lg p-2.5 bg-blue-50">
                <Activity className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-[#5A6B7F] uppercase tracking-wider">
                  Open Issues
                </p>
                <p className="text-2xl font-bold text-[#1A2332]">
                  {loading ? <Skeleton className="h-7 w-12 inline-block" /> : data?.stats.openIssues ?? '—'}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="flex items-center justify-center rounded-lg p-2.5 bg-amber-50">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-[#5A6B7F] uppercase tracking-wider">
                  In Progress
                </p>
                <p className="text-2xl font-bold text-[#1A2332]">
                  {loading ? <Skeleton className="h-7 w-12 inline-block" /> : data?.stats.inProgress ?? '—'}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="flex items-center justify-center rounded-lg p-2.5 bg-emerald-50">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-[#5A6B7F] uppercase tracking-wider">
                  Total Resolved
                </p>
                <p className="text-2xl font-bold text-[#1A2332]">
                  {loading ? <Skeleton className="h-7 w-12 inline-block" /> : data?.stats.totalResolved ?? '—'}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ===== CHARTS ROW ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Bar Chart: Complaints by Block */}
          {loading || !data ? (
            <div className="lg:col-span-2">
              <ChartSkeleton />
            </div>
          ) : (
            <Card className="lg:col-span-2 border-0 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold text-[#1A2332] flex items-center gap-2">
                      <Building2 className="h-5 w-5 text-blue-600" />
                      Complaints by Block
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      Distribution of grievances across administrative blocks
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <ChartContainer config={CHART_CONFIG} className="h-[320px] w-full">
                  <BarChart
                    data={data.complaintsByBlock}
                    margin={{ top: 10, right: 10, left: -10, bottom: 30 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8ECF0" />
                    <XAxis
                      dataKey="block"
                      tick={{ fontSize: 11, fill: '#5A6B7F' }}
                      tickLine={false}
                      axisLine={{ stroke: '#E8ECF0' }}
                      angle={-35}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#5A6B7F' }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <ChartTooltip
                      cursor={{ fill: 'rgba(21, 101, 192, 0.08)' }}
                      content={<ChartTooltipContent />}
                    />
                    <Bar
                      dataKey="count"
                      name="Complaints"
                      fill={GOV_BLUE}
                      radius={[6, 6, 0, 0]}
                      maxBarSize={48}
                    />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}

          {/* Pie Chart: Status Breakdown */}
          {loading || !data ? (
            <ChartSkeleton />
          ) : (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-[#1A2332] flex items-center gap-2">
                  <Activity className="h-5 w-5 text-blue-600" />
                  Status Breakdown
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  Current status of all complaints
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-2">
                <ChartContainer
                  config={{
                    Open: { label: 'Open', color: '#EF4444' },
                    'In Progress': { label: 'In Progress', color: '#F59E0B' },
                    Resolved: { label: 'Resolved', color: '#22C55E' },
                  }}
                  className="h-[260px] w-full"
                >
                  <PieChart>
                    <Pie
                      data={data.statusBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="count"
                      nameKey="status"
                      label={renderCustomLabel}
                      labelLine={false}
                    >
                      {data.statusBreakdown.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                  </PieChart>
                </ChartContainer>
                <div className="flex flex-wrap justify-center gap-4 mt-2">
                  {data.statusBreakdown.map((item, i) => (
                    <div key={item.status} className="flex items-center gap-1.5 text-xs">
                      <div
                        className="h-2.5 w-2.5 rounded-sm"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="text-[#5A6B7F]">{item.status}</span>
                      <span className="font-semibold text-[#1A2332]">{item.count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ===== ISSUE TYPE DISTRIBUTION ===== */}
        {loading || !data ? (
          <ChartSkeleton />
        ) : (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-[#1A2332] flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-600" />
                Issue Type Distribution
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Breakdown of complaints by category
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {data.complaintsByIssueType.map((item) => {
                  const total = data.complaintsByIssueType.reduce((s, i) => s + i.count, 0);
                  const percentage = Math.round((item.count / total) * 100);
                  return (
                    <div
                      key={item.issueType}
                      className="p-4 rounded-xl bg-white border border-gray-100 hover:shadow-md transition-shadow cursor-default"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-[#5A6B7F]">
                          {item.issueType}
                        </span>
                        <span className="text-xs font-bold text-[#1A2332]">
                          {percentage}%
                        </span>
                      </div>
                      <p className="text-2xl font-bold" style={{ color: GOV_BLUE }}>
                        {item.count}
                      </p>
                      <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${percentage}%`,
                            background: `linear-gradient(90deg, ${GOV_BLUE}, ${GOV_BLUE_LIGHT})`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== LATEST COMPLAINTS TABLE ===== */}
        {loading || !data ? (
          <TableSkeleton />
        ) : (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-[#1A2332] flex items-center gap-2">
                    <FileText className="h-5 w-5 text-blue-600" />
                    Latest Complaints
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    Most recently filed citizen grievances
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-gray-200 text-[#5A6B7F] hover:bg-gray-50"
                >
                  View All
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-gray-100 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50/80 hover:bg-gray-50/80">
                      <TableHead className="text-xs font-semibold text-[#5A6B7F] uppercase tracking-wider h-11">
                        Issue Type
                      </TableHead>
                      <TableHead className="text-xs font-semibold text-[#5A6B7F] uppercase tracking-wider h-11">
                        Block
                      </TableHead>
                      <TableHead className="text-xs font-semibold text-[#5A6B7F] uppercase tracking-wider h-11">
                        Status
                      </TableHead>
                      <TableHead className="text-xs font-semibold text-[#5A6B7F] uppercase tracking-wider h-11">
                        Urgency
                      </TableHead>
                      <TableHead className="text-xs font-semibold text-[#5A6B7F] uppercase tracking-wider h-11 text-right">
                        Date
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.latestComplaints.map((complaint, index) => (
                      <TableRow
                        key={complaint.id}
                        className="hover:bg-blue-50/30 transition-colors border-b border-gray-50"
                      >
                        <TableCell className="py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="flex items-center justify-center rounded-lg w-8 h-8 text-xs font-bold text-white shrink-0"
                              style={{
                                background: `linear-gradient(135deg, ${GOV_BLUE}, ${GOV_BLUE_LIGHT})`,
                              }}
                            >
                              {index + 1}
                            </div>
                            <span className="font-medium text-sm text-[#1A2332]">
                              {complaint.issueType}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="py-3">
                          <span className="text-sm text-[#5A6B7F]">{complaint.block}</span>
                        </TableCell>
                        <TableCell className="py-3">
                          <StatusBadge status={complaint.status} />
                        </TableCell>
                        <TableCell className="py-3">
                          <UrgencyBadge urgency={complaint.urgency} />
                        </TableCell>
                        <TableCell className="py-3 text-right">
                          <span className="text-sm text-[#5A6B7F]">
                            {new Date(complaint.createdAt).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* ===== FOOTER ===== */}
      <footer
        className="mt-auto"
        style={{
          background: `linear-gradient(135deg, ${GOV_NAVY} 0%, ${GOV_BLUE_DARK} 100%)`,
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-5">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2 text-blue-200 text-xs">
              <Shield className="h-4 w-4" />
              <span>
                © {new Date().getFullYear()} Government of West Bengal — District Administration
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs text-blue-300">
              <span className="hover:text-white cursor-pointer transition-colors">Privacy Policy</span>
              <span className="hover:text-white cursor-pointer transition-colors">Terms of Use</span>
              <span className="hover:text-white cursor-pointer transition-colors">Contact Support</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
