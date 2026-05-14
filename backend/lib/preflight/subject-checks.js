// Subject-line preflight rules. Kept together because they all read the
// same `subject` string and share the SPAM_PHRASES / SUBJECT_* constants.
// Each function returns `null` (pass) or a `{ code, severity, message, hint? }`
// result, the shape runSendChecks() expects.

// Spammy phrases that hit common Gmail / Outlook content filters. List is
// intentionally short. There are 500-item lists online but most of those
// produce noise. Stick to the ones with documented filter impact.
const SPAM_PHRASES = [
  'act now',
  'click here',
  'free money',
  'guaranteed',
  'limited time',
  'no obligation',
  'order now',
  'risk free',
  'urgent',
  'winner',
  'wire transfer',
  '$$$',
  '!!!',
];

// Subject line guidance from the major providers. > 78 chars typically gets
// truncated in narrow mobile clients; > 998 is a hard SMTP limit (we already
// enforce this in sanitizeSubject, this check makes the cap visible).
const SUBJECT_TRUNCATE_AT = 78;
const SUBJECT_HARD_CAP = 998;

function checkSubjectPresent({ subject }) {
  if (subject.trim()) return null;
  return {
    code: 'subject_missing',
    severity: 'error',
    message: 'Add a subject line.',
    hint: 'An empty subject lands in spam in Gmail and looks broken in Outlook.',
  };
}

function checkSubjectLength({ subject }) {
  const len = subject.length;
  if (len > SUBJECT_HARD_CAP) {
    return {
      code: 'subject_too_long',
      severity: 'error',
      message: `Subject is ${len} chars. Hard cap is ${SUBJECT_HARD_CAP}.`,
      hint: 'SMTP rejects headers longer than 998 chars.',
    };
  }
  if (len > SUBJECT_TRUNCATE_AT) {
    return {
      code: 'subject_truncated',
      severity: 'warn',
      message: `Subject is ${len} chars. Most mobile inboxes truncate around ${SUBJECT_TRUNCATE_AT}.`,
      hint: 'Frontload the key idea so it survives the truncation.',
    };
  }
  return null;
}

function checkSubjectCaps({ subject }) {
  const letters = subject.replace(/[^A-Za-z]/g, '');
  if (letters.length < 6) return null;
  const uppers = letters.replace(/[^A-Z]/g, '').length;
  const ratio = uppers / letters.length;
  if (ratio > 0.6) {
    return {
      code: 'subject_caps',
      severity: 'warn',
      message: 'Subject is mostly UPPERCASE.',
      hint: 'All-caps subjects raise spam scores in Gmail and Outlook. Mix case.',
    };
  }
  return null;
}

function checkSubjectSpamPhrases({ subject }) {
  const lower = subject.toLowerCase();
  const hits = SPAM_PHRASES.filter((phrase) => lower.includes(phrase));
  if (!hits.length) return null;
  return {
    code: 'subject_spam_phrases',
    severity: 'warn',
    message: `Subject contains commonly flagged phrases: ${hits.join(', ')}.`,
    hint: 'Rephrase to avoid generic urgency triggers.',
    meta: { phrases: hits },
  };
}

function checkSubjectPunctuation({ subject }) {
  if (/!{3,}/.test(subject) || /\?{3,}/.test(subject)) {
    return {
      code: 'subject_punctuation',
      severity: 'warn',
      message: 'Subject uses repeated !!! or ???.',
      hint: 'Repeated punctuation is a strong spam signal.',
    };
  }
  return null;
}

export const SUBJECT_CHECKS = [
  checkSubjectPresent,
  checkSubjectLength,
  checkSubjectCaps,
  checkSubjectSpamPhrases,
  checkSubjectPunctuation,
];
