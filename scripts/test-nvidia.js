require('dotenv').config();

const fetch = global.fetch;
const { testNvidiaConnection } = require('../services/ai/ai.service');

async function testRealRiskPrompt() {
  const url = `${(process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '')}/chat/completions`;
  const payload = {
    model: process.env.AI_MODEL || 'deepseek-ai/deepseek-v4-flash',
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
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY || ''}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await res.text();
    console.log('[TEST] REAL_PROMPT_STATUS', res.status, res.statusText);
    console.log('[TEST] REAL_PROMPT_BODY', text);
    return { status: res.status, text };
  } finally {
    clearTimeout(timeout);
  }
}

(async () => {
  try {
    console.log('[TEST] Starting NVIDIA diagnostic request');
    const hello = await testNvidiaConnection();
    console.log('[TEST] HELLO_RESULT', hello);
    await testRealRiskPrompt();
  } catch (err) {
    console.error('[TEST] NVIDIA diagnostic failed');
    console.error(err);
    process.exitCode = 1;
  }
})();
