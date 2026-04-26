/**
 * Score Calculator
 * 
 * Computes a composite security + quality score out of 100.
 * 
 * Weighting:
 *  - Critical issues:  -15 points each  (max deduction: 60)
 *  - Medium issues:    -5 points each   (max deduction: 30)
 *  - Low issues:       -2 points each   (max deduction: 10)
 *  - Lighthouse perf:  bonus/penalty    (±10 points)
 */
function calculateScore(issues, lighthouseData) {
  let score = 100;

  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const mediumCount   = issues.filter(i => i.severity === 'medium').length;
  const lowCount      = issues.filter(i => i.severity === 'low').length;

  // Deduct for issues (with caps to avoid negative scores)
  score -= Math.min(criticalCount * 15, 60);
  score -= Math.min(mediumCount   * 5,  30);
  score -= Math.min(lowCount      * 2,  10);

  // Lighthouse performance bonus/penalty
  if (lighthouseData && lighthouseData.performance !== null) {
    const perf = lighthouseData.performance;
    if (perf >= 90) {
      // Great performance: slight bonus
      score += 5;
    } else if (perf < 50) {
      // Poor performance: penalty
      score -= 10;
    } else if (perf < 70) {
      score -= 5;
    }
  }

  // Clamp between 0 and 100
  return Math.max(0, Math.min(100, Math.round(score)));
}

module.exports = { calculateScore };
