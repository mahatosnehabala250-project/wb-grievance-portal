import { NextResponse } from 'next/server';

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

// Mock data simulating Airtable records for West Bengal blocks
const MOCK_COMPLAINTS: AirtableComplaint[] = [
  { id: 'rec1', fields: { IssueType: 'Water Supply', Block: 'Krishnanagar', Status: 'Resolved', Urgency: 'High', CreatedAt: '2025-01-15' } },
  { id: 'rec2', fields: { IssueType: 'Road Damage', Block: 'Ranaghat', Status: 'Open', Urgency: 'Critical', CreatedAt: '2025-01-18' } },
  { id: 'rec3', fields: { IssueType: 'Electricity', Block: 'Kalyani', Status: 'In Progress', Urgency: 'High', CreatedAt: '2025-01-20' } },
  { id: 'rec4', fields: { IssueType: 'Sanitation', Block: 'Shantipur', Status: 'Open', Urgency: 'Medium', CreatedAt: '2025-01-22' } },
  { id: 'rec5', fields: { IssueType: 'Water Supply', Block: 'Chakdaha', Status: 'Resolved', Urgency: 'Critical', CreatedAt: '2025-01-23' } },
  { id: 'rec6', fields: { IssueType: 'Healthcare', Block: 'Haringhata', Status: 'In Progress', Urgency: 'High', CreatedAt: '2025-01-25' } },
  { id: 'rec7', fields: { IssueType: 'Road Damage', Block: 'Krishnanagar', Status: 'Open', Urgency: 'Medium', CreatedAt: '2025-01-26' } },
  { id: 'rec8', fields: { IssueType: 'Education', Block: 'Ranaghat', Status: 'Resolved', Urgency: 'Low', CreatedAt: '2025-01-27' } },
  { id: 'rec9', fields: { IssueType: 'Electricity', Block: 'Kalyani', Status: 'Open', Urgency: 'Critical', CreatedAt: '2025-01-28' } },
  { id: 'rec10', fields: { IssueType: 'Sanitation', Block: 'Chakdaha', Status: 'Resolved', Urgency: 'High', CreatedAt: '2025-01-29' } },
  { id: 'rec11', fields: { IssueType: 'Water Supply', Block: 'Shantipur', Status: 'In Progress', Urgency: 'Critical', CreatedAt: '2025-01-30' } },
  { id: 'rec12', fields: { IssueType: 'Road Damage', Block: 'Haringhata', Status: 'Open', Urgency: 'High', CreatedAt: '2025-02-01' } },
  { id: 'rec13', fields: { IssueType: 'Healthcare', Block: 'Krishnanagar', Status: 'Resolved', Urgency: 'Medium', CreatedAt: '2025-02-02' } },
  { id: 'rec14', fields: { IssueType: 'Electricity', Block: 'Ranaghat', Status: 'Open', Urgency: 'High', CreatedAt: '2025-02-03' } },
  { id: 'rec15', fields: { IssueType: 'Sanitation', Block: 'Kalyani', Status: 'Resolved', Urgency: 'Low', CreatedAt: '2025-02-04' } },
  { id: 'rec16', fields: { IssueType: 'Education', Block: 'Chakdaha', Status: 'Open', Urgency: 'Critical', CreatedAt: '2025-02-05' } },
  { id: 'rec17', fields: { IssueType: 'Water Supply', Block: 'Haringhata', Status: 'In Progress', Urgency: 'Medium', CreatedAt: '2025-02-06' } },
  { id: 'rec18', fields: { IssueType: 'Road Damage', Block: 'Shantipur', Status: 'Resolved', Urgency: 'High', CreatedAt: '2025-02-07' } },
  { id: 'rec19', fields: { IssueType: 'Healthcare', Block: 'Ranaghat', Status: 'Open', Urgency: 'Critical', CreatedAt: '2025-02-08' } },
  { id: 'rec20', fields: { IssueType: 'Electricity', Block: 'Krishnanagar', Status: 'Resolved', Urgency: 'High', CreatedAt: '2025-02-09' } },
  { id: 'rec21', fields: { IssueType: 'Sanitation', Block: 'Kalyani', Status: 'Open', Urgency: 'Medium', CreatedAt: '2025-02-10' } },
  { id: 'rec22', fields: { IssueType: 'Water Supply', Block: 'Chakdaha', Status: 'In Progress', Urgency: 'High', CreatedAt: '2025-02-11' } },
  { id: 'rec23', fields: { IssueType: 'Road Damage', Block: 'Haringhata', Status: 'Resolved', Urgency: 'Critical', CreatedAt: '2025-02-12' } },
  { id: 'rec24', fields: { IssueType: 'Healthcare', Block: 'Shantipur', Status: 'Open', Urgency: 'Medium', CreatedAt: '2025-02-13' } },
  { id: 'rec25', fields: { IssueType: 'Education', Block: 'Krishnanagar', Status: 'In Progress', Urgency: 'High', CreatedAt: '2025-02-14' } },
  { id: 'rec26', fields: { IssueType: 'Electricity', Block: 'Ranaghat', Status: 'Resolved', Urgency: 'Low', CreatedAt: '2025-02-15' } },
  { id: 'rec27', fields: { IssueType: 'Sanitation', Block: 'Kalyani', Status: 'Open', Urgency: 'Critical', CreatedAt: '2025-02-16' } },
  { id: 'rec28', fields: { IssueType: 'Water Supply', Block: 'Chakdaha', Status: 'Resolved', Urgency: 'High', CreatedAt: '2025-02-17' } },
  { id: 'rec29', fields: { IssueType: 'Road Damage', Block: 'Haringhata', Status: 'In Progress', Urgency: 'Medium', CreatedAt: '2025-02-18' } },
  { id: 'rec30', fields: { IssueType: 'Healthcare', Block: 'Shantipur', Status: 'Resolved', Urgency: 'Critical', CreatedAt: '2025-02-19' } },
  { id: 'rec31', fields: { IssueType: 'Education', Block: 'Krishnanagar', Status: 'Open', Urgency: 'High', CreatedAt: '2025-02-20' } },
  { id: 'rec32', fields: { IssueType: 'Electricity', Block: 'Ranaghat', Status: 'In Progress', Urgency: 'Medium', CreatedAt: '2025-02-21' } },
  { id: 'rec33', fields: { IssueType: 'Sanitation', Block: 'Kalyani', Status: 'Resolved', Urgency: 'High', CreatedAt: '2025-02-22' } },
  { id: 'rec34', fields: { IssueType: 'Water Supply', Block: 'Chakdaha', Status: 'Open', Urgency: 'Critical', CreatedAt: '2025-02-23' } },
  { id: 'rec35', fields: { IssueType: 'Road Damage', Block: 'Haringhata', Status: 'Resolved', Urgency: 'High', CreatedAt: '2025-02-24' } },
  { id: 'rec36', fields: { IssueType: 'Healthcare', Block: 'Shantipur', Status: 'Open', Urgency: 'Medium', CreatedAt: '2025-02-25' } },
  { id: 'rec37', fields: { IssueType: 'Education', Block: 'Krishnanagar', Status: 'Resolved', Urgency: 'Low', CreatedAt: '2025-02-26' } },
  { id: 'rec38', fields: { IssueType: 'Electricity', Block: 'Ranaghat', Status: 'Open', Urgency: 'Critical', CreatedAt: '2025-02-27' } },
  { id: 'rec39', fields: { IssueType: 'Sanitation', Block: 'Kalyani', Status: 'In Progress', Urgency: 'High', CreatedAt: '2025-02-28' } },
  { id: 'rec40', fields: { IssueType: 'Water Supply', Block: 'Chakdaha', Status: 'Resolved', Urgency: 'Medium', CreatedAt: '2025-03-01' } },
  { id: 'rec41', fields: { IssueType: 'Road Damage', Block: 'Haringhata', Status: 'Open', Urgency: 'High', CreatedAt: '2025-03-02' } },
  { id: 'rec42', fields: { IssueType: 'Healthcare', Block: 'Shantipur', Status: 'Resolved', Urgency: 'Critical', CreatedAt: '2025-03-03' } },
  { id: 'rec43', fields: { IssueType: 'Education', Block: 'Krishnanagar', Status: 'In Progress', Urgency: 'Medium', CreatedAt: '2025-03-04' } },
  { id: 'rec44', fields: { IssueType: 'Electricity', Block: 'Ranaghat', Status: 'Resolved', Urgency: 'High', CreatedAt: '2025-03-05' } },
  { id: 'rec45', fields: { IssueType: 'Sanitation', Block: 'Kalyani', Status: 'Open', Urgency: 'Critical', CreatedAt: '2025-03-06' } },
  { id: 'rec46', fields: { IssueType: 'Water Supply', Block: 'Chakdaha', Status: 'In Progress', Urgency: 'High', CreatedAt: '2025-03-07' } },
  { id: 'rec47', fields: { IssueType: 'Road Damage', Block: 'Haringhata', Status: 'Resolved', Urgency: 'Medium', CreatedAt: '2025-03-08' } },
  { id: 'rec48', fields: { IssueType: 'Healthcare', Block: 'Shantipur', Status: 'Open', Urgency: 'High', CreatedAt: '2025-03-09' } },
  { id: 'rec49', fields: { IssueType: 'Education', Block: 'Krishnanagar', Status: 'Resolved', Urgency: 'Critical', CreatedAt: '2025-03-10' } },
  { id: 'rec50', fields: { IssueType: 'Electricity', Block: 'Ranaghat', Status: 'Open', Urgency: 'Medium', CreatedAt: '2025-03-11' } },
];

export async function GET() {
  try {
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
    const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

    let complaints: AirtableComplaint[];

    if (AIRTABLE_BASE_ID && AIRTABLE_API_KEY) {
      // Fetch from real Airtable
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Complaints?maxRecords=100&sort[0][field]=CreatedAt&sort[0][direction]=desc`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        next: { revalidate: 300 }, // Cache for 5 minutes
      });

      if (!response.ok) {
        throw new Error(`Airtable API error: ${response.status}`);
      }

      const data = await response.json();
      complaints = data.records;
    } else {
      // Use mock data for demo
      complaints = MOCK_COMPLAINTS;
    }

    // Compute stats
    const totalComplaints = complaints.length;
    const criticalIssues = complaints.filter(
      (c) => c.fields.Urgency === 'Critical'
    ).length;

    // Count resolved today
    const today = new Date().toISOString().split('T')[0];
    const resolvedToday = complaints.filter(
      (c) => c.fields.Status === 'Resolved' && c.fields.CreatedAt === today
    ).length;

    // Group complaints by block
    const blockMap: Record<string, number> = {};
    complaints.forEach((c) => {
      const block = c.fields.Block;
      blockMap[block] = (blockMap[block] || 0) + 1;
    });
    const complaintsByBlock = Object.entries(blockMap)
      .map(([block, count]) => ({ block, count }))
      .sort((a, b) => b.count - a.count);

    // Get latest 10 complaints (sorted by date desc)
    const latestComplaints = [...complaints]
      .sort(
        (a, b) =>
          new Date(b.fields.CreatedAt).getTime() -
          new Date(a.fields.CreatedAt).getTime()
      )
      .slice(0, 10)
      .map((c) => ({
        id: c.id,
        issueType: c.fields.IssueType,
        block: c.fields.Block,
        status: c.fields.Status,
        urgency: c.fields.Urgency,
        createdAt: c.fields.CreatedAt,
      }));

    // Group by issue type for additional stats
    const issueTypeMap: Record<string, number> = {};
    complaints.forEach((c) => {
      const type = c.fields.IssueType;
      issueTypeMap[type] = (issueTypeMap[type] || 0) + 1;
    });
    const complaintsByIssueType = Object.entries(issueTypeMap)
      .map(([issueType, count]) => ({ issueType, count }))
      .sort((a, b) => b.count - a.count);

    // Status breakdown
    const statusMap: Record<string, number> = {};
    complaints.forEach((c) => {
      const status = c.fields.Status;
      statusMap[status] = (statusMap[status] || 0) + 1;
    });
    const statusBreakdown = Object.entries(statusMap).map(
      ([status, count]) => ({ status, count })
    );

    return NextResponse.json({
      stats: {
        totalComplaints,
        criticalIssues,
        resolvedToday,
        totalResolved: complaints.filter(
          (c) => c.fields.Status === 'Resolved'
        ).length,
        openIssues: complaints.filter((c) => c.fields.Status === 'Open').length,
        inProgress: complaints.filter((c) => c.fields.Status === 'In Progress')
          .length,
      },
      complaintsByBlock,
      complaintsByIssueType,
      statusBreakdown,
      latestComplaints,
    });
  } catch (error) {
    console.error('Error fetching complaints:', error);
    return NextResponse.json(
      { error: 'Failed to fetch complaints data' },
      { status: 500 }
    );
  }
}
