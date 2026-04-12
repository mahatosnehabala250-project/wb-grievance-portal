import { NextRequest, NextResponse } from 'next/server';

// Types matching Airtable schema
interface AirtableComplaint {
  id: string;
  fields: {
    IssueType: string;
    Block: string;
    Status: string;
    Urgency: string;
    CreatedAt: string;
  };
}

// Helper: get today's date string in YYYY-MM-DD format (IST)
function getTodayIST(): string {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return ist.toISOString().split('T')[0];
}

// Helper: get a date string N days ago
function daysAgo(n: number): string {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  ist.setDate(ist.getDate() - n);
  return ist.toISOString().split('T')[0];
}

// Mock data — includes recent dates so "Resolved Today" works
const TODAY = getTodayIST();
const YESTERDAY = daysAgo(1);
const TWO_DAYS_AGO = daysAgo(2);
const THREE_DAYS_AGO = daysAgo(3);

const MOCK_COMPLAINTS: AirtableComplaint[] = [
  // --- Today's complaints ---
  { id: 'rec1', fields: { IssueType: 'Water Supply', Block: 'Krishnanagar', Status: 'Resolved', Urgency: 'High', CreatedAt: TODAY } },
  { id: 'rec2', fields: { IssueType: 'Road Damage', Block: 'Ranaghat', Status: 'Open', Urgency: 'Critical', CreatedAt: TODAY } },
  { id: 'rec3', fields: { IssueType: 'Electricity', Block: 'Kalyani', Status: 'Resolved', Urgency: 'High', CreatedAt: TODAY } },
  { id: 'rec4', fields: { IssueType: 'Healthcare', Block: 'Shantipur', Status: 'In Progress', Urgency: 'Medium', CreatedAt: TODAY } },
  // --- Yesterday ---
  { id: 'rec5', fields: { IssueType: 'Sanitation', Block: 'Chakdaha', Status: 'Resolved', Urgency: 'Critical', CreatedAt: YESTERDAY } },
  { id: 'rec6', fields: { IssueType: 'Education', Block: 'Haringhata', Status: 'Open', Urgency: 'High', CreatedAt: YESTERDAY } },
  { id: 'rec7', fields: { IssueType: 'Water Supply', Block: 'Ranaghat', Status: 'Resolved', Urgency: 'Medium', CreatedAt: YESTERDAY } },
  { id: 'rec8', fields: { IssueType: 'Road Damage', Block: 'Krishnanagar', Status: 'In Progress', Urgency: 'High', CreatedAt: YESTERDAY } },
  // --- 2 days ago ---
  { id: 'rec9', fields: { IssueType: 'Electricity', Block: 'Kalyani', Status: 'Open', Urgency: 'Critical', CreatedAt: TWO_DAYS_AGO } },
  { id: 'rec10', fields: { IssueType: 'Sanitation', Block: 'Shantipur', Status: 'Resolved', Urgency: 'Low', CreatedAt: TWO_DAYS_AGO } },
  { id: 'rec11', fields: { IssueType: 'Healthcare', Block: 'Chakdaha', Status: 'Resolved', Urgency: 'High', CreatedAt: TWO_DAYS_AGO } },
  { id: 'rec12', fields: { IssueType: 'Water Supply', Block: 'Haringhata', Status: 'In Progress', Urgency: 'Critical', CreatedAt: TWO_DAYS_AGO } },
  // --- 3 days ago ---
  { id: 'rec13', fields: { IssueType: 'Road Damage', Block: 'Ranaghat', Status: 'Open', Urgency: 'High', CreatedAt: THREE_DAYS_AGO } },
  { id: 'rec14', fields: { IssueType: 'Education', Block: 'Krishnanagar', Status: 'Resolved', Urgency: 'Medium', CreatedAt: THREE_DAYS_AGO } },
  { id: 'rec15', fields: { IssueType: 'Electricity', Block: 'Kalyani', Status: 'Open', Urgency: 'Critical', CreatedAt: THREE_DAYS_AGO } },
  // --- Historical data (spread across months) ---
  { id: 'rec16', fields: { IssueType: 'Water Supply', Block: 'Shantipur', Status: 'Resolved', Urgency: 'High', CreatedAt: '2025-10-05' } },
  { id: 'rec17', fields: { IssueType: 'Road Damage', Block: 'Chakdaha', Status: 'Open', Urgency: 'Medium', CreatedAt: '2025-10-08' } },
  { id: 'rec18', fields: { IssueType: 'Electricity', Block: 'Haringhata', Status: 'In Progress', Urgency: 'High', CreatedAt: '2025-10-12' } },
  { id: 'rec19', fields: { IssueType: 'Sanitation', Block: 'Ranaghat', Status: 'Resolved', Urgency: 'Low', CreatedAt: '2025-10-15' } },
  { id: 'rec20', fields: { IssueType: 'Healthcare', Block: 'Krishnanagar', Status: 'Open', Urgency: 'Critical', CreatedAt: '2025-10-18' } },
  { id: 'rec21', fields: { IssueType: 'Water Supply', Block: 'Kalyani', Status: 'Resolved', Urgency: 'High', CreatedAt: '2025-10-22' } },
  { id: 'rec22', fields: { IssueType: 'Road Damage', Block: 'Shantipur', Status: 'Open', Urgency: 'Critical', CreatedAt: '2025-10-25' } },
  { id: 'rec23', fields: { IssueType: 'Education', Block: 'Chakdaha', Status: 'Resolved', Urgency: 'Medium', CreatedAt: '2025-10-28' } },
  { id: 'rec24', fields: { IssueType: 'Electricity', Block: 'Haringhata', Status: 'Open', Urgency: 'High', CreatedAt: '2025-11-02' } },
  { id: 'rec25', fields: { IssueType: 'Sanitation', Block: 'Ranaghat', Status: 'Resolved', Urgency: 'Low', CreatedAt: '2025-11-05' } },
  { id: 'rec26', fields: { IssueType: 'Healthcare', Block: 'Krishnanagar', Status: 'In Progress', Urgency: 'Critical', CreatedAt: '2025-11-08' } },
  { id: 'rec27', fields: { IssueType: 'Water Supply', Block: 'Kalyani', Status: 'Open', Urgency: 'High', CreatedAt: '2025-11-12' } },
  { id: 'rec28', fields: { IssueType: 'Road Damage', Block: 'Shantipur', Status: 'Resolved', Urgency: 'Medium', CreatedAt: '2025-11-15' } },
  { id: 'rec29', fields: { IssueType: 'Education', Block: 'Chakdaha', Status: 'Open', Urgency: 'High', CreatedAt: '2025-11-18' } },
  { id: 'rec30', fields: { IssueType: 'Electricity', Block: 'Haringhata', Status: 'Resolved', Urgency: 'Critical', CreatedAt: '2025-11-22' } },
  { id: 'rec31', fields: { IssueType: 'Sanitation', Block: 'Ranaghat', Status: 'In Progress', Urgency: 'Medium', CreatedAt: '2025-11-25' } },
  { id: 'rec32', fields: { IssueType: 'Healthcare', Block: 'Krishnanagar', Status: 'Open', Urgency: 'High', CreatedAt: '2025-11-28' } },
  { id: 'rec33', fields: { IssueType: 'Water Supply', Block: 'Kalyani', Status: 'Resolved', Urgency: 'Low', CreatedAt: '2025-12-02' } },
  { id: 'rec34', fields: { IssueType: 'Road Damage', Block: 'Shantipur', Status: 'Open', Urgency: 'Critical', CreatedAt: '2025-12-05' } },
  { id: 'rec35', fields: { IssueType: 'Education', Block: 'Chakdaha', Status: 'Resolved', Urgency: 'High', CreatedAt: '2025-12-08' } },
  { id: 'rec36', fields: { IssueType: 'Electricity', Block: 'Haringhata', Status: 'In Progress', Urgency: 'Medium', CreatedAt: '2025-12-12' } },
  { id: 'rec37', fields: { IssueType: 'Sanitation', Block: 'Ranaghat', Status: 'Resolved', Urgency: 'High', CreatedAt: '2025-12-15' } },
  { id: 'rec38', fields: { IssueType: 'Healthcare', Block: 'Krishnanagar', Status: 'Open', Urgency: 'Critical', CreatedAt: '2025-12-18' } },
  { id: 'rec39', fields: { IssueType: 'Water Supply', Block: 'Kalyani', Status: 'In Progress', Urgency: 'High', CreatedAt: '2025-12-22' } },
  { id: 'rec40', fields: { IssueType: 'Road Damage', Block: 'Shantipur', Status: 'Resolved', Urgency: 'Medium', CreatedAt: '2025-12-25' } },
  { id: 'rec41', fields: { IssueType: 'Education', Block: 'Chakdaha', Status: 'Open', Urgency: 'High', CreatedAt: '2025-12-28' } },
  { id: 'rec42', fields: { IssueType: 'Electricity', Block: 'Haringhata', Status: 'Resolved', Urgency: 'Low', CreatedAt: '2026-01-02' } },
  { id: 'rec43', fields: { IssueType: 'Sanitation', Block: 'Ranaghat', Status: 'Open', Urgency: 'Critical', CreatedAt: '2026-01-05' } },
  { id: 'rec44', fields: { IssueType: 'Healthcare', Block: 'Krishnanagar', Status: 'In Progress', Urgency: 'High', CreatedAt: '2026-01-08' } },
  { id: 'rec45', fields: { IssueType: 'Water Supply', Block: 'Kalyani', Status: 'Resolved', Urgency: 'Medium', CreatedAt: '2026-01-12' } },
  { id: 'rec46', fields: { IssueType: 'Road Damage', Block: 'Shantipur', Status: 'Open', Urgency: 'High', CreatedAt: '2026-01-15' } },
  { id: 'rec47', fields: { IssueType: 'Education', Block: 'Chakdaha', Status: 'Resolved', Urgency: 'Critical', CreatedAt: '2026-01-18' } },
  { id: 'rec48', fields: { IssueType: 'Electricity', Block: 'Haringhata', Status: 'In Progress', Urgency: 'Medium', CreatedAt: '2026-01-22' } },
  { id: 'rec49', fields: { IssueType: 'Sanitation', Block: 'Ranaghat', Status: 'Resolved', Urgency: 'High', CreatedAt: '2026-01-25' } },
  { id: 'rec50', fields: { IssueType: 'Healthcare', Block: 'Krishnanagar', Status: 'Open', Urgency: 'Critical', CreatedAt: '2026-01-28' } },
  { id: 'rec51', fields: { IssueType: 'Water Supply', Block: 'Kalyani', Status: 'In Progress', Urgency: 'High', CreatedAt: '2026-02-02' } },
  { id: 'rec52', fields: { IssueType: 'Road Damage', Block: 'Shantipur', Status: 'Resolved', Urgency: 'Medium', CreatedAt: '2026-02-05' } },
  { id: 'rec53', fields: { IssueType: 'Education', Block: 'Chakdaha', Status: 'Open', Urgency: 'High', CreatedAt: '2026-02-08' } },
  { id: 'rec54', fields: { IssueType: 'Electricity', Block: 'Haringhata', Status: 'Resolved', Urgency: 'Low', CreatedAt: '2026-02-12' } },
  { id: 'rec55', fields: { IssueType: 'Sanitation', Block: 'Ranaghat', Status: 'Open', Urgency: 'Critical', CreatedAt: '2026-02-15' } },
  { id: 'rec56', fields: { IssueType: 'Healthcare', Block: 'Krishnanagar', Status: 'In Progress', Urgency: 'High', CreatedAt: '2026-02-18' } },
  { id: 'rec57', fields: { IssueType: 'Water Supply', Block: 'Kalyani', Status: 'Resolved', Urgency: 'Medium', CreatedAt: '2026-02-22' } },
  { id: 'rec58', fields: { IssueType: 'Road Damage', Block: 'Shantipur', Status: 'Open', Urgency: 'High', CreatedAt: '2026-02-25' } },
  { id: 'rec59', fields: { IssueType: 'Education', Block: 'Chakdaha', Status: 'Resolved', Urgency: 'Critical', CreatedAt: '2026-03-02' } },
  { id: 'rec60', fields: { IssueType: 'Electricity', Block: 'Haringhata', Status: 'In Progress', Urgency: 'Medium', CreatedAt: '2026-03-05' } },
];

// Shared function to get complaints data
async function getComplaints(): Promise<AirtableComplaint[]> {
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

  if (AIRTABLE_BASE_ID && AIRTABLE_API_KEY) {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Complaints?maxRecords=100&sort[0][field]=CreatedAt&sort[0][direction]=desc`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 300 },
    });
    if (!response.ok) throw new Error(`Airtable API error: ${response.status}`);
    const data = await response.json();
    return data.records as AirtableComplaint[];
  }
  return MOCK_COMPLAINTS;
}

// Helper: monthly trend
function getMonthlyTrend(complaints: AirtableComplaint[]) {
  const monthMap: Record<string, { open: number; resolved: number; critical: number }> = {};
  complaints.forEach((c) => {
    const date = new Date(c.fields.CreatedAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthMap[key]) monthMap[key] = { open: 0, resolved: 0, critical: 0 };
    if (c.fields.Status === 'Open') monthMap[key].open++;
    if (c.fields.Status === 'Resolved') monthMap[key].resolved++;
    if (c.fields.Urgency === 'Critical') monthMap[key].critical++;
  });
  return Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, counts]) => ({
      month,
      label: new Date(month + '-01').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
      ...counts,
      total: counts.open + counts.resolved + counts.critical,
    }));
}

// Helper: unique filter options
function getFilterOptions(complaints: AirtableComplaint[]) {
  const blocks = [...new Set(complaints.map((c) => c.fields.Block))].sort();
  const statuses = [...new Set(complaints.map((c) => c.fields.Status))].sort();
  const urgencies = ['Critical', 'High', 'Medium', 'Low'];
  const issueTypes = [...new Set(complaints.map((c) => c.fields.IssueType))].sort();
  return { blocks, statuses, urgencies, issueTypes };
}

// Helper: block-wise breakdown for radar chart
function getBlockBreakdown(complaints: AirtableComplaint[]) {
  const map: Record<string, { open: number; resolved: number; critical: number; inProgress: number }> = {};
  complaints.forEach((c) => {
    const b = c.fields.Block;
    if (!map[b]) map[b] = { open: 0, resolved: 0, critical: 0, inProgress: 0 };
    if (c.fields.Status === 'Open') map[b].open++;
    if (c.fields.Status === 'Resolved') map[b].resolved++;
    if (c.fields.Urgency === 'Critical') map[b].critical++;
    if (c.fields.Status === 'In Progress') map[b].inProgress++;
  });
  return Object.entries(map).map(([block, counts]) => ({
    block,
    ...counts,
    total: counts.open + counts.resolved + counts.critical + counts.inProgress,
  }));
}

// ========================
// GET handler
// ========================
export async function GET(request: NextRequest) {
  try {
    const complaints = await getComplaints();
    const { searchParams } = new URL(request.url);

    const filterBlock = searchParams.get('block');
    const filterStatus = searchParams.get('status');
    const filterUrgency = searchParams.get('urgency');
    const filterIssueType = searchParams.get('issueType');
    const filterSearch = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '10');

    let filtered = [...complaints];

    if (filterBlock) filtered = filtered.filter((c) => c.fields.Block === filterBlock);
    if (filterStatus) filtered = filtered.filter((c) => c.fields.Status === filterStatus);
    if (filterUrgency) filtered = filtered.filter((c) => c.fields.Urgency === filterUrgency);
    if (filterIssueType) filtered = filtered.filter((c) => c.fields.IssueType === filterIssueType);
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.fields.IssueType.toLowerCase().includes(q) ||
          c.fields.Block.toLowerCase().includes(q) ||
          c.fields.Status.toLowerCase().includes(q)
      );
    }

    const totalComplaints = filtered.length;
    const criticalIssues = filtered.filter((c) => c.fields.Urgency === 'Critical').length;
    const today = getTodayIST();
    const resolvedToday = filtered.filter(
      (c) => c.fields.Status === 'Resolved' && c.fields.CreatedAt === today
    ).length;

    // Group by block
    const blockMap: Record<string, number> = {};
    filtered.forEach((c) => { blockMap[c.fields.Block] = (blockMap[c.fields.Block] || 0) + 1; });
    const complaintsByBlock = Object.entries(blockMap).map(([block, count]) => ({ block, count })).sort((a, b) => b.count - a.count);

    // Group by issue type
    const issueTypeMap: Record<string, number> = {};
    filtered.forEach((c) => { issueTypeMap[c.fields.IssueType] = (issueTypeMap[c.fields.IssueType] || 0) + 1; });
    const complaintsByIssueType = Object.entries(issueTypeMap).map(([issueType, count]) => ({ issueType, count })).sort((a, b) => b.count - a.count);

    // Status breakdown
    const statusMap: Record<string, number> = {};
    filtered.forEach((c) => { statusMap[c.fields.Status] = (statusMap[c.fields.Status] || 0) + 1; });
    const statusBreakdown = Object.entries(statusMap).map(([status, count]) => ({ status, count }));

    const monthlyTrend = getMonthlyTrend(filtered);
    const blockBreakdown = getBlockBreakdown(filtered);

    // Paginated complaints
    const sorted = [...filtered].sort(
      (a, b) => new Date(b.fields.CreatedAt).getTime() - new Date(a.fields.CreatedAt).getTime()
    );
    const totalFiltered = sorted.length;
    const paginatedComplaints = sorted
      .slice((page - 1) * pageSize, page * pageSize)
      .map((c) => ({
        id: c.id,
        issueType: c.fields.IssueType,
        block: c.fields.Block,
        status: c.fields.Status,
        urgency: c.fields.Urgency,
        createdAt: c.fields.CreatedAt,
      }));

    const totalResolved = filtered.filter((c) => c.fields.Status === 'Resolved').length;
    const openIssues = filtered.filter((c) => c.fields.Status === 'Open').length;
    const inProgress = filtered.filter((c) => c.fields.Status === 'In Progress').length;
    const resolutionRate = totalComplaints > 0 ? Math.round((totalResolved / totalComplaints) * 100) : 0;
    const avgResolutionDays = 3.8;

    const filterOptions = getFilterOptions(complaints);

    return NextResponse.json({
      stats: { totalComplaints, criticalIssues, resolvedToday, totalResolved, openIssues, inProgress, resolutionRate, avgResolutionDays },
      complaintsByBlock,
      complaintsByIssueType,
      statusBreakdown,
      monthlyTrend,
      blockBreakdown,
      latestComplaints: paginatedComplaints,
      pagination: { page, pageSize, total: totalFiltered, totalPages: Math.ceil(totalFiltered / pageSize) },
      filterOptions,
      activeFilters: { block: filterBlock || null, status: filterStatus || null, urgency: filterUrgency || null, issueType: filterIssueType || null, search: filterSearch || null },
    });
  } catch (error) {
    console.error('Error fetching complaints:', error);
    return NextResponse.json({ error: 'Failed to fetch complaints data' }, { status: 500 });
  }
}

// ========================
// POST handler — New Complaint
// ========================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { issueType, block, urgency } = body;

    // Validate
    if (!issueType || !block || !urgency) {
      return NextResponse.json({ error: 'Missing required fields: issueType, block, urgency' }, { status: 400 });
    }
    const validIssueTypes = ['Water Supply', 'Road Damage', 'Electricity', 'Sanitation', 'Healthcare', 'Education'];
    const validBlocks = ['Krishnanagar', 'Ranaghat', 'Kalyani', 'Shantipur', 'Chakdaha', 'Haringhata'];
    const validUrgencies = ['Low', 'Medium', 'High', 'Critical'];

    if (!validIssueTypes.includes(issueType)) {
      return NextResponse.json({ error: `Invalid issueType. Must be one of: ${validIssueTypes.join(', ')}` }, { status: 400 });
    }
    if (!validBlocks.includes(block)) {
      return NextResponse.json({ error: `Invalid block. Must be one of: ${validBlocks.join(', ')}` }, { status: 400 });
    }
    if (!validUrgencies.includes(urgency)) {
      return NextResponse.json({ error: `Invalid urgency. Must be one of: ${validUrgencies.join(', ')}` }, { status: 400 });
    }

    // Create new complaint
    const today = getTodayIST();
    const newComplaint: AirtableComplaint = {
      id: `rec${Date.now()}`,
      fields: {
        IssueType: issueType,
        Block: block,
        Status: 'Open',
        Urgency: urgency,
        CreatedAt: today,
      },
    };

    // If Airtable is configured, push to Airtable
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
    const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
    if (AIRTABLE_BASE_ID && AIRTABLE_API_KEY) {
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Complaints`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: newComplaint.fields }),
      });
      if (!response.ok) throw new Error(`Airtable API error: ${response.status}`);
      const data = await response.json();
      newComplaint.id = data.id;
    } else {
      // Append to mock data
      MOCK_COMPLAINTS.unshift(newComplaint);
    }

    return NextResponse.json({
      success: true,
      complaint: {
        id: newComplaint.id,
        issueType: newComplaint.fields.IssueType,
        block: newComplaint.fields.Block,
        status: newComplaint.fields.Status,
        urgency: newComplaint.fields.Urgency,
        createdAt: newComplaint.fields.CreatedAt,
      },
    });
  } catch (error) {
    console.error('Error creating complaint:', error);
    return NextResponse.json({ error: 'Failed to create complaint' }, { status: 500 });
  }
}
