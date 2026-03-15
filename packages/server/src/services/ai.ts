import Anthropic from '@anthropic-ai/sdk';
import type { AICompletionOptions, AITimelineAnalysis, TimelineContext } from '@mayday/types';

export class AIService {
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in environment');
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  async complete(prompt: string, options?: AICompletionOptions): Promise<string> {
    const client = this.getClient();
    const response = await client.messages.create({
      model: options?.model || 'claude-sonnet-4-20250514',
      max_tokens: options?.maxTokens || 1024,
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.system ? { system: options.system } : {}),
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock ? textBlock.text : '';
  }

  async *stream(prompt: string, options?: AICompletionOptions): AsyncIterable<string> {
    const client = this.getClient();
    const stream = await client.messages.stream({
      model: options?.model || 'claude-sonnet-4-20250514',
      max_tokens: options?.maxTokens || 1024,
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.system ? { system: options.system } : {}),
      messages: [{ role: 'user', content: prompt }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  async *streamWithHistory(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    options?: AICompletionOptions
  ): AsyncIterable<string> {
    const client = this.getClient();
    const stream = await client.messages.stream({
      model: options?.model || 'claude-sonnet-4-20250514',
      max_tokens: options?.maxTokens || 2048,
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.system ? { system: options.system } : {}),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  async analyzeTimeline(timelineContext: TimelineContext, userContext?: string): Promise<AITimelineAnalysis> {
    const prompt = `Analyze this video timeline and provide suggestions:

Timeline: ${JSON.stringify(timelineContext, null, 2)}
${userContext ? `\nContext: ${userContext}` : ''}

Respond with JSON matching this structure:
{
  "summary": "brief description of the timeline",
  "suggestions": ["suggestion 1", "suggestion 2"],
  "structure": [{"start": 0, "end": 10, "label": "intro"}]
}`;

    const result = await this.complete(prompt, {
      system: 'You are a video editing assistant. Respond only with valid JSON.',
      temperature: 0.3,
    });

    return JSON.parse(result);
  }
}
