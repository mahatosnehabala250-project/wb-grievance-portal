export interface Complaint {
  id: string;
  ticketNo: string;
  citizenName: string | null;
  phone: string | null;
  issue: string;
  category: string;
  block: string;
  district: string;
  urgency: string;
  status: string;
  description: string | null;
  resolution: string | null;
  assignedToId: string | null;
  source: string;
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
  location: string;
  district: string | null;
}

export interface AppUser {
  id: string;
  username: string;
  name: string;
  role: string;
  location: string;
  district: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface DashboardData {
  stats: {
    total: number; open: number; inProgress: number; resolved: number;
    rejected: number; critical: number; todayComplaints: number;
    todayResolved: number; resolutionRate: number; slaBreaches: number;
  };
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

export type ViewType = 'dashboard' | 'complaints' | 'users' | 'analytics' | 'settings' | 'audit' | 'systemStatus' | 'integrations' | 'deployment' | 'liveData';

export interface AuditEntry {
  id: string; complaintId: string; ticketNo: string; action: string;
  description: string; actorName: string | null; createdAt: string;
}
