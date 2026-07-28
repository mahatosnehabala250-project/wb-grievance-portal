/**
 * Letter templates for the constituency office.
 *
 * These are the letters an MLA office actually types every week — forwarding a
 * grievance to the BDO, recommending a family for a scheme, chasing a letter
 * that got no reply. They were being written one at a time in Word, from
 * scratch, with the citizen's details re-keyed each time.
 *
 * Each template renders from a context the app already has on file, and the
 * text stays fully editable before it is issued: the template is a starting
 * point, never a cage.
 */

export interface LetterContext {
  citizenName: string;
  citizenVillage: string;
  citizenPhone: string;
  subjectMatter: string;      // what the letter is about, in the citizen's words
  recipientDesignation: string;
  recipientOffice: string;
  constituency: string;
  officeName: string;         // "Purulia MLA Office"
  signatoryName: string;      // the MLA's name
  ticketNo: string;           // linked complaint, if any
  earlierRef: string;         // for reminders
}

export interface LetterTemplate {
  id: string;
  label: string;
  hint: string;
  /** Typical addressee, pre-filled but editable. */
  defaultDesignation: string;
  subject: (c: LetterContext) => string;
  body: (c: LetterContext) => string;
}

const who = (c: LetterContext) => {
  const bits = [c.citizenName || 'the applicant'];
  if (c.citizenVillage) bits.push(`of ${c.citizenVillage}`);
  return bits.join(' ');
};

const refLine = (c: LetterContext) =>
  c.ticketNo ? `\n\nThis matter is on record at this office as complaint ${c.ticketNo}.` : '';

const closing = (c: LetterContext) =>
  `\n\nYour early action in the matter will be appreciated.\n\nYours faithfully,\n\n${c.signatoryName}\nMLA, ${c.constituency}`;

export const LETTER_TEMPLATES: LetterTemplate[] = [
  {
    id: 'FORWARDING',
    label: 'Forwarding a grievance',
    hint: 'Sends a citizen complaint to the officer who can actually act on it',
    defaultDesignation: 'Block Development Officer',
    subject: (c) => `Forwarding grievance of ${who(c)} — ${c.subjectMatter || 'redressal requested'}`,
    body: (c) => `Sir/Madam,

I am forwarding herewith the grievance of ${who(c)}${c.citizenPhone ? ` (contact ${c.citizenPhone})` : ''}, received at this office.

The applicant has stated: ${c.subjectMatter || '—'}

The matter falls within your jurisdiction. I request that it be examined and that the applicant be informed of the action taken.${refLine(c)}${closing(c)}`,
  },
  {
    id: 'RECOMMENDATION',
    label: 'Recommendation for a scheme',
    hint: 'Supports a citizen\'s application for a government benefit',
    defaultDesignation: 'Block Development Officer',
    subject: (c) => `Recommendation — ${who(c)} — ${c.subjectMatter || 'scheme benefit'}`,
    body: (c) => `Sir/Madam,

${who(c)}${c.citizenPhone ? `, contact ${c.citizenPhone},` : ''} has applied for ${c.subjectMatter || 'the benefit named above'}.

From what is known to this office, the applicant's circumstances merit consideration. I recommend that the application be examined on its merits under the applicable rules and disposed of without avoidable delay.

Nothing in this letter is intended to override eligibility criteria; the purpose is only to bring the case to your notice.${refLine(c)}${closing(c)}`,
  },
  {
    id: 'REMINDER',
    label: 'Reminder on an earlier letter',
    hint: 'Chases a letter that got no reply — the office\'s most-used follow-up',
    defaultDesignation: 'Block Development Officer',
    subject: (c) => `Reminder — ${c.earlierRef || 'earlier letter'} — ${c.subjectMatter || 'no reply received'}`,
    body: (c) => `Sir/Madam,

Reference is invited to this office letter ${c.earlierRef || '(reference)'} regarding ${c.subjectMatter || 'the matter noted above'}, concerning ${who(c)}.

No reply has been received to date, and the applicant continues to approach this office.

I request that the present status be intimated to this office, and that the matter be brought to a conclusion.${refLine(c)}${closing(c)}`,
  },
  {
    id: 'WORK_DEMAND',
    label: 'Demand for a work or sanction',
    hint: 'Asks for a road, tubewell, culvert, transformer or similar work',
    defaultDesignation: 'Executive Engineer',
    subject: (c) => `Request for sanction — ${c.subjectMatter || 'proposed work'}${c.citizenVillage ? ` at ${c.citizenVillage}` : ''}`,
    body: (c) => `Sir/Madam,

The residents of ${c.citizenVillage || 'the area named above'} have represented to this office regarding ${c.subjectMatter || 'the work proposed below'}.

The need is genuine and long-standing, and the absence of this work causes daily hardship to the residents.

I request that the proposal be examined, an estimate prepared, and the work taken up under an appropriate head in the current financial year.${refLine(c)}${closing(c)}`,
  },
  {
    id: 'INTRODUCTION',
    label: 'Letter of introduction',
    hint: 'Introduces a citizen who has to meet an officer in person',
    defaultDesignation: 'Block Development Officer',
    subject: (c) => `Introduction — ${who(c)}`,
    body: (c) => `Sir/Madam,

This is to introduce ${who(c)}${c.citizenPhone ? `, contact ${c.citizenPhone}` : ''}, who is known to this office.

The bearer is approaching your office in connection with ${c.subjectMatter || 'the matter stated by the bearer'}.

I request that the bearer be given a hearing and assisted with the correct procedure.${refLine(c)}${closing(c)}`,
  },
  {
    id: 'MEDICAL_ASSISTANCE',
    label: 'Medical assistance support',
    hint: 'Supports a treatment or relief-fund request',
    defaultDesignation: 'Chief Medical Officer of Health',
    subject: (c) => `Medical assistance — ${who(c)}`,
    body: (c) => `Sir/Madam,

${who(c)}${c.citizenPhone ? `, contact ${c.citizenPhone},` : ''} has approached this office regarding ${c.subjectMatter || 'treatment assistance'}.

The family is not in a position to meet the cost of treatment without assistance.

I request that the case be examined for assistance under the applicable scheme, and that the applicant be guided on the documents required.${refLine(c)}${closing(c)}`,
  },
  {
    id: 'CONDOLENCE',
    label: 'Condolence',
    hint: 'A short personal letter to a bereaved family',
    defaultDesignation: '',
    subject: (c) => `Condolence — ${c.citizenName || 'the bereaved family'}`,
    body: (c) => `Dear ${c.citizenName || 'Sir/Madam'},

I was deeply saddened to learn of your loss.

Please accept my heartfelt condolences on behalf of myself and the people of ${c.constituency}. If this office can be of any assistance to your family in the days ahead, please do not hesitate to reach us.

With sincere sympathy,

${c.signatoryName}
MLA, ${c.constituency}`,
  },
  {
    id: 'CUSTOM',
    label: 'Blank letter',
    hint: 'Start from an empty page on office letterhead',
    defaultDesignation: '',
    subject: (c) => c.subjectMatter || '',
    body: (c) => `Sir/Madam,

${closing(c).trim()}`,
  },
];

/** Designations an MLA office writes to most often. */
export const RECIPIENT_DESIGNATIONS = [
  'Block Development Officer',
  'Sub-Divisional Officer',
  'District Magistrate',
  'Superintendent of Police',
  'Executive Engineer, PHE',
  'Executive Engineer, PWD',
  'Executive Engineer, WBSEDCL',
  'Chief Medical Officer of Health',
  'District Inspector of Schools',
  'Divisional Forest Officer',
  'Sabhapati, Panchayat Samiti',
  'Pradhan, Gram Panchayat',
];

export function templateById(id: string): LetterTemplate {
  return LETTER_TEMPLATES.find((t) => t.id === id) || LETTER_TEMPLATES[0];
}
