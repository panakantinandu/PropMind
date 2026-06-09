require('dotenv').config();

const fetch = global.fetch;

const models = [
  'meta/llama-3.2-3b-instruct',
  'meta/llama-3.1-8b-instruct'
];

async function probe(model) {
  const url = `${(process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '')}/chat/completions`;
  const payload = {
    model,
    messages: [
      { role: 'system', content: 'You are a compact tenant risk classifier. Return strict JSON only.' },
      { role: 'user', content: 'Classify tenant risk from this compact data only. Return JSON with exactly: riskLevel, confidenceScore, recommendation, explanation. Data:{"monthlyIncome":10000,"propertyRent":2000,"occupation":"Engineer","leaseDuration":12,"previousLatePayments":0,"applicationHistoryCount":1,"rentToIncomeRatio":0.2}' }
    ],
    temperature: 0,
    max_tokens: 80,
    n: 1
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NVIDIA_API_KEY || ''}` }, body: JSON.stringify(payload), signal: controller.signal });
    const text = await res.text();
    return { model, status: res.status, statusText: res.statusText, body: text };
  } catch (err) {
    return { model, error: err.name + ': ' + err.message };
  } finally {
    clearTimeout(timeout);
  }
}

(async () => {
  for (const model of models) {
    const result = await probe(model);
    console.log('[MODEL_TEST]', JSON.stringify(result));
  }
})();
