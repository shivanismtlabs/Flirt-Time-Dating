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
