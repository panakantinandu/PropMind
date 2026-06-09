const { createChatCompletion } = require('./ai.service');

function parseJsonSafe(text) {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1) {
    throw new Error('AI response did not contain JSON');
  }
  const payload = text.substring(first, last + 1);
  return JSON.parse(payload);
}

async function classifyMaintenanceIssue({ title, description }) {
  // Sanitize + limit user input to prevent prompt injection
  const safeTitle = String(title || '').replace(/[`"\\]/g, '').slice(0, 100);
  const safeDesc = String(description || '').replace(/[`"\\]/g, '').slice(0, 500);
  const prompt = `Classify this maintenance request into one of the categories: plumbing, electrical, hvac, structural, appliance, pest_control, general. Also choose a priority: low, medium, high, urgent. Return ONLY valid JSON as follows.

{
  "category": "",
  "priority": "",
  "urgencyScore": 0,
  "estimatedResponseTime": "",
  "suggestedAction": "",
  "summary": "",
  "explanation": ""
}

Request:
Title: ${safeTitle}
Description: ${safeDesc}`;

  const completion = await createChatCompletion([
    { role: 'system', content: 'You are a maintenance triage assistant. Provide only JSON output with category, priority, and explanation.' },
    { role: 'user', content: prompt }
  ], { temperature: 0.2, maxTokens: 350 });

  // const result = parseJsonSafe(completion.choices[0].message.content);
  let result;
  try {
    result = parseJsonSafe(completion.choices[0].message.content);
  } catch (parseErr) {
    return { category: 'general', priority: 'medium', urgencyScore: 5,
      estimatedResponseTime: '24 Hours', suggestedAction: 'Inspect and schedule.',
      summary: safeTitle, explanation: 'AI triage unavailable; manual review needed.' };
  }
  return {
    category: String(result.category || 'general').toLowerCase(),
    priority: String(result.priority || 'medium').toLowerCase(),
    urgencyScore: Number(result.urgencyScore || 0),
    estimatedResponseTime: String(result.estimatedResponseTime || '24 Hours'),
    suggestedAction: String(result.suggestedAction || 'Inspect and schedule maintenance.'),
    summary: String(result.summary || result.explanation || ''),
    explanation: String(result.explanation || 'AI maintenance triage completed.')
  };
}

module.exports = { classifyMaintenanceIssue };