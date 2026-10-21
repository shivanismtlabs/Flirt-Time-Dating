/**
 * FlirtTime — Interest Compatibility Utility
 * Calculates interest match percentage between authenticated viewer and candidate.
 */

/**
 * Calculates the interest compatibility percentage between viewer and candidate.
 *
 * Formula:
 * Let A = unique interest IDs of the viewer.
 * Let B = unique interest IDs of the candidate.
 * Let C = number of unique interest IDs present in both sets.
 *
 * percentage = round((C / max(count(A), count(B))) * 100)
 *
 * Empty interests handling:
 * - If both users have no interests, return 0.
 * - If either user has no interests, return 0.
 * - Never divide by zero.
 *
 * Requirements:
 * - Compare canonical interest IDs, not display names.
 * - Deduplicate interest associations before calculating.
 * - Calculate each candidate's percentage independently against the authenticated viewer.
 * - Return only the percentage (0 to 100 integer).
 */
export function calculateInterestMatchPercentage(
  viewerInterestIds?: Iterable<string | null | undefined> | null,
  candidateInterestIds?: Iterable<string | null | undefined> | null
): number {
  if (!viewerInterestIds || !candidateInterestIds) {
    return 0;
  }

  // Deduplicate and filter out falsy / non-string / empty IDs
  const setA = new Set<string>();
  for (const id of viewerInterestIds) {
    if (typeof id === 'string') {
      const trimmed = id.trim();
      if (trimmed.length > 0) {
        setA.add(trimmed);
      }
    }
  }

  const setB = new Set<string>();
  for (const id of candidateInterestIds) {
    if (typeof id === 'string') {
      const trimmed = id.trim();
      if (trimmed.length > 0) {
        setB.add(trimmed);
      }
    }
  }

  const countA = setA.size;
  const countB = setB.size;

  // Handle empty interests: if either or both have no interests, return 0
  if (countA === 0 || countB === 0) {
    return 0;
  }

  const maxCount = Math.max(countA, countB);
  if (maxCount === 0) {
    return 0;
  }

  // Count common unique interest IDs present in both sets
  let commonCount = 0;
  for (const id of setB) {
    if (setA.has(id)) {
      commonCount++;
    }
  }

  return Math.round((commonCount / maxCount) * 100);
}

export interface ProfileMatchCalculationInput {
  viewerInterestIds?: Iterable<string | null | undefined> | null;
  candidateInterestIds?: Iterable<string | null | undefined> | null;
  viewerLookingFor?: string | null;
  candidateLookingFor?: string | null;
}

/**
 * Normalizes lookingFor preference string to canonical categories:
 * - 'long_term' (e.g. relationship, long_term, long-term)
 * - 'casual' (e.g. casual, something_casual)
 * - 'not_sure' (e.g. not_sure, figuring_out, we_ll_see)
 */
export function normalizeLookingForPreference(val?: string | null): string | null {
  if (!val || typeof val !== 'string') return null;
  const lower = val.toLowerCase().trim();
  if (lower === 'relationship' || lower === 'long_term' || lower === 'long-term') return 'long_term';
  if (lower === 'something_casual' || lower === 'casual') return 'casual';
  if (
    lower === 'figuring_out' ||
    lower === 'we_ll_see' ||
    lower === 'not_sure' ||
    lower === 'not_sure_yet'
  ) {
    return 'not_sure';
  }
  return lower;
}

/**
 * Calculates the overall profile match percentage between viewer and candidate
 * using a documented, deterministic matching algorithm combining interests and preferences.
 *
 * Algorithm Specification:
 * 1. Interest Compatibility (Weight: 70% if preference data present, 100% if preference data absent):
 *    - Uses canonical unique interest IDs (deduplicated).
 *    - interestScore = round((C / max(count(A), count(B))) * 100)
 *
 * 2. Profile Preference Compatibility (Weight: 30% when both users specify lookingFor preferences):
 *    - lookingFor preferences are normalized to canonical categories.
 *    - preferenceScore = 100 if lookingFor matches, 0 otherwise.
 *
 * 3. Final Score Combination & Bounds:
 *    - If both interest data and lookingFor preferences are present:
 *        matchPercentage = round(0.7 * interestScore + 0.3 * preferenceScore)
 *    - If only interest data exists (either viewer or candidate lookingFor is absent):
 *        matchPercentage = interestScore
 *    - If only preference data exists (neither user has interests, but both have lookingFor):
 *        matchPercentage = preferenceScore
 *    - If neither has interests nor preferences:
 *        matchPercentage = 0
 *    - Clamped strictly between 0 and 100 integer.
 */
export function calculateProfileMatchPercentage(
  input: ProfileMatchCalculationInput
): number {
  const {
    viewerInterestIds,
    candidateInterestIds,
    viewerLookingFor,
    candidateLookingFor,
  } = input;

  const interestScore = calculateInterestMatchPercentage(
    viewerInterestIds,
    candidateInterestIds
  );

  const hasViewerInterests = Boolean(
    viewerInterestIds &&
      Array.from(viewerInterestIds).some((id) => Boolean(id && typeof id === 'string' && id.trim().length > 0))
  );
  const hasCandidateInterests = Boolean(
    candidateInterestIds &&
      Array.from(candidateInterestIds).some((id) => Boolean(id && typeof id === 'string' && id.trim().length > 0))
  );
  const hasInterestData = hasViewerInterests && hasCandidateInterests;

  let preferenceScore: number | null = null;
  const normViewer = normalizeLookingForPreference(viewerLookingFor);
  const normCandidate = normalizeLookingForPreference(candidateLookingFor);
  if (normViewer && normCandidate) {
    preferenceScore = normViewer === normCandidate ? 100 : 0;
  }

  if (hasInterestData && preferenceScore !== null) {
    const combined = Math.round(0.7 * interestScore + 0.3 * preferenceScore);
    return Math.min(100, Math.max(0, combined));
  }

  if (hasInterestData) {
    return interestScore;
  }

  if (preferenceScore !== null) {
    return preferenceScore;
  }

  return 0;
}

