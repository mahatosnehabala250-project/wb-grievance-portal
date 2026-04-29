export const NAVY = '#0A2463';
export const NAVY_DARK = '#061539';

export const STATUS_MAP: Record<string, { label: string; dotColor: string; bg: string; text: string; border: string }> = {
  // Legacy / portal-created statuses
  OPEN:        { label: 'Open',        dotColor: 'bg-red-500',    bg: 'bg-red-50 dark:bg-red-950/40',     text: 'text-red-700 dark:text-red-400',     border: 'border-red-200 dark:border-red-800' },
  IN_PROGRESS: { label: 'In Progress', dotColor: 'bg-amber-500',  bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800' },
  RESOLVED:    { label: 'Resolved',    dotColor: 'bg-emerald-500',bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800' },
  REJECTED:    { label: 'Rejected',    dotColor: 'bg-gray-400',   bg: 'bg-gray-50 dark:bg-gray-900/40',   text: 'text-gray-600 dark:text-gray-400',   border: 'border-gray-200 dark:border-gray-700' },
  // n8n / WhatsApp pipeline statuses
  REGISTERED:  { label: 'Registered',  dotColor: 'bg-blue-400',   bg: 'bg-blue-50 dark:bg-blue-950/40',   text: 'text-blue-700 dark:text-blue-400',   border: 'border-blue-200 dark:border-blue-800' },
  ASSIGNED:    { label: 'Assigned',    dotColor: 'bg-violet-500', bg: 'bg-violet-50 dark:bg-violet-950/40',text: 'text-violet-700 dark:text-violet-400',border: 'border-violet-200 dark:border-violet-800' },
  CLOSED:      { label: 'Closed',      dotColor: 'bg-slate-400',  bg: 'bg-slate-50 dark:bg-slate-900/40', text: 'text-slate-600 dark:text-slate-400', border: 'border-slate-200 dark:border-slate-700' },
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

// Categories — must match DB values (set by n8n JS-02 triage)
export const CATEGORIES = [
  // Infrastructure
  'WATER', 'ELECTRICITY', 'ROAD', 'SANITATION',
  // Health & social
  'HEALTH', 'RATION', 'PENSION', 'HOUSING',
  // Education & scholarship
  'EDUCATION', 'SCHOLARSHIP',
  // WB flagship schemes
  'KANYASHREE', 'LAKSHMIR_BHANDAR', 'YUVASATHI',
  'KRISHAK_BANDHU', 'SWASTHYA_SATHI', 'RUPASHREE',
  'STUDENT_CREDIT_CARD', 'SABOOJ_SATHI', 'SHRAMSHREE', 'YUVASHREE',
  // Land & law
  'LAND', 'LAW_ORDER',
  // Other
  'OTHER',
];

// Human-readable labels for categories
export const CATEGORY_LABELS: Record<string, string> = {
  // Infrastructure
  WATER:              'Water Supply',
  ELECTRICITY:        'Electricity',
  ROAD:               'Road / Bridge',
  SANITATION:         'Sanitation / Drainage',
  // Health & social
  HEALTH:             'Healthcare',
  RATION:             'Ration / PDS',
  PENSION:            'Pension',
  HOUSING:            'Housing',
  // Education
  EDUCATION:          'Education',
  SCHOLARSHIP:        'Scholarship',
  // WB schemes
  KANYASHREE:         'Kanyashree',
  LAKSHMIR_BHANDAR:   'Lakshmir Bhandar',
  YUVASATHI:          'Banglar Yuva Sathi',
  KRISHAK_BANDHU:     'Krishak Bandhu',
  SWASTHYA_SATHI:     'Swasthya Sathi',
  RUPASHREE:          'Rupashree',
  STUDENT_CREDIT_CARD:'Student Credit Card',
  SABOOJ_SATHI:       'Sabooj Sathi (Cycle)',
  SHRAMSHREE:         'Shramshree',
  YUVASHREE:          'Yuvashree',
  // Land & law
  LAND:               'Land / Revenue',
  LAW_ORDER:          'Law & Order',
  OTHER:              'Other',
};

export const CATEGORY_COLORS: Record<string, string> = {
  WATER: '#0284C7', ELECTRICITY: '#D97706', ROAD: '#EA580C',
  SANITATION: '#16A34A', HEALTH: '#DC2626', RATION: '#2563EB',
  PENSION: '#65A30D', HOUSING: '#9333EA', EDUCATION: '#7C3AED',
  SCHOLARSHIP: '#0891B2', LAND: '#C2410C', LAW_ORDER: '#1D4ED8',
  KANYASHREE: '#DB2777', LAKSHMIR_BHANDAR: '#BE185D',
  YUVASATHI: '#7C3AED', KRISHAK_BANDHU: '#15803D',
  SWASTHYA_SATHI: '#0F766E', RUPASHREE: '#C026D3',
  STUDENT_CREDIT_CARD: '#1D4ED8', SABOOJ_SATHI: '#16A34A',
  SHRAMSHREE: '#B45309', YUVASHREE: '#6D28D9',
  OTHER: '#6B7280',
};

// All 23 West Bengal districts with their blocks
// Exact 23 official WB districts (alphabetical) with all blocks
// DB ticket codes: ALI BAN BIR COO DAK DAR HOO HOW JAL JHA KAL KOL MAL MUR NAD NOR PWB PWM PEB PEM PUR SOU UTD
export const WB_DISTRICTS: Record<string, string[]> = {
  'Alipurduar': [
    'Alipurduar I', 'Alipurduar II', 'Falakata', 'Kalchini',
    'Kumargram', 'Madarihat-Birpara',
  ],
  'Bankura': [
    'Bankura I', 'Bankura II', 'Barjora', 'Bishnupur', 'Chhatna',
    'Gangajalghati', 'Hirbandh', 'Indas', 'Indpur', 'Kotulpur',
    'Mejia', 'Onda', 'Patrasaer', 'Raipur', 'Saltora',
    'Sonamukhi', 'Taldangra', 'Vishnupur',
  ],
  'Birbhum': [
    'Bolpur-Sriniketan', 'Dubrajpur', 'Khoyrasol', 'Labpur',
    'Mohammad Bazar', 'Murarai I', 'Murarai II', 'Nalhati I',
    'Nalhati II', 'Rajnagar', 'Rampurhat I', 'Rampurhat II',
    'Sainthia', 'Suri I', 'Suri II',
  ],
  'Cooch Behar': [
    'Cooch Behar I', 'Cooch Behar II', 'Dinhata I', 'Dinhata II',
    'Mathabhanga I', 'Mathabhanga II', 'Mekhliganj', 'Sitalkuchi',
    'Sitai', 'Tufanganj I', 'Tufanganj II',
  ],
  'Dakshin Dinajpur': [
    'Balurghat', 'Bansihari', 'Buniadpur', 'Gangarampur',
    'Harirampur', 'Kushmandi', 'Tapan',
  ],
  'Darjeeling': [
    'Darjeeling', 'Jorebunglow-Sukhiapokhri', 'Kharibari',
    'Kurseong', 'Matigara', 'Mirik', 'Naxalbari',
    'Phansidewa', 'Rangli-Rangliot', 'Siliguri',
  ],
  'Hooghly': [
    'Arambagh', 'Balagarh', 'Chanditala I', 'Chanditala II',
    'Chinsurah-Magra', 'Dhaniakhali', 'Goghat I', 'Goghat II',
    'Haripal', 'Jangipara', 'Khanakul I', 'Khanakul II',
    'Pandua', 'Polba-Dadpur', 'Pursurah', 'Serampore-Uttarpara',
    'Singur', 'Tarakeswar',
  ],
  'Howrah': [
    'Amta I', 'Amta II', 'Bagnan I', 'Bagnan II', 'Bally-Jagachha',
    'Domjur', 'Jagatballavpur', 'Panchla', 'Sankrail',
    'Shyampur I', 'Shyampur II', 'Udaynarayanpur',
    'Uluberia I', 'Uluberia II',
  ],
  'Jalpaiguri': [
    'Dhupguri', 'Jalpaiguri', 'Maynaguri', 'Mal',
    'Nagrakata', 'Rajganj',
  ],
  'Jhargram': [
    'Binpur I', 'Binpur II', 'Gopiballavpur I', 'Gopiballavpur II',
    'Jamboni', 'Jhargram', 'Nayagram', 'Sankrail',
  ],
  'Kalimpong': [
    'Gorubathan', 'Kalimpong I', 'Kalimpong II',
  ],
  'Kolkata': [
    'Kolkata',
  ],
  'Malda': [
    'Bamongola', 'Chanchal I', 'Chanchal II', 'English Bazar',
    'Gazole', 'Habibpur', 'Harischandrapur I', 'Harischandrapur II',
    'Kaliachak I', 'Kaliachak II', 'Kaliachak III', 'Manikchak',
    'Old Malda', 'Ratua I', 'Ratua II',
  ],
  'Murshidabad': [
    'Bahrampur', 'Beldanga I', 'Beldanga II', 'Bharatpur I',
    'Bharatpur II', 'Domkal', 'Hariharpara', 'Jalangi',
    'Jiaganj-Azimganj', 'Kandi', 'Khargram', 'Lalgola',
    'Murshidabad-Jiaganj', 'Nabagram', 'Nowda',
    'Raghunathganj I', 'Raghunathganj II', 'Raninagar I',
    'Raninagar II', 'Sagardighi', 'Samserganj', 'Suti I', 'Suti II',
  ],
  'Nadia': [
    'Chapra', 'Hanskhali', 'Haringhata', 'Kaliganj',
    'Karimpur I', 'Karimpur II', 'Krishnanagar I', 'Krishnanagar II',
    'Nakashipara', 'Ranaghat I', 'Ranaghat II', 'Santipur',
    'Tehatta I', 'Tehatta II',
  ],
  'North 24 Parganas': [
    'Amdanga', 'Baduria', 'Bagdah', 'Barasat I', 'Barasat II',
    'Barrackpore', 'Bongaon', 'Deganga', 'Gaighata', 'Gobardanga',
    'Habra I', 'Habra II', 'Haroa', 'Hasnabad', 'Hingalganj',
    'Minakhan', 'Rajarhat', 'Sandeshkhali I', 'Sandeshkhali II',
    'Swarupnagar',
  ],
  'Paschim Bardhaman': [
    'Andal', 'Asansol', 'Barabani', 'Faridpur-Durgapur',
    'Jamuria', 'Kanksa', 'Ondal', 'Pandabeswar', 'Raniganj', 'Salanpur',
  ],
  'Paschim Medinipur': [
    'Chandrakona I', 'Chandrakona II', 'Daspur I', 'Daspur II',
    'Debra', 'Garbeta I', 'Garbeta II', 'Garbeta III', 'Ghatal',
    'Keshpur', 'Kharagpur I', 'Kharagpur II', 'Medinipur Sadar',
    'Narayangarh', 'Pingla', 'Sabang', 'Salbani',
  ],
  'Purba Bardhaman': [
    'Bardhaman Sadar North', 'Bardhaman Sadar South', 'Bhatar',
    'Budbud', 'Galsi I', 'Galsi II', 'Jamalpur', 'Kalna I', 'Kalna II',
    'Katwa I', 'Katwa II', 'Ketugram I', 'Ketugram II', 'Khandaghosh',
    'Mangalkote', 'Memari I', 'Memari II', 'Monteswar',
    'Purbasthali I', 'Purbasthali II', 'Raina I', 'Raina II',
  ],
  'Purba Medinipur': [
    'Bhagabanpur I', 'Bhagabanpur II', 'Contai I', 'Contai II',
    'Contai III', 'Deshapran', 'Egra I', 'Egra II', 'Haldia',
    'Khejuri I', 'Khejuri II', 'Mahishadal', 'Moyna', 'Nandakumar',
    'Nandigram I', 'Nandigram II', 'Panskura', 'Patashpur I',
    'Patashpur II', 'Ramnagar I', 'Ramnagar II', 'Sutahata', 'Tamluk',
  ],
  'Purulia': [
    'Arsha', 'Baghmundi', 'Balarampur', 'Barabazar', 'Bundwan',
    'Hura', 'Joypur', 'Jhalda I', 'Jhalda II', 'Kashipur',
    'Manbazar I', 'Manbazar II', 'Neturia', 'Para', 'Puncha',
    'Purulia I', 'Purulia II', 'Raghunathpur I', 'Raghunathpur II', 'Santuri',
  ],
  'South 24 Parganas': [
    'Baruipur', 'Basanti', 'Bhangar I', 'Bhangar II',
    'Bishnupur I', 'Bishnupur II', 'Budge Budge I', 'Budge Budge II',
    'Canning I', 'Canning II', 'Diamond Harbour I', 'Diamond Harbour II',
    'Falta', 'Gosaba', 'Jaynagar I', 'Jaynagar II', 'Kultali',
    'Kulpi', 'Magrahat I', 'Magrahat II', 'Mandirbazar',
    'Mathurapur I', 'Mathurapur II', 'Mograhat I', 'Mograhat II',
    'Namkhana', 'Pathar Pratima', 'Sagar',
  ],
  'Uttar Dinajpur': [
    'Chopra', 'Goalpokhar I', 'Goalpokhar II', 'Hemtabad',
    'Islampur', 'Itahar', 'Karandighi', 'Raiganj',
  ],
};

// Flat list of all 23 official WB districts for dropdowns (already alphabetical)
export const WB_DISTRICT_LIST = Object.keys(WB_DISTRICTS);

export const SOURCE_MAP: Record<string, { label: string; icon: string; color: string }> = {
  WHATSAPP: { label: 'WhatsApp', icon: 'MessageCircle', color: '#25D366' },
  WEB: { label: 'Web Portal', icon: 'Globe', color: '#0284C7' },
  MANUAL: { label: 'Manual Entry', icon: 'ClipboardList', color: '#7C3AED' },
};

export const ACTION_MAP: Record<string, { label: string; color: string }> = {
  CREATED: { label: 'Created', color: '#0284C7' },
  STATUS_CHANGED: { label: 'Status Changed', color: '#2563EB' },
  ASSIGNED: { label: 'Assigned', color: '#7C3AED' },
  UNASSIGNED: { label: 'Unassigned', color: '#6B7280' },
  ESCALATED: { label: 'Escalated', color: '#DC2626' },
  RESOLVED: { label: 'Resolved', color: '#16A34A' },
  REJECTED: { label: 'Rejected', color: '#9333EA' },
  REOPENED: { label: 'Reopened', color: '#D97706' },
};

export const NOTIFY_VIA_MAP: Record<string, { label: string }> = {
  whatsapp: { label: 'WhatsApp' },
  telegram: { label: 'Telegram' },
  both: { label: 'Both' },
  none: { label: 'None' },
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
  'Purulia': {
    'Manbazar I': 'Manbazar', 'Manbazar II': 'Manbazar', 'Purulia I': 'Purulia Sadar',
    'Purulia II': 'Purulia Sadar', 'Jhalda I': 'Raghunathpur', 'Jhalda II': 'Raghunathpur',
    'Raghunathpur I': 'Raghunathpur', 'Raghunathpur II': 'Raghunathpur',
    'Arsha': 'Purulia Sadar', 'Bagmundi': 'Purulia Sadar', 'Barabazar': 'Manbazar',
    'Bandwan': 'Manbazar', 'Hura': 'Raghunathpur', 'Kashipur': 'Raghunathpur',
    'Neturia': 'Raghunathpur', 'Para': 'Purulia Sadar', 'Santuri': 'Raghunathpur',
    'Puncha': 'Manbazar', 'Balarampur': 'Raghunathpur',
  },
  'Nadia': {
    'Krishnanagar I': 'Krishnanagar Sadar', 'Krishnanagar II': 'Krishnanagar Sadar',
    'Kaliganj': 'Tehatta', 'Tehatta I': 'Tehatta', 'Tehatta II': 'Tehatta',
    'Ranaghat I': 'Ranaghat', 'Ranaghat II': 'Ranaghat',
    'Santipur': 'Ranaghat', 'Karimpur I': 'Tehatta', 'Karimpur II': 'Tehatta',
    'Hanskhali': 'Ranaghat', 'Haringhata': 'Ranaghat', 'Chapra': 'Krishnanagar Sadar',
    'Nakasipara': 'Krishnanagar Sadar', 'Nakashipara': 'Krishnanagar Sadar',
  },
  'North 24 Parganas': {
    'Barasat I': 'Barasat', 'Barasat II': 'Barasat', 'Habra I': 'Habra',
    'Habra II': 'Habra', 'Bongaon': 'Bongaon', 'Baduria': 'Bongaon',
    'Deganga': 'Barasat', 'Rajarhat': 'Barasat', 'Barrackpore': 'Barrackpore',
    'Gaighata': 'Bongaon', 'Gobardanga': 'Bongaon', 'Amdanga': 'Barasat',
    'Bagdah': 'Bongaon', 'Haroa': 'Barasat', 'Hasnabad': 'Basirhat',
    'Hingalganj': 'Basirhat', 'Minakhan': 'Basirhat', 'Sandeshkhali I': 'Basirhat',
    'Sandeshkhali II': 'Basirhat', 'Swarupnagar': 'Basirhat',
  },
  'South 24 Parganas': {
    'Baruipur': 'Baruipur', 'Diamond Harbour I': 'Diamond Harbour',
    'Diamond Harbour II': 'Diamond Harbour', 'Canning I': 'Canning',
    'Canning II': 'Canning', 'Basanti': 'Canning', 'Gosaba': 'Canning',
    'Kultali': 'Baruipur', 'Jaynagar I': 'Baruipur', 'Jaynagar II': 'Baruipur',
    'Mathurapur I': 'Diamond Harbour', 'Mathurapur II': 'Diamond Harbour',
    'Sagar': 'Kakdwip', 'Namkhana': 'Kakdwip', 'Pathar Pratima': 'Kakdwip',
  },
  'Darjeeling': {
    'Siliguri': 'Siliguri', 'Kurseong': 'Kurseong', 'Darjeeling': 'Sadar',
    'Naxalbari': 'Siliguri', 'Kharibari': 'Siliguri', 'Matigara': 'Siliguri',
    'Phansidewa': 'Siliguri', 'Mirik': 'Kurseong', 'Jorebunglow-Sukhiapokhri': 'Sadar',
  },
  'Cooch Behar': {
    'Dinhata I': 'Dinhata', 'Dinhata II': 'Dinhata', 'Mathabhanga I': 'Mathabhanga',
    'Mathabhanga II': 'Mathabhanga', 'Cooch Behar I': 'Sadar', 'Cooch Behar II': 'Sadar',
    'Mekhliganj': 'Mekhliganj', 'Sitalkuchi': 'Mathabhanga', 'Sitai': 'Mathabhanga',
    'Tufanganj I': 'Tufanganj', 'Tufanganj II': 'Tufanganj',
  },
  'Birbhum': {
    'Bolpur-Sriniketan': 'Suri Sadar', 'Rampurhat I': 'Rampurhat', 'Rampurhat II': 'Rampurhat',
    'Suri I': 'Suri Sadar', 'Suri II': 'Suri Sadar', 'Nalhati I': 'Rampurhat',
    'Nalhati II': 'Rampurhat', 'Murarai I': 'Rampurhat', 'Murarai II': 'Rampurhat',
    'Dubrajpur': 'Suri Sadar', 'Khoyrasol': 'Suri Sadar', 'Labpur': 'Suri Sadar',
    'Mohammad Bazar': 'Suri Sadar', 'Rajnagar': 'Suri Sadar', 'Sainthia': 'Rampurhat',
  },
};

export function getSubdivision(district: string, block: string): string {
  return SUBDIVISION_MAP[district]?.[block] || block;
}

// Citizen profile — location only, name is ALWAYS asked fresh
// Saved: village, block, district, language
// NOT saved: name (privacy — family shares one number)
export const CITIZEN_PROFILE_FIELDS = ['village', 'block', 'district', 'language'] as const;
