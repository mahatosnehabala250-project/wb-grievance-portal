import { describe, it, expect } from 'vitest';
import { categoriseText, normaliseCategory, resolveCategory } from '@/lib/categorise';

/**
 * These cases are real rows from the live database, not invented examples.
 *
 * Every complaint arriving over WhatsApp was filed as OTHER — register_complaint
 * hardcoded the literal into its INSERT and took no category parameter — so
 * forty-three percent of real citizen complaints carried no usable category. The
 * rows below are the ones that were wrong, kept here so the classifier cannot
 * quietly regress on the exact text that exposed each fault.
 */

describe('normaliseCategory', () => {
  it('accepts canonical keys unchanged', () => {
    expect(normaliseCategory('WATER')).toBe('WATER');
    expect(normaliseCategory('LAKSHMIR_BHANDAR')).toBe('LAKSHMIR_BHANDAR');
  });

  it('repairs the free text that reached the category column', () => {
    // Both are live values. Neither matched a label or a colour, so they
    // rendered as raw grey strings on every screen that groups by category.
    expect(normaliseCategory('Ration/Food')).toBe('RATION');
    expect(normaliseCategory('Flood Control')).toBe('WATER');
  });

  it('returns null rather than OTHER for anything unrecognised', () => {
    // Null lets the caller fall through to the text; answering OTHER here would
    // stop that and lose the one signal left.
    expect(normaliseCategory('bananas')).toBeNull();
    expect(normaliseCategory('')).toBeNull();
    expect(normaliseCategory(undefined)).toBeNull();
  });
});

describe('categoriseText', () => {
  const cases: [string, string, string, string][] = [
    // [expected, issue, description, why it is here]
    ['WATER', 'drinking water', 'khvar jol thik nai', 'English title, Bengali-in-Latin body'],
    ['WATER', 'জল পরিষেবা সমস্যা', 'জল আসছে না', 'Bengali script'],
    ['ELECTRICITY', 'Bidyut', 'ঝড়ের কারণে গাছ ভেঙে বিদ্যুৎ সংযোগ বিচ্ছিন্ন হয়েছে', 'one-word title'],
    ['ELECTRICITY', 'Bidhuyyt', 'Current gale amader 12 ghta current thake na.', 'title misspelled beyond matching; body carries it'],
    ['ROAD', 'গ্রামে রাস্তা খারাপ', 'গ্রামে রাস্তা খারাপ', 'Bengali road'],
    ['PENSION', 'Old age pension status', 'Grandfather App ID 32101000000008993342', 'English'],
    ['SCHOLARSHIP', 'Scholarship dhuke nai', 'Scholarship dhuke nai', 'scheme word in a Latin sentence'],
    ['HOUSING', 'আমাদের পরিবার এখনো সরকার থেকে পাকা বাড়ি পাই নি', '', 'pucca house'],
    ['RATION', 'অন্নপূর্ণা ভান্ডারের টাকা ঢুকে নাই', '', 'a food scheme with no key of its own'],
    ['WATER', 'Community irrigation well construction', 'Request for construction of community irrigation well', 'irrigation'],
  ];

  for (const [expected, issue, description, why] of cases) {
    it(`${expected}: ${why}`, () => {
      expect(categoriseText(issue, description)).toBe(expected);
    });
  }

  describe('scheme names outrank the topic they could be read as', () => {
    it('files a Yuvashree payment as Yuvashree, not as a pension', () => {
      expect(categoriseText('যুবশ্রী টাকা না পাওয়া', 'যুবশ্রী প্রকল্পের টাকা এখনো পাইনি।')).toBe('YUVASHREE');
    });
    it('recognises a scheme spelled by ear', () => {
      // "kanshsrer" is how one citizen wrote Kanyashree.
      expect(categoriseText('Amar kanshsrer taka dukhe nai', '')).toBe('KANYASHREE');
      expect(categoriseText('Amar laxmi bhandar er taka dhukeni', '')).toBe('LAKSHMIR_BHANDAR');
    });
  });

  describe('the title outweighs the body', () => {
    /**
     * The first version returned on the first matching category in list order,
     * so WATER — which was first — swallowed every complaint that mentioned
     * water at all. These four rows are what that cost.
     */
    it('reads illness caused by water as health, not as water', () => {
      expect(categoriseText('Cholera symptoms', 'People sick after drinking water')).toBe('HEALTH');
      expect(categoriseText('Bimar hochhi', 'Jol theke pet kharap')).toBe('HEALTH');
    });
    it('reads a stolen goat as law and order, not as housing or water', () => {
      expect(categoriseText('Chagol churi hoye geche',
        'Amader ghare paser barite ekta chagal chilo, seta churi haiye geche')).toBe('LAW_ORDER');
    });
    it('reads a blocked drain as sanitation', () => {
      expect(categoriseText('Drainage system blocked causing waterlogging',
        'The drainage canal is completely blocked with plastic waste and silt.')).toBe('SANITATION');
    });
  });

  describe('short tokens do not match inside longer words', () => {
    it('does not read "confirm" or "first" as a police report', () => {
      // 'fir' was in the law-and-order list unspaced and matched all of these.
      expect(categoriseText('Payment not confirmed', 'Waiting for the first instalment')).not.toBe('LAW_ORDER');
    });
  });

  it('answers OTHER when it genuinely does not know', () => {
    // An honest unknown a PA can correct beats a confident guess nobody
    // re-checks. There is no caste-certificate category, so these stay OTHER.
    expect(categoriseText('Network issue', 'Network issue')).toBe('OTHER');
    expect(categoriseText('OBC card not received', 'OBC card not received')).toBe('OTHER');
    expect(categoriseText('', '')).toBe('OTHER');
  });
});

describe('resolveCategory', () => {
  it('keeps a category the intake agent supplied when it is one we know', () => {
    expect(resolveCategory('HEALTH', 'Jol nei', 'Pipe phete geche')).toBe('HEALTH');
  });
  it('falls back to the text when the supplied category is unusable', () => {
    expect(resolveCategory('', 'Jol nei', 'Pipe phete geche')).toBe('WATER');
    expect(resolveCategory('banana', 'Jol nei', 'Pipe phete geche')).toBe('WATER');
  });
  it('repairs free-text categories before trusting them', () => {
    expect(resolveCategory('Ration/Food', 'anything', '')).toBe('RATION');
  });
});
