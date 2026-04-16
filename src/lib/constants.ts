export const NAVY = '#0A2463';
export const NAVY_DARK = '#061539';

export const STATUS_MAP: Record<string, { label: string; dotColor: string; bg: string; text: string; border: string }> = {
  OPEN: { label: 'Open', dotColor: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800' },
  IN_PROGRESS: { label: 'In Progress', dotColor: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800' },
  RESOLVED: { label: 'Resolved', dotColor: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800' },
  REJECTED: { label: 'Rejected', dotColor: 'bg-gray-400', bg: 'bg-gray-50 dark:bg-gray-900/40', text: 'text-gray-600 dark:text-gray-400', border: 'border-gray-200 dark:border-gray-700' },
};

export const URGENCY_MAP: Record<string, { label: string; bg: string; text: string; border: string; icon: boolean }> = {
  CRITICAL: { label: 'Critical', bg: 'bg-red-600 dark:bg-red-700', text: 'text-white', border: 'border-red-700', icon: true },
  HIGH: { label: 'High', bg: 'bg-orange-50 dark:bg-orange-950/40', text: 'text-orange-700 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800', icon: true },
  MEDIUM: { label: 'Medium', bg: 'bg-yellow-50 dark:bg-yellow-950/40', text: 'text-yellow-700 dark:text-yellow-500', border: 'border-yellow-200 dark:border-yellow-800', icon: false },
  LOW: { label: 'Low', bg: 'bg-sky-50 dark:bg-sky-950/40', text: 'text-sky-700 dark:text-sky-400', border: 'border-sky-200 dark:border-sky-800', icon: false },
};

export const URGENCY_BORDER_MAP: Record<string, string> = {
  CRITICAL: '#DC2626', HIGH: '#EA580C', MEDIUM: '#D97706', LOW: '#0284C7',
};

export const ROLE_MAP: Record<string, string> = {
  ADMIN: 'Administrator', BLOCK: 'Block Level', DISTRICT: 'District Level', STATE: 'State Level',
};

export const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300',
  BLOCK: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  DISTRICT: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  STATE: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300',
};

export const CATEGORIES = [
  'Water Supply', 'Road Damage', 'Electricity', 'Sanitation',
  'Healthcare', 'Education', 'Public Transport', 'Agriculture', 'Housing', 'Other',
];

export const CATEGORY_COLORS: Record<string, string> = {
  'Water Supply': '#0284C7',
  'Road Damage': '#EA580C',
  'Electricity': '#D97706',
  'Sanitation': '#16A34A',
  'Healthcare': '#DC2626',
  'Education': '#7C3AED',
  'Public Transport': '#2563EB',
  'Agriculture': '#65A30D',
  'Housing': '#9333EA',
  'Other': '#6B7280',
};

// Urgency-based Notification Hierarchy (for n8n WF-3)
export const URGENCY_NOTIFICATION_MAP: Record<string, { label: string; targets: string[]; color: string; description: string }> = {
  CRITICAL: {
    label: 'Critical',
    targets: ['Block Officer', 'District Officer', 'District Head', 'Admin'],
    color: '#DC2626',
    description: 'All levels notified instantly — Block + District + Head + Admin',
  },
  HIGH: {
    label: 'High',
    targets: ['Block Officer', 'District Officer'],
    color: '#EA580C',
    description: 'Block + District Officer notified — fast action required',
  },
  MEDIUM: {
    label: 'Medium',
    targets: ['Block Officer'],
    color: '#D97706',
    description: 'Only Block Officer notified — standard processing',
  },
  LOW: {
    label: 'Low',
    targets: ['Block Officer'],
    color: '#0284C7',
    description: 'Only Block Officer notified — routine processing',
  },
};

// West Bengal Subdivision Map: District → Block → Subdivision
export const SUBDIVISION_MAP: Record<string, Record<string, string>> = {
  'Nadia': {
    'Krishnanagar': 'Krishnanagar Sadar',
    'Kaliganj': 'Tehatta',
    'Tehatta': 'Tehatta',
  },
  'North 24 Parganas': {
    'Barasat': 'Barasat',
    'Habra': 'Habra',
    'Dunlop': 'Barrackpore',
  },
  'Birbhum': {
    'Bolpur': 'Suri Sadar',
    'Rampurhat': 'Rampurhat',
  },
  'Darjeeling': {
    'Siliguri': 'Siliguri',
    'Kurseong': 'Kurseong',
  },
  'Cooch Behar': {
    'Dinhata': 'Dinhata',
    'Mathabhanga': 'Mathabhanga',
  },
};

export function getSubdivision(district: string, block: string): string {
  return SUBDIVISION_MAP[district]?.[block] || block;
}
