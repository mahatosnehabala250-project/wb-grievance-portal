/**
 * shared.ts — client-safe assistant constants (NO server imports).
 * Imported by both the server tools/agent AND the browser Live session, so it
 * must never pull in db/prisma/intelligence.
 */

export const NAV_DESTINATIONS: Array<{ id: string; label: string; view: string; room?: string }> = [
  { id: 'home', label: 'Home / Today', view: 'intel_command', room: 'aaj' },
  { id: 'overview', label: 'Overview dashboard', view: 'overview' },
  { id: 'complaints', label: 'Complaints list', view: 'complaints' },
  { id: 'map', label: 'Command Map', view: 'map' },
  { id: 'intel_command', label: 'Intel Command', view: 'intel_command', room: 'aaj' },
  { id: 'actions', label: 'Action queue', view: 'intel_command', room: 'actions' },
  { id: 'forecast', label: 'Forecast / early-warning', view: 'intel_command', room: 'forecast' },
  { id: 'network', label: 'Network intelligence', view: 'intel_command', room: 'network' },
  { id: 'brain', label: 'Brain (AI text intelligence)', view: 'intel_command', room: 'brain' },
  { id: 'entity360', label: 'Entity 360 (area priority)', view: 'intel_command', room: 'entity360' },
  { id: 'field', label: 'Field / Wapas Jao', view: 'intel_command', room: 'field' },
  { id: 'users', label: 'Team / users', view: 'users' },
  { id: 'analytics', label: 'Analytics', view: 'analytics' },
  { id: 'mp_command', label: 'MP Command', view: 'mp_command' },
  { id: 'mla_dashboard', label: 'MLA Dashboard', view: 'mla_dashboard' },
  { id: 'settings', label: 'Settings', view: 'settings' },
];

export const WRITE_TOOL_NAMES = new Set(['assign_officer', 'update_status', 'escalate_complaint', 'add_note', 'reopen_complaint']);
