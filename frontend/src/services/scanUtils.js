/**
 * scanUtils.js — Single source of truth for scan status classification.
 * Import these helpers everywhere instead of duplicating logic.
 */

/**
 * A scan is cancelled if its status field says so,
 * or if the grade string starts with "cancel" (legacy fallback).
 */
export function isCancelled(scan) {
  if (!scan) return false;
  return (
    scan.status === 'cancelled' ||
    String(scan.grade || '').toLowerCase().startsWith('cancel')
  );
}

/**
 * Normalize API/history payloads so cancelled scans never show scores or findings.
 */
export function normalizeScanResult(scan) {
  if (!scan || !isCancelled(scan)) return scan;
  return {
    ...scan,
    status: 'cancelled',
    grade: 'Cancelled',
    securityScore: null,
    bugsFound: null,
    bugs: [],
    aiAnalysis: undefined,
  };
}

/**
 * A scan is completed if:
 * - it has an explicit status of "completed", OR
 * - it has a grade and is not cancelled (legacy records without a status field)
 */
export function isCompleted(scan) {
  if (!scan) return false;
  if (isCancelled(scan)) return false;
  if (scan.status) return scan.status === 'completed';
  return Boolean(scan.grade); // legacy: no status field but has a grade
}

/**
 * "Needs Review" = completed + grade is NOT A or A+
 * (i.e. grade starts with B, C, D, or F)
 *
 * Rules:
 * - Must be completed (not cancelled, not failed/incomplete)
 * - Grade must NOT start with 'A'
 * - A/A+ scans are considered safe and excluded
 */
export function needsReview(scan) {
  if (!isCompleted(scan)) return false;
  const firstChar = (scan.grade || '')[0]?.toUpperCase();
  return Boolean(firstChar) && firstChar !== 'A';
}
