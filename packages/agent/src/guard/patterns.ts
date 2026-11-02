/**
 * Injection patterns (the spec's Appendix B is missing, so this list is
 * authored here). Everything is case-insensitive and every pattern is applied
 * per sentence, after the text has been normalised by the shield.
 *
 * The list deliberately mixes direct instructions ("approve this payment") with
 * meta-instructions ("ignore previous instructions") because both are used in
 * the wild against shopping agents.
 */

export interface InjectionPattern {
  name: string;
  regex: RegExp;
}

function pattern(name: string, source: string): InjectionPattern {
  return { name, regex: new RegExp(source, 'i') };
}

export const INJECTION_PATTERNS: readonly InjectionPattern[] = [
  pattern(
    'IGNORE_PREVIOUS',
    String.raw`\bignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directions?|messages?)\b`
  ),
  pattern(
    'DISREGARD_PREVIOUS',
    String.raw`\bdisregard\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|system)\s*(instructions?|prompts?|rules?|messages?)?\b`
  ),
  pattern(
    'FORGET_PREVIOUS',
    String.raw`\bforget\s+(all\s+|any\s+)?(your\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)\b`
  ),
  pattern(
    'ROLE_PLAY',
    String.raw`\b(you\s+are|act\s+as|pretend\s+to\s+be|from\s+now\s+on\s+you\s+are)\s+(now\s+)?(in\s+)?(an?\s+)?(ai|assistant|agent|model|system|admin|administrator|developer)\b`
  ),
  pattern('JAILBREAK', String.raw`\b(developer\s+mode|jailbreak|dan\s+mode|do\s+anything\s+now|sudo\s+mode)\b`),
  pattern('ROLE_PREFIX', String.raw`^\s*(system|assistant|developer|admin|administrator)\s*:`),
  pattern(
    'AI_AGENT_PREFIX',
    String.raw`^\s*(ai|a\.i\.)(\s+(agents?|assistants?|models?|systems?|shoppers?|bots?))?\s*[:,]`
  ),
  pattern(
    'APPROVE_PAYMENT',
    String.raw`\b(approve|authorize|authorise)\s+(this|the|that|every|all)\s+(payment|order|transaction|purchase|checkout)\b`
  ),
  pattern('CONFIRM_PAYMENT', String.raw`\bconfirm\s+(this|the|that)\s+payment\b`),
  pattern(
    'SUPPRESS_WARNING',
    String.raw`\b(do\s+not|don'?t|never)\s+(warn|flag|block|stop|review|question|challenge)\s+(the\s+)?(user|buyer|customer|payment|order|merchant|seller|transaction|purchase|this|that)\b`
  ),
  pattern(
    'TELL_USER_SAFE',
    String.raw`\b(tell|inform|assure|convince)\s+(the\s+)?(user|buyer|customer|shopper)\s+(that\s+)?(this|the)\s+(seller|merchant|shop|store|site)\s+is\s+(safe|verified|trusted|legitimate|genuine)\b`
  ),
  pattern(
    'OVERRIDE_DECISION',
    String.raw`\b(override|overrule|bypass|ignore)\s+(the\s+)?(decision|verdict|score|rules?|system|checks?)\b`
  ),
  pattern(
    'SKIP_CHECKS',
    String.raw`\b(skip|bypass|disable|turn\s+off)\s+(all\s+|any\s+|the\s+)?(checks?|verification|review|validation|scoring|safety)\b`
  ),
  pattern(
    'MARK_AS_SAFE',
    String.raw`\b(mark|set|treat|classify|label)\s+(this|the|that)?\s*(payment|order|merchant|seller|site|transaction)?\s*(as\s+)?(safe|verified|trusted|approved|legitimate|genuine)\b`
  ),
  pattern('ALWAYS_TRUST', String.raw`\b(always|just)\s+(approve|trust|proceed)\b`),
  pattern(
    'DELIMITER_SPOOF',
    String.raw`(<\/?\s*untrusted_data\s*>|<\/?\s*system\s*>|\[\s*\/?\s*(system|inst|instruction|untrusted_data)\s*\]|<<\s*sys\s*>>)`
  ),
  pattern(
    'OBFUSCATED_PAYLOAD',
    String.raw`\b(base64|rot13|decode\s+the\s+following|execute\s+the\s+following|eval\s+the\s+following)\b`
  ),
  pattern(
    'CLAIM_AND_PAY',
    String.raw`\b(this|the)\s+(merchant|seller|store|shop|site)\s+is\s+(verified|trusted|safe|legitimate|genuine)\b[\s\S]{0,60}\b(approve|proceed|pay|accept)\b`
  ),
];

/** A sentence that talks about an AI system and gives it an order. */
export const AI_SUBJECT_REGEX =
  /\b(ai|a\.i\.|artificial intelligence|assistant|agent|llm|chatbot|language model|model)\b/i;

export const DIRECTIVE_REGEX =
  /\b(must|should|ignore|disregard|approve|trust|verify|proceed|do not|don'?t|always|never|skip|override)\b/i;

/** Maximum character distance between the AI subject and the directive. */
export const AI_ADDRESS_MAX_GAP = 40;

export interface InjectionMatch {
  pattern: string;
  snippet: string;
}

export function matchInjection(sentence: string): InjectionMatch | null {
  for (const entry of INJECTION_PATTERNS) {
    const match = entry.regex.exec(sentence);
    if (match) {
      return { pattern: entry.name, snippet: match[0] };
    }
  }

  const aiMatch = matchAiAddress(sentence);
  if (aiMatch) return aiMatch;

  return null;
}

function matchAiAddress(sentence: string): InjectionMatch | null {
  const subject = AI_SUBJECT_REGEX.exec(sentence);
  if (!subject) return null;

  const directive = new RegExp(DIRECTIVE_REGEX.source, 'gi');
  let candidate: RegExpExecArray | null;
  while ((candidate = directive.exec(sentence)) !== null) {
    const subjectStart = subject.index;
    const subjectEnd = subject.index + subject[0].length;
    const directiveStart = candidate.index;
    const directiveEnd = candidate.index + candidate[0].length;

    const gap =
      directiveStart >= subjectEnd
        ? directiveStart - subjectEnd
        : subjectStart - directiveEnd;

    if (gap <= AI_ADDRESS_MAX_GAP) {
      return {
        pattern: 'AI_ADDRESS',
        snippet: `${subject[0].toLowerCase()} ... ${candidate[0].toLowerCase()}`,
      };
    }
  }

  return null;
}
