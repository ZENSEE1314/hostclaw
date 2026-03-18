// NVIDIA NeMo / NIM API Configuration
// Get free API key at: https://build.nvidia.com/

module.exports = {
  name: 'NVIDIA',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  models: [
    {
      id: 'nvidia/llama-3.1-nemotron-70b-instruct',
      name: 'Nemotron-70B Instruct',
      maxTokens: 32768,
      free: true
    },
    {
      id: 'meta/llama-3.1-70b-instruct',
      name: 'Llama 3.1 70B',
      maxTokens: 128000,
      free: true
    },
    {
      id: 'meta/llama-3.1-405b-instruct',
      name: 'Llama 3.1 405B',
      maxTokens: 128000,
      free: true
    },
    {
      id: 'mistralai/mixtral-8x22b-instruct-v0.1',
      name: 'Mixtral 8x22B',
      maxTokens: 65536,
      free: true
    }
  ],
  
  async chat(messages, model, apiKey) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 1024,
        temperature: 0.7,
        stream: false
      })
    });
    
    if (!response.ok) {
      throw new Error(`NVIDIA API error: ${response.status}`);
    }
    
    return await response.json();
  },
  
  async validateKey(apiKey) {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
};
