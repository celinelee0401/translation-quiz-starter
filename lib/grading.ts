export type MatchSuggestion = {
  kind: 'textbook-exact' | 'approved-alternative' | 'convention-variant' | 'teacher-review';
  suggestedScore: number | null;
  reason: string;
  ruleVersion: 'literal-v1';
  breakdown?: {
    meaning: number;
    grammar: number;
    convention: number;
  };
};

export type TranslationRuleContext = {
  questionKey?: string;
  approvedRubricVersion?: string;
};

// A match is only a teacher-facing suggestion. It never finalizes a formal
// grade, and a non-match is never treated as a wrong answer or zero points.
export function suggestTranslationScore(
  rawAnswer: string,
  segmentedAnswer: string,
  maxScore: number,
  _context: TranslationRuleContext = {},
): MatchSuggestion {
  const student = normalizeTranslation(rawAnswer);
  const textbook = normalizeTranslation(segmentedAnswer.replace(/\s*\/\s*/g, ' '));
  if (student && student === textbook) {
    return {
      kind: 'textbook-exact',
      suggestedScore: maxScore,
      reason: '與參考答案一致；僅建議滿分，正式成績尚未鎖定。',
      ruleVersion: 'literal-v1',
    };
  }
  return {
    kind: 'teacher-review',
    suggestedScore: null,
    reason: student
      ? '可能是合理替代表達或需要部分給分，請依語意、句型與評分單位覆核。'
      : '學生未填寫答案，請教師確認後評分。',
    ruleVersion: 'literal-v1',
  };
}

function normalizeTranslation(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/\s+([,.?!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
