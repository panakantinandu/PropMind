const fetch = (typeof global.fetch === 'function') ? global.fetch : require('node-fetch');
const OpenAI = require('openai');

const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
const apiKey = provider === 'nvidia'
  ? process.env.NVIDIA_API_KEY
  : process.env.OPENAI_API_KEY;
const baseURL = provider === 'nvidia'
  ? process.env.NVIDIA_BASE_URL
  : process.env.OPENAI_API_BASE_URL;

if (!apiKey) {
  throw new Error(`Missing API key for AI_PROVIDER=${provider}`);
}

// Simple in-memory rate limiter (per-process). Config via AI_RATE_LIMIT (requests/minute)
// const RATE_LIMIT = Number(process.env.AI_RATE_LIMIT || 60);
// let rateCount = 0;
// let rateWindowStart = Date.now();
// function checkRateLimit() {
//   if (!RATE_LIMIT || RATE_LIMIT <= 0) return;
//   const now = Date.now();
//   if (now - rateWindowStart > 60000) {
//     rateWindowStart = now;
//     rateCount = 0;
//   }
//   rateCount += 1;
//   if (rateCount > RATE_LIMIT) {
//     const err = new Error('AI rate limit exceeded');
//     err.code = 'AI_RATE_LIMIT';
//     throw err;
//   }
// }

// Redis-backed rate limiter (shared across all processes)
const RATE_LIMIT = Number(process.env.AI_RATE_LIMIT || 60);
const Redis = (() => { try { return require('ioredis'); } catch { return null; } })();
const redis = Redis && process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false })
  : null;

async function checkRateLimit() {
  if (!RATE_LIMIT || RATE_LIMIT <= 0) return;
  if (!redis) return; // fallback: no limit if Redis unavailable
  const key = 'ai:ratelimit:' + Math.floor(Date.now() / 60000);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 65);
  if (count > RATE_LIMIT) {
    const err = new Error('AI rate limit exceeded');
    err.code = 'AI_RATE_LIMIT';
    throw err;
  }
}

function sanitizeInput(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/[<>]/g, '').trim();
}

function formatStatusError(status, text) {
  if (status === 401) return '401 Unauthorized - authentication failed';
  if (status === 403) return '403 Forbidden - model/access denied';
  if (status === 404) return '404 Not Found - endpoint or model path invalid';
  if (status === 429) return '429 Rate Limit - quota exceeded';
  if (status >= 500) return `5xx server error (${status})`;
  return `HTTP ${status}`;
}

async function testNvidiaConnection() {
  const providerName = 'nvidia';
  const url = `${(process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '')}/chat/completions`;
  const model = process.env.AI_MODEL || process.env.NVIDIA_MODEL || 'deepseek-ai/deepseek-v4-flash';
  const timeoutMs = Number(process.env.AI_NVIDIA_TIMEOUT_MS || 30000);
  const payload = {
    model,
    messages: [{ role: 'user', content: 'Reply only HELLO' }],
    temperature: 0,
    max_tokens: 16,
    n: 1
  };

  console.log('[AI DEBUG] provider=nvidia');
  console.log(`[AI DEBUG] url=${url}`);
  console.log(`[AI DEBUG] model=${model}`);
  console.log(`[AI DEBUG] timeout=${timeoutMs}`);
  console.log(`[AI DEBUG] apiKeyPresent=${Boolean(process.env.NVIDIA_API_KEY)}`);
  console.log('[AI DEBUG] requestBody=' + JSON.stringify(payload));

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.NVIDIA_API_KEY || ''}`
    },
    body: JSON.stringify(payload),
    ...(controller ? { signal: controller.signal } : {})
  };

  try {
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`NVIDIA API request timed out after ${timeoutMs}ms`)), timeoutMs));
    const res = await Promise.race([fetch(url, requestOptions), timeoutPromise]);
    const text = await res.text();
    console.log(`[AI DEBUG] status=${res.status}`);
    console.log(`[AI DEBUG] statusText=${res.statusText || ''}`);
    console.log(`[AI DEBUG] responseBody=${text}`);

    if (!res.ok) {
      const detail = formatStatusError(res.status, text);
      console.error('[AI DEBUG] classifiedError=' + detail);
      throw new Error(detail + (text ? ` | ${text}` : ''));
    }

    return { ok: true, status: res.status, body: text, model, url };
  } catch (err) {
    console.error('[AI DEBUG] exception=' + (err && err.message ? err.message : String(err)));
    if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timed out/i.test(err.message || '')) {
      console.error('[AI DEBUG] networkErrorDetected=true');
    }
    throw err;
  }
}

async function createChatCompletion(messages, options = {}) {
  checkRateLimit();

  const sanitizedMessages = messages.map(msg => ({
    role: msg.role,
    content: sanitizeInput(msg.content)
  }));

  if (provider === 'nvidia') {
    const configuredModel = process.env.AI_MODEL || process.env.NVIDIA_MODEL || 'deepseek-ai/deepseek-v4-flash';
    // const model = /deepseek|flash|v4/i.test(configuredModel)
    //   ? 'meta/llama-3.2-3b-instruct'
    //   : (configuredModel || 'meta/llama-3.2-3b-instruct');
    const model = process.env.AI_MODEL || process.env.NVIDIA_MODEL || 'deepseek-ai/deepseek-v4-flash';
    const timeoutMs = Number(process.env.AI_NVIDIA_TIMEOUT_MS || 30000);
    const url = `${baseURL.replace(/\/+$/,'')}/chat/completions`;
    const payload = {
      model,
      messages: sanitizedMessages,
      temperature: 0,
      max_tokens: options.maxTokens ?? 500,
      n: 1
    };

    const requestStart = Date.now();
    console.log('[AI DEBUG] provider=nvidia');
    console.log(`[AI DEBUG] url=${url}`);
    console.log(`[AI DEBUG] model=${model}`);
    console.log(`[AI DEBUG] timeout=${timeoutMs}`);
    console.log(`[AI DEBUG] apiKeyPresent=${Boolean(apiKey)}`);
    console.log('[AI DEBUG] requestBody=' + JSON.stringify(payload));
    console.log('[AI] Request Sent', { provider: 'nvidia', model, timeoutMs });

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      ...(controller ? { signal: controller.signal } : {})
    };

    let timeoutId;
    if (controller) {
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`NVIDIA API request timed out after ${timeoutMs}ms`)), timeoutMs));
      const res = await Promise.race([fetch(url, requestOptions), timeoutPromise]);
      const duration = Date.now() - requestStart;
      const responseText = await res.text();
      console.log(`[AI DEBUG] status=${res.status}`);
      console.log(`[AI DEBUG] statusText=${res.statusText || ''}`);
      console.log(`[AI DEBUG] responseBody=${responseText}`);
      console.log('[AI] Response Received', { provider: 'nvidia', status: res.status, durationMs: duration });

      if (!res.ok) {
        const err = new Error(`NVIDIA API error: ${res.status} ${responseText}`);
        err.status = res.status;
        err.body = responseText;
        if (res.status === 401) console.error('[AI DEBUG] classifiedError=401 Unauthorized - authentication failed');
        if (res.status === 403) console.error('[AI DEBUG] classifiedError=403 Forbidden - model/access denied');
        if (res.status === 404) console.error('[AI DEBUG] classifiedError=404 Not Found - endpoint or model path invalid');
        if (res.status === 429) console.error('[AI DEBUG] classifiedError=429 Rate Limit - quota exceeded');
        if (res.status >= 500) console.error('[AI DEBUG] classifiedError=5xx server error');
        throw err;
      }

      const json = responseText ? JSON.parse(responseText) : {};
      const content = (json.choices && json.choices[0] && (json.choices[0].message?.content || json.choices[0].text))
        || (json.completions && json.completions[0] && json.completions[0].data && json.completions[0].data[0] && json.completions[0].data[0].text)
        || '';

      return { choices: [{ message: { content } }] };
    } catch (err) {
      const duration = Date.now() - requestStart;
      if (err.name === 'AbortError' || /timed out/i.test(err.message)) {
        console.error('[AI DEBUG] networkErrorDetected=true');
        console.error('[AI] Error', { provider: 'nvidia', duration, timeoutMs, error: err.message });
        throw new Error(`NVIDIA API request timed out after ${timeoutMs}ms`);
      }
      console.error('[AI DEBUG] exception=' + (err && err.message ? err.message : String(err)));
      console.error('[AI] Error', { provider: 'nvidia', duration, error: err.message });
      throw err;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  const openAiStart = Date.now();
  console.log('[AI] Request Sent', { provider: 'openai', model: process.env.AI_MODEL || 'gpt-4o-mini' });
  const client = new OpenAI({ apiKey, baseURL });
  const response = await client.chat.completions.create({
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    messages: sanitizedMessages,
    temperature: 0,
    max_tokens: options.maxTokens ?? 500,
    n: 1
  });
  console.log('[AI] Response Received', { provider: 'openai', durationMs: Date.now() - openAiStart });
  return response;
}

module.exports = { createChatCompletion, testNvidiaConnection };