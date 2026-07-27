/**
 * eval-set.ts — a repeatable test set for the assistant ("Saathi").
 * Each item: a realistic question + what SHOULD happen (which tool family,
 * substrings the answer must contain, or which page it should open).
 * Run via GET /api/assistant/eval (admin/senior role) or scripts/eval-assistant.mjs.
 * Tool-match accepts ANY of expectTool (several tools can validly answer).
 */
export interface EvalItem {
  id: string;
  q: string;
  expectTool?: string[];      // pass if ANY of these tools was called ([] = none required)
  mustInclude?: string[];     // answer must contain ALL of these (case-insensitive)
  expectNavigate?: string;    // navigate.destination must equal this
  note?: string;
}

export const EVAL_SET: EvalItem[] = [
  { id: 'overview', q: 'Aaj kya situation hai?', expectTool: ['get_overview'] },
  { id: 'total', q: 'Total kitni complaints hain?', expectTool: ['get_overview', 'query_complaints'] },
  { id: 'area-manbazar', q: 'Manbazar 1 block mein total kitni complaint hai aur kaun si zyada aa rahi hai?', expectTool: ['area_breakdown', 'query_complaints'], mustInclude: ['manbazar'] },
  { id: 'category-wise', q: 'Category-wise complaints ka breakdown do', expectTool: ['query_complaints'] },
  { id: 'block-most', q: 'Sabse zyada complaints kis block mein hain?', expectTool: ['query_complaints', 'top_hotspots'] },
  { id: 'critical-count', q: 'Kitni critical complaints hain abhi?', expectTool: ['get_overview', 'query_complaints', 'search_complaints'] },
  { id: 'open-list', q: 'Open complaints dikhao', expectTool: ['search_complaints', 'navigate'], note: '"dikhao" is ambiguous — listing inline OR opening the complaints page both valid' },
  { id: 'last7', q: 'Pichle 7 din mein kitni complaints aayi?', expectTool: ['query_complaints'] },
  { id: 'water-count', q: 'Paani (water) ki kitni complaints hain?', expectTool: ['query_complaints', 'search_complaints'] },
  { id: 'elec-30d', q: 'Electricity ki complaints last 30 days mein kitni?', expectTool: ['query_complaints'] },
  { id: 'resolved', q: 'Kitni complaints resolve ho chuki hain?', expectTool: ['query_complaints', 'get_overview'] },
  { id: 'anger', q: 'Which area has the most anger?', expectTool: ['get_nlp_insights'] },
  { id: 'priority', q: 'Which area should I focus on first?', expectTool: ['get_priority_areas', 'top_hotspots', 'get_overview'] },
  { id: 'leaderboard', q: 'Officer performance kaisा hai, kaun aage hai?', expectTool: ['get_leaderboard'] },
  { id: 'pending', q: 'Aaj kaun se action pending hain?', expectTool: ['get_pending_actions'] },
  { id: 'network', q: 'Backlog chain mein kahan atka hua hai?', expectTool: ['get_network'] },
  { id: 'forecast', q: 'Aage ka forecast kya hai?', expectTool: ['get_forecast'] },
  { id: 'nav-map', q: 'Map kholo', expectNavigate: 'map' },
  { id: 'nav-complaints', q: 'Complaints ki list kholo', expectNavigate: 'complaints' },
  { id: 'nav-forecast', q: 'Forecast wala page dikhao', expectNavigate: 'forecast' },
  { id: 'nav-brain', q: 'Brain page pe le chalo', expectNavigate: 'brain' },
  { id: 'capabilities', q: 'Tum mujhe kya-kya bata sakte ho?', expectTool: [] },
  { id: 'out-of-domain', q: 'Mausam kaisा rahega kal?', expectTool: [], note: 'should answer briefly / decline — must NOT invent complaint data' },
];
