import { NextResponse } from 'next/server';

interface Announcement {
  id: string;
  type: 'info' | 'warning' | 'success' | 'error';
  title: string;
  message: string;
  timestamp: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

const announcements: Announcement[] = [
  {
    id: '1',
    type: 'info',
    title: 'System Update v2.7 Released',
    message:
      'New integrations hub, deployment guide, and enhanced styling have been added.',
    timestamp: '2025-06-13T10:00:00.000Z',
    priority: 'low',
  },
  {
    id: '2',
    type: 'warning',
    title: 'Scheduled Maintenance',
    message:
      'Portal maintenance scheduled for June 15, 2025 (Saturday) from 2:00 AM to 6:00 AM IST.',
    timestamp: '2025-06-12T15:00:00.000Z',
    priority: 'medium',
  },
  {
    id: '3',
    type: 'success',
    title: 'n8n Integration Ready',
    message:
      'Webhook endpoint is now live. Connect your n8n workflows to receive complaints automatically.',
    timestamp: '2025-06-11T09:00:00.000Z',
    priority: 'medium',
  },
  {
    id: '4',
    type: 'warning',
    title: 'SLA Policy Update',
    message:
      'All complaints are now tracked against a 7-day resolution SLA. Breached complaints will be flagged automatically on the dashboard.',
    timestamp: '2025-06-10T11:30:00.000Z',
    priority: 'high',
  },
  {
    id: '5',
    type: 'success',
    title: 'Bulk Actions Available',
    message:
      'Admins can now select multiple complaints and update their status in bulk from the complaints table.',
    timestamp: '2025-06-09T14:00:00.000Z',
    priority: 'low',
  },
];

// GET /api/announcements — returns system announcements
export async function GET() {
  try {
    // Return announcements sorted by most recent first
    const sorted = [...announcements].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return NextResponse.json({ announcements: sorted });
  } catch (error) {
    console.error('Failed to fetch announcements:', error);
    return NextResponse.json(
      { error: 'Failed to fetch announcements' },
      { status: 500 }
    );
  }
}
