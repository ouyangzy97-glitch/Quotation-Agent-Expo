import { secrets } from 'base44:runtime';

// modelKey：'pro'=默认配置的模型；'flash'=DeepSeek V4 Flash（独立模型名，思考模式默认关闭）
export function getLlmConfig(modelKey) {
  const provider = (secrets.get('LLM_PROVIDER') || 'deepseek').trim();
  const isRouter = provider === 'openrouter';
  const baseUrl = ((isRouter ? secrets.get('OPENROUTER_BASE_URL') : secrets.get('DEEPSEEK_BASE_URL')) || '').trim();
  const apiKey = ((isRouter ? secrets.get('OPENROUTER_API_KEY') : secrets.get('DEEPSEEK_API_KEY')) || '').trim();
  let model = ((isRouter ? secrets.get('OPENROUTER_MODEL') : secrets.get('DEEPSEEK_MODEL')) || '').trim();
  let thinking = null;
  if (modelKey === 'flash') {
    model = (secrets.get('DEEPSEEK_FLASH_MODEL') || 'deepseek-flash').trim();
    thinking = (secrets.get('DEEPSEEK_FLASH_THINKING') || 'disabled').trim().toLowerCase() === 'enabled' ? 'enabled' : 'disabled';
  }
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const url = /\/chat\/completions$/.test(cleanBase) ? cleanBase : cleanBase + '/chat/completions';
  return { provider, url, apiKey, model, thinking };
}

// 调用配置的 LLM（DeepSeek 直连或 OpenRouter 中转），返回原始文本内容。
async function requestLlm(system, user, timeoutMs, jsonMode, modelKey) {
  const { url, apiKey, model, thinking, provider } = getLlmConfig(modelKey);
  if (!apiKey || !model) {
    throw new Error('LLM 未配置：请在应用设置的 Secrets 中填入 ' + (provider === 'openrouter' ? 'OPENROUTER_' : 'DEEPSEEK_') + 'API_KEY 和模型名');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      stream: false,
      ...(thinking ? { thinking: { type: thinking } } : {}),
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
    // Flash：读取超时放宽到 120s（llm_read_timeout）
    signal: AbortSignal.timeout(modelKey === 'flash' ? Math.max(timeoutMs, 120000) : timeoutMs),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('LLM 调用失败 (' + res.status + '): ' + t.slice(0, 300));
  }
  const data = await res.json();
  return String((data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
}

// 要求返回 JSON 对象。
export async function llmJson(system, user, timeoutMs = 110000, modelKey) {
  let content = await requestLlm(system, user, timeoutMs, true, modelKey);
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) content = fence[1].trim();
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start >= 0 && end > start) content = content.slice(start, end + 1);
  return JSON.parse(content);
}

// 返回自由文本回答（不要求 JSON 格式）。
export async function llmText(system, user, timeoutMs = 110000, modelKey) {
  return requestLlm(system, user, timeoutMs, false, modelKey);
}

// 加载城市节点库的全部规范名与别名，用于在代码中判断城市是否命中。
export async function loadCityNames(base44) {
  const cityPage = await base44.entities.CityNode.list({ limit: 500 });
  const names = new Set();
  for (const c of cityPage.items || []) {
    if (c.city) names.add(c.city);
    for (const a of c.aliases || []) if (a) names.add(a);
  }
  return Array.from(names);
}

// 加载团队知识库与城市节点库，拼装为识别提示词上下文。
export async function loadTeamContext(base44) {
  const [cityPage, kbPage] = await Promise.all([
    base44.entities.CityNode.list({ limit: 500 }),
    base44.entities.KnowledgeEntry.filter({ enabled: true }, { limit: 500 }),
  ]);
  const cities = cityPage.items || [];
  const kb = kbPage.items || [];
  const cityLines = cities.map((c) => {
    const alias = (c.aliases || []).join(' / ');
    return '- ' + c.city + '（' + (c.type === 'domestic' ? '国内' : '国外') + (c.country ? '，' + c.country : '') + '）' + (alias ? ' 别名：' + alias : '');
  });
  const kbLines = kb.map((k) => {
    if (k.kind === 'term_mapping') return '- [术语映射/' + (k.category || 'other') + '] ' + k.term + ' → ' + (k.mapped_value || '');
    return '- [' + (k.kind === 'correction' ? '修正经验' : '识别规则') + '] ' + (k.content || '');
  });
  return '【城市节点库】起终点必须使用以下规范城市名（括号内为别名，需映射为规范名）：\n' +
    (cityLines.join('\n') || '（城市库为空，请提示专家先补充）') +
    '\n\n【知识库】\n' + (kbLines.join('\n') || '（暂无）');
}