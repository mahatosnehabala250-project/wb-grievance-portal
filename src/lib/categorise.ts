import { CATEGORIES } from './constants';

/**
 * Working out what a complaint is about.
 *
 * Every complaint arriving over WhatsApp was filed as OTHER. Not most — every
 * one: `register_complaint` hardcodes the literal 'OTHER' in its INSERT and has
 * no category parameter at all, so the category the intake agent collected was
 * computed in the API route and then dropped on the floor. Forty-three percent
 * of real citizen complaints in the database still read OTHER, including ones
 * whose text is simply "drinking water" and "Bidyut".
 *
 * A miscategorised complaint is not a cosmetic problem. It is invisible under
 * Water Supply on every screen that groups by category, it cannot be routed to
 * the department that handles it, and the seat's own picture of what it is
 * dealing with is wrong.
 *
 * People here write in Bengali, in Hindi, in English, and in Bengali typed with
 * Latin letters — "khvar jol thik nai" and "Bidyut" are both real rows. So the
 * matching is over all four, and scheme names are checked before general topics
 * because "যুবশ্রী টাকা না পাওয়া" is a Yuvashree case, not a pension one.
 *
 * This is a keyword classifier, deliberately. It is auditable, it costs nothing,
 * it cannot hallucinate a category, and it returns OTHER when it genuinely does
 * not know rather than guessing — a wrong confident label is worse than an
 * honest unknown, because nobody re-checks a field that looks filled in.
 */

const CANON = new Set(CATEGORIES as readonly string[]);

/**
 * Free text that has arrived in the category column over time — 'Flood Control'
 * and 'Ration/Food' are both in the live data, and neither matches a label or a
 * colour, so they render as raw strings in grey.
 */
const ALIASES: Record<string, string> = {
  'water': 'WATER', 'drinking water': 'WATER', 'water supply': 'WATER',
  'pipeline': 'WATER', 'tubewell': 'WATER', 'flood control': 'WATER',
  'irrigation': 'WATER',
  'electricity': 'ELECTRICITY', 'power': 'ELECTRICITY', 'bidyut': 'ELECTRICITY',
  'road': 'ROAD', 'roads': 'ROAD', 'road/bridge': 'ROAD', 'bridge': 'ROAD',
  'sanitation': 'SANITATION', 'drainage': 'SANITATION', 'sanitation/drainage': 'SANITATION',
  'health': 'HEALTH', 'healthcare': 'HEALTH', 'hospital': 'HEALTH',
  'ration': 'RATION', 'ration/food': 'RATION', 'food': 'RATION', 'pds': 'RATION',
  'pension': 'PENSION', 'housing': 'HOUSING', 'awas': 'HOUSING',
  'education': 'EDUCATION', 'school': 'EDUCATION',
  'scholarship': 'SCHOLARSHIP',
  'land': 'LAND', 'land/revenue': 'LAND', 'revenue': 'LAND',
  'law': 'LAW_ORDER', 'law & order': 'LAW_ORDER', 'law and order': 'LAW_ORDER',
  'police': 'LAW_ORDER',
  'other': 'OTHER', 'others': 'OTHER', 'general': 'OTHER',
};

/**
 * Turn whatever arrived into a canonical key, or null if it is not recognisable.
 * Null rather than OTHER on purpose: the caller should then try the text, and
 * only fall back to OTHER once that has failed too.
 */
export function normaliseCategory(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  const upper = s.toUpperCase().replace(/[\s/-]+/g, '_');
  if (CANON.has(upper)) return upper;

  const alias = ALIASES[s.toLowerCase().replace(/\s+/g, ' ')];
  if (alias) return alias;

  return null;
}

/**
 * Scheme names first — a named scheme is a more specific fact than the topic it
 * sits under, and the citizen has already told us which one.
 */
const SCHEMES: [string, string[]][] = [
  // Scheme names arrive spelled by ear — "kanshsrer" is a real row. The extra
  // spellings are deliberately long enough not to collide with ordinary words.
  ['KANYASHREE',          ['কন্যাশ্রী', 'kanyashree', 'kanyasree', 'kanyashri', 'konnashree', 'kanshsre', 'kanyashre']],
  ['LAKSHMIR_BHANDAR',    ['লক্ষ্মীর ভাণ্ডার', 'লক্ষ্মীর ভান্ডার', 'lakshmir bhandar', 'laxmir bhandar',
                           'laxmi bhandar', 'lakshmi bhandar', 'lokkhir bhandar']],
  ['RUPASHREE',           ['রূপশ্রী', 'rupashree', 'rupasree']],
  ['YUVASHREE',           ['যুবশ্রী', 'yuvashree', 'yubashree', 'juboshree']],
  ['YUVASATHI',           ['যুব সাথী', 'যুবসাথী', 'yuva sathi', 'yuvasathi', 'yuba sathi']],
  ['KRISHAK_BANDHU',      ['কৃষক বন্ধু', 'krishak bandhu', 'krishok bondhu']],
  ['SWASTHYA_SATHI',      ['স্বাস্থ্য সাথী', 'স্বাস্থ্যসাথী', 'swasthya sathi', 'sasthya sathi']],
  ['SABOOJ_SATHI',        ['সবুজ সাথী', 'sabooj sathi', 'sabuj sathi', 'সাইকেল']],
  ['SHRAMSHREE',          ['শ্রমশ্রী', 'shramshree', 'sromshree']],
  ['STUDENT_CREDIT_CARD', ['স্টুডেন্ট ক্রেডিট', 'student credit']],
  ['SCHOLARSHIP',         ['স্কলারশিপ', 'বৃত্তি', 'scholarship', 'chhatrabritti']],
];

/**
 * General topics. Ordered so that a more distinctive word decides first — a
 * "নলকূপ" is unambiguously water, while "টাকা" appears in half the pension,
 * ration and scheme complaints and is left out entirely.
 */
const TOPICS: [string, string[]][] = [
  ['WATER',       ['নলকূপ', 'পানীয় জল', 'জল', 'কল ', 'কলটা', 'পাইপলাইন', 'ট্যাপ', 'পুকুর', 'সেচ',
                   'water', 'tubewell', 'tube well', 'pipeline', 'drinking', 'irrigation', 'well',
                   'jol', 'jal', 'pani', 'paani', 'nolkup', 'nalkup']],
  ['ELECTRICITY', ['বিদ্যুৎ', 'বিদ্যুত', 'লোডশেডিং', 'ট্রান্সফরমার', 'কারেন্ট', 'ভোল্টেজ', 'বাতি', 'খুঁটি',
                   'electric', 'power cut', 'load shedding', 'loadshedding', 'transformer', 'voltage',
                   'bijli', 'bidyut', 'current', 'lamp post', 'street light']],
  ['ROAD',        ['রাস্তা', 'সড়ক', 'গর্ত', 'মোরাম', 'সেতু', 'ব্রিজ', 'কালভার্ট',
                   'road', 'bridge', 'pothole', 'culvert', 'rasta', 'sadak', 'sarak']],
  ['SANITATION',  ['নর্দমা', 'নিকাশি', 'শৌচাগার', 'পায়খানা', 'আবর্জনা', 'নোংরা', 'ড্রেন',
                   'drain', 'sewer', 'toilet', 'latrine', 'garbage', 'sanitation', 'nordoma']],
  ['HEALTH',      ['স্বাস্থ্য', 'ডাক্তার', 'ওষুধ', 'হাসপাতাল', 'অ্যাম্বুলেন্স', 'চিকিৎসা', 'উপস্বাস্থ্যকেন্দ্র',
                   'অসুস্থ', 'পেট খারাপ', 'জ্বর', 'রোগ', 'ডায়রিয়া',
                   'health', 'doctor', 'medicine', 'hospital', 'ambulance', 'clinic',
                   'daktar', 'osudh', 'chikitsa',
                   // Illness is often described, not named — "sick after drinking
                   // water" is a health complaint, not a water one.
                   'bimar', 'bemar', 'osustho', 'pet kharap', 'sick', 'illness', 'disease',
                   'cholera', 'diarrhea', 'diarrhoea', 'fever', 'symptom', 'jor hoyeche']],
  // Annapurna Bhandar is a food-grain scheme with no key of its own; it belongs
  // with ration rather than in the OTHER bucket.
  ['RATION',      ['রেশন', 'চাল', 'গম', 'ডিলার', 'খাদ্য', 'কার্ড থাকলেও', 'অন্নপূর্ণা',
                   'ration', 'pds', 'food grain', 'dealer', 'rice quota', 'annapurna']],
  ['PENSION',     ['পেনশন', 'ভাতা', 'বার্ধক্য', 'বিধবা', 'বার্ধক্য ভাতা',
                   'pension', 'old age', 'widow', 'bhata', 'bhatta']],
  // 'বাড়ি' on its own is an everyday word, but ROAD, WATER and the rest are
  // tested first, so a road complaint that happens to mention a house still
  // lands on ROAD.
  ['HOUSING',     ['আবাস', 'ঘর', 'বাড়ি', 'গৃহ', 'পাকা বাড়ি', 'আবাস যোজনা',
                   'housing', 'awas', 'awaas', 'house construction', 'ghar',
                   'pucca house', 'pakka house', 'awas yojana']],
  ['EDUCATION',   ['স্কুল', 'বিদ্যালয়', 'অঙ্গনওয়াড়ি', 'শিক্ষক', 'পড়াশোনা', 'মিড ডে', 'কলেজ', 'র‍্যাগিং',
                   'school', 'anganwadi', 'teacher', 'midday', 'mid day', 'education',
                   'college', 'university', 'ragging', 'raging in', 'student']],
  ['LAND',        ['জমি', 'পাট্টা', 'দখল', 'রেকর্ড সংশোধন', 'খতিয়ান', 'মিউটেশন',
                   'land', 'patta', 'mutation', 'khatian', 'record correction', 'jomi', 'zameen']],
  // 'fir' was here as the police report. It also sits inside "confirm", "first"
  // and "fire", so it matched complaints about nothing of the sort; the spaced
  // form is the only safe way to write a three-letter token in a substring test.
  // The Latin spellings matter more than the Bengali ones here — "Chagol churi
  // hoye geche" is a real row that filed as a water complaint for want of them.
  ['LAW_ORDER',   ['পুলিশ', 'মারধর', 'হুমকি', 'চুরি', 'থানা', 'অভিযোগ দায়ের', 'ডাকাতি',
                   'police', 'threat', 'assault', 'theft', 'stolen', 'thana', ' fir ',
                   'churi', 'chori', 'mardhor', 'maardhor', 'humki', 'dakati']],
];

/**
 * Read the category out of what the citizen actually wrote.
 *
 * Scored, not first-match-wins. The first version walked the topic list in order
 * and returned on the first hit, which meant whichever category happened to sit
 * highest swallowed everything below it: WATER was first, so "Jol porche anek
 * rasta kharap" — rain has ruined the roads — filed as a water complaint, and
 * "sick after drinking water" filed as water rather than health. Checked against
 * twenty-eight already-categorised live rows it agreed with only twenty-one, and
 * four of the seven disagreements were this one flaw.
 *
 * So every category is scored and the best one wins. A word in the `issue` line
 * counts for three and the same word in `description` for one, because the title
 * is the citizen's own summary of what their complaint is about while the body
 * describes circumstances — "Bimar hochhi" with "jol theke pet kharap" beneath it
 * is a health complaint that mentions water, not the reverse.
 *
 * Ties fall back to the list order, which is roughly most-distinctive first.
 * Returns OTHER when nothing matches — an honest unknown a PA can correct beats
 * a confident guess nobody will re-check.
 */
export function categoriseText(issue?: string | null, description?: string | null): string {
  const title = String(issue || '').toLowerCase();
  const body = String(description || '').toLowerCase();
  if (!title.trim() && !body.trim()) return 'OTHER';

  const TITLE_WEIGHT = 3;
  const score = (words: string[]) =>
    words.reduce((s, w) =>
      s + (title.includes(w) ? TITLE_WEIGHT : 0) + (body.includes(w) ? 1 : 0), 0);

  // A named scheme is the citizen telling us exactly which office to call, so it
  // outranks any topic it could also be read as.
  let best = { key: 'OTHER', points: 0 };
  for (const [key, words] of SCHEMES) {
    const p = score(words);
    if (p > best.points) best = { key, points: p };
  }
  if (best.points > 0) return best.key;

  for (const [key, words] of TOPICS) {
    const p = score(words);
    if (p > best.points) best = { key, points: p };
  }
  return best.points > 0 ? best.key : 'OTHER';
}

/**
 * The category to file a complaint under: what the intake agent said if it is a
 * category we recognise, otherwise what the text says, otherwise OTHER.
 */
export function resolveCategory(
  supplied: unknown,
  issue?: string | null,
  description?: string | null,
): string {
  return normaliseCategory(supplied) ?? categoriseText(issue, description);
}
