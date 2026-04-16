export interface Complaint {
  id: string;
  ticketNo: string;
  citizenName: string | null;
  phone: string | null;
  issue: string;
  category: string;
  village: string | null;
  block: string;
  subdivision: string | null;
  district: string;
  urgency: string;
  status: string;
  description: string | null;
  resolution: string | null;
  assignedToId: string | null;
  source: string;
  assignedOfficerName: string | null;
  n8nProcessed: boolean;
  escalatedAt: string | null;
  resolvedAt: string | null;
  satisfactionRating: number | null;
  createdAt: string;
  updatedAt: string;
  assignedUser?: { id: string; name: string; role: string } | null;
}

export interface ActivityLogEntry {
  id: string;
  complaintId: string;
  action: string;
  description: string;
  actorId: string | null;
  actorName: string | null;
  metadata: string | null;
  createdAt: string;
}

export interface AssignableUser {
  id: string;
  username: string;
  name: string;
  role: string;
  block: string;
  email: string | null;
  district: string | null;
  subdivision: string | null;
  whatsappPhone: string | null;
  telegramChatId: string | null;
  isDistrictHead: boolean;
  notifyVia: string;
}

export interface AppUser {
  id: string;
  username: string;
  name: string;
  role: string;
  block: string;
  email: string | null;
  district: string | null;
  subdivision: string | null;
  isActive: boolean;
  whatsappPhone: string | null;
  telegramChatId: string | null;
  isDistrictHead: boolean;
  notifyVia: string;
  createdAt: string;
}

export interface DashboardData {
  stats: {
    total: number; open: number; inProgress: number; resolved: number;
    rejected: number; critical: number; todayComplaints: number;
    todayResolved: number; resolutionRate: number; slaBreaches: number;
    avgSatisfaction: number | null; ratedCount: number;
  };
  satisfactionDistribution: Record<string, number>;
  byCategory: { category: string; count: number }[];
  byGroup: { name: string; count: number; open: number; inProgress: number; resolved: number; rejected: number }[];
  groupByField: string;
  monthlyTrend: { month: string; label: string; open: number; inProgress: number; resolved: number; total: number }[];
  byUrgency: { urgency: string; count: number }[];
  recent: Complaint[];
  criticalComplaints: Complaint[];
  openComplaints: Complaint[];
  userRole: string;
  userLocation: string;
}

export type ViewType = 'dashboard' | 'complaints' | 'users' | 'analytics' | 'settings' | 'audit' | 'systemStatus' | 'integrations' | 'deployment' | 'liveData' | 'n8n' | 'endpointHealth';

export interface AuditEntry {
  id: string; complaintId: string; ticketNo: string; action: string;
  description: string; actorName: string | null; createdAt: string;
}
