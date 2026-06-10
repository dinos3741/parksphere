const {
  commitThreshold,
  softThreshold,
  returnZone,
  etaSeconds,
  ALERT_MAX_RANGE,
  COMMIT_HOLD_MS,
  WALKING_SPEED,
} = require('../utils/returnBoundary');

describe('returnBoundary — 2D decision boundary', () => {
  describe('threshold curves', () => {
    it('commit curve spans 0.55 (at car) to 0.90 (at 200m)', () => {
      expect(commitThreshold(0)).toBeCloseTo(0.55, 5);
      expect(commitThreshold(200)).toBeCloseTo(0.90, 5);
      expect(commitThreshold(100)).toBeCloseTo(0.725, 5);
    });

    it('soft curve spans 0.40 (at car) to 0.72 (at 200m)', () => {
      expect(softThreshold(0)).toBeCloseTo(0.40, 5);
      expect(softThreshold(200)).toBeCloseTo(0.72, 5);
    });

    it('commit curve sits above the soft curve at every distance', () => {
      for (let d = 0; d <= 200; d += 10) {
        expect(commitThreshold(d)).toBeGreaterThan(softThreshold(d));
      }
    });

    it('both curves rise monotonically with distance (harder to alert far away)', () => {
      for (let d = 0; d < 200; d += 10) {
        expect(commitThreshold(d + 10)).toBeGreaterThan(commitThreshold(d));
        expect(softThreshold(d + 10)).toBeGreaterThan(softThreshold(d));
      }
    });

    it('clamps beyond the max range and below zero', () => {
      expect(commitThreshold(500)).toBeCloseTo(commitThreshold(ALERT_MAX_RANGE), 5);
      expect(commitThreshold(-50)).toBeCloseTo(commitThreshold(0), 5);
      expect(softThreshold(500)).toBeCloseTo(softThreshold(ALERT_MAX_RANGE), 5);
    });
  });

  describe('returnZone classification', () => {
    it('COMMIT when probability is above the commit curve', () => {
      expect(returnZone(0.91, 200)).toBe('COMMIT'); // commit@200 = 0.90
      expect(returnZone(0.60, 10)).toBe('COMMIT');   // commit@10  = 0.5675
    });

    it('SOFT when between the two curves', () => {
      expect(returnZone(0.75, 200)).toBe('SOFT'); // soft 0.72 < 0.75 < commit 0.90
      expect(returnZone(0.50, 10)).toBe('SOFT');   // soft@10 = 0.416 < 0.50 < commit 0.5675
    });

    it('WAIT when below the soft curve', () => {
      expect(returnZone(0.50, 100)).toBe('WAIT'); // soft@100 = 0.56 > 0.50
      expect(returnZone(0.10, 50)).toBe('WAIT');
    });

    it('a high probability far out is NOT enough to commit (the whole point)', () => {
      // 0.85 at 180m: commit@180 = 0.55 + 0.35*0.9 = 0.865 -> still below commit
      expect(commitThreshold(180)).toBeGreaterThan(0.85);
      expect(returnZone(0.85, 180)).not.toBe('COMMIT');
      // ...but the same 0.85 at 12m easily commits: commit@12 ≈ 0.571
      expect(returnZone(0.85, 12)).toBe('COMMIT');
    });
  });

  describe('etaSeconds', () => {
    it('estimates time-to-free from remaining distance at walking speed', () => {
      expect(etaSeconds(120)).toBe(Math.round(120 / WALKING_SPEED)); // 100s
      expect(etaSeconds(0)).toBe(0);
      expect(etaSeconds(-5)).toBe(0);
    });
  });

  it('exposes the tuning constants', () => {
    expect(ALERT_MAX_RANGE).toBe(200);
    expect(COMMIT_HOLD_MS).toBe(25000);
    expect(WALKING_SPEED).toBe(1.2);
  });
});
