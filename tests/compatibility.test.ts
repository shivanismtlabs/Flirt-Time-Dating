import { calculateInterestMatchPercentage } from '../src/utils/compatibility';

describe('Interest Compatibility Calculation Utility', () => {
  describe('Prompt Formula Examples', () => {
    it('should return 60% when viewer has 5 interests, candidate has 4, and 3 match', () => {
      // A = [1, 2, 3, 4, 5], B = [1, 2, 3, 6], C = 3
      // max(5, 4) = 5 -> round((3 / 5) * 100) = 60
      const viewer = ['int-1', 'int-2', 'int-3', 'int-4', 'int-5'];
      const candidate = ['int-1', 'int-2', 'int-3', 'int-6'];

      const result = calculateInterestMatchPercentage(viewer, candidate);
      expect(result).toBe(60);
    });

    it('should return 50% when both users have 4 interests, and 2 match', () => {
      // A = [1, 2, 3, 4], B = [1, 2, 5, 6], C = 2
      // max(4, 4) = 4 -> round((2 / 4) * 100) = 50
      const viewer = ['int-1', 'int-2', 'int-3', 'int-4'];
      const candidate = ['int-1', 'int-2', 'int-5', 'int-6'];

      const result = calculateInterestMatchPercentage(viewer, candidate);
      expect(result).toBe(50);
    });

    it('should return 0% when there are no common interests', () => {
      const viewer = ['int-1', 'int-2', 'int-3'];
      const candidate = ['int-4', 'int-5', 'int-6'];

      const result = calculateInterestMatchPercentage(viewer, candidate);
      expect(result).toBe(0);
    });

    it('should return 0% when both users have no interests', () => {
      const result = calculateInterestMatchPercentage([], []);
      expect(result).toBe(0);
    });
  });

  describe('Edge Cases and Empty Interests Handling', () => {
    it('should return 0% when viewer has no interests and candidate has 4 interests', () => {
      const viewer: string[] = [];
      const candidate = ['int-1', 'int-2', 'int-3', 'int-4'];

      const result = calculateInterestMatchPercentage(viewer, candidate);
      expect(result).toBe(0);
    });

    it('should return 0% when candidate has no interests and viewer has 4 interests', () => {
      const viewer = ['int-1', 'int-2', 'int-3', 'int-4'];
      const candidate: string[] = [];

      const result = calculateInterestMatchPercentage(viewer, candidate);
      expect(result).toBe(0);
    });

    it('should return 0% when arguments are null or undefined without throwing', () => {
      expect(calculateInterestMatchPercentage(null, null)).toBe(0);
      expect(calculateInterestMatchPercentage(undefined, undefined)).toBe(0);
      expect(calculateInterestMatchPercentage(['int-1'], null)).toBe(0);
      expect(calculateInterestMatchPercentage(null, ['int-1'])).toBe(0);
    });

    it('should return 100% when all interests match identically', () => {
      const viewer = ['int-1', 'int-2', 'int-3'];
      const candidate = ['int-1', 'int-2', 'int-3'];

      const result = calculateInterestMatchPercentage(viewer, candidate);
      expect(result).toBe(100);
    });

    it('should accurately round decimals', () => {
      // 1 match out of max(3, 1) = 3 -> 1/3 * 100 = 33.333... -> 33
      const viewer = ['int-1', 'int-2', 'int-3'];
      const candidate = ['int-1'];

      expect(calculateInterestMatchPercentage(viewer, candidate)).toBe(33);

      // 2 matches out of max(3, 2) = 3 -> 2/3 * 100 = 66.666... -> 67
      const candidate2 = ['int-1', 'int-2'];
      expect(calculateInterestMatchPercentage(viewer, candidate2)).toBe(67);
    });
  });

  describe('Deduplication and Canonical ID Comparison', () => {
    it('should deduplicate interest associations before calculating and not inflate percentages', () => {
      // Viewer has duplicate IDs: ['int-1', 'int-1', 'int-2'] -> unique 2
      // Candidate has duplicate IDs: ['int-1', 'int-1', 'int-1'] -> unique 1
      // Matches = 1. Max(2, 1) = 2. -> 50%
      const viewer = ['int-1', 'int-1', 'int-2'];
      const candidate = ['int-1', 'int-1', 'int-1'];

      const result = calculateInterestMatchPercentage(viewer, candidate);
      expect(result).toBe(50);
    });

    it('should ignore empty, whitespace, or invalid IDs', () => {
      const viewer = ['int-1', '  ', '', null as any, undefined as any, 'int-2'];
      const candidate = ['int-1', '   ', 'int-2'];

      // Unique valid: viewer = 2, candidate = 2, common = 2 -> 100%
      const result = calculateInterestMatchPercentage(viewer, candidate);
      expect(result).toBe(100);
    });

    it('should compare canonical IDs independently for each candidate', () => {
      const viewer = ['int-1', 'int-2', 'int-3', 'int-4']; // 4 interests

      const candidateA = ['int-1', 'int-2', 'int-3', 'int-4']; // 4/4 = 100%
      const candidateB = ['int-1', 'int-2'];                   // 2/4 = 50%
      const candidateC = ['int-5', 'int-6'];                   // 0/4 = 0%

      expect(calculateInterestMatchPercentage(viewer, candidateA)).toBe(100);
      expect(calculateInterestMatchPercentage(viewer, candidateB)).toBe(50);
      expect(calculateInterestMatchPercentage(viewer, candidateC)).toBe(0);
    });
  });
});
