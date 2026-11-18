// Explicit presets never redirect a saved key to a configurable host.
const compatible = (name, baseUrl, model = '') => ({ name, kind: 'compatible', baseUrl, model });
const local = (name, baseUrl) => ({ ...compatible(name, baseUrl), editableUrl: true, optionalKey: true });

export const providerCatalog = Object.freeze({
  openai: compatible('OpenAI', 'https://api.openai.com/v1', 'gpt-4o-mini'),
  anthropic: { name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: '' },
  gemini: { name: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: '' },
  openrouter: compatible('OpenRouter', 'https://openrouter.ai/api/v1'),
  groq: compatible('Groq', 'https://api.groq.com/openai/v1'),
  deepseek: compatible('DeepSeek', 'https://api.deepseek.com/v1'),
  mistral: compatible('Mistral AI', 'https://api.mistral.ai/v1'),
  xai: compatible('xAI', 'https://api.x.ai/v1'),
  fireworks: compatible('Fireworks AI', 'https://api.fireworks.ai/inference/v1'),
  cerebras: compatible('Cerebras', 'https://api.cerebras.ai/v1'),
  nvidia: compatible('NVIDIA NIM', 'https://integrate.api.nvidia.com/v1'),
  ollama: local('Ollama', 'http://127.0.0.1:11434/v1'),
  lmstudio: local('LM Studio', 'http://127.0.0.1:1234/v1'),
  custom: local('Custom (OpenAI-compatible)', ''),
});
