const { createChatCompletion } = require('./ai.service');

function normalizeConfidence(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return num > 1 ? Math.min(100, num) : Math.min(100, num * 100);
}

function parseJsonSafe(text) {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1) {
    throw new Error('AI response did not contain JSON');
  }
  const payload = text.substring(first, last + 1);
  return JSON.parse(payload);
}

async function analyzeTenantRisk(data) {
  const rentToIncomeRatio = Number(((data.rentToIncomeRatio ?? (Number(data.propertyRent || data.rent) / Math.max(Number(data.monthlyIncome) || 1, 1))).toFixed(2)));
  const compactInput = {
    monthlyIncome: Number(data.monthlyIncome) || 0,
    propertyRent: Number(data.propertyRent || data.rent) || 0,
    occupation: data.occupation || data.employmentStatus || 'Unknown',
    leaseDuration: Number(data.leaseDuration) || 0,
    previousLatePayments: Number(data.previousLatePayments) || 0,
    applicationHistoryCount: Number(data.applicationHistoryCount || data.applicationHistory) || 0,
    rentToIncomeRatio
  };

  const prompt = `Classify tenant risk from this compact data only. Return strict JSON with these keys only: riskLevel, confidenceScore, recommendation, explanation, riskFactors, strengths, weaknesses, decisionReason.
Use riskLevel as LOW, MEDIUM, or HIGH; recommendation as APPROVE, REVIEW, or REJECT; confidenceScore as 0-100.
Data:${JSON.stringify(compactInput)}`;

  try {
    const completion = await createChatCompletion([
      { role: 'system', content: 'You are a compact tenant risk classifier. Return strict JSON only.' },
      { role: 'user', content: prompt }
    ], { temperature: 0.1, maxTokens: 400 });

    const parsed = parseJsonSafe(completion.choices[0].message.content);

    return {
      riskLevel: String(parsed.riskLevel || 'UNKNOWN').toUpperCase(),
      confidenceScore: normalizeConfidence(parsed.confidenceScore),
      recommendation: String(parsed.recommendation || 'REVIEW').toUpperCase(),
      explanation: String(parsed.explanation || 'AI analysis completed.'),
      riskFactors: Array.isArray(parsed.riskFactors) ? parsed.riskFactors : [],
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
      decisionReason: String(parsed.decisionReason || parsed.explanation || 'AI analysis completed.')
    };
  } catch (error) {
    const fallbackRisk = rentToIncomeRatio > 0.45 || Number(compactInput.previousLatePayments) > 0 ? 'HIGH' : rentToIncomeRatio > 0.30 ? 'MEDIUM' : 'LOW';
    const fallbackConfidence = Math.max(45, Math.min(95, 75 - (Number(compactInput.previousLatePayments) * 8) + (rentToIncomeRatio > 0.35 ? 10 : 0)));
    return {
      riskLevel: fallbackRisk,
      confidenceScore: normalizeConfidence(Math.round(fallbackConfidence) / 100),
      recommendation: fallbackRisk === 'HIGH' ? 'REJECT' : fallbackRisk === 'MEDIUM' ? 'REVIEW' : 'APPROVE',
      explanation: 'AI fallback heuristics applied due to model response formatting.',
      riskFactors: [
        rentToIncomeRatio > 0.45 ? 'High rent-to-income ratio' : 'Rent-to-income ratio is within a normal range',
        Number(compactInput.previousLatePayments) > 0 ? 'Prior late payments detected' : 'No prior late payment history found'
      ],
      strengths: Number(compactInput.monthlyIncome) >= 30000 ? ['Stable income level'] : ['Income is available for the application'],
      weaknesses: rentToIncomeRatio > 0.35 ? ['Higher rent-to-income burden'] : [],
      decisionReason: 'AI review used the available application profile and fallback rules because the model response was not usable in the standard format.'
    };
  }
}

module.exports = { analyzeTenantRisk };