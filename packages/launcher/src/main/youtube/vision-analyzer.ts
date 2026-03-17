import fs from 'fs';
import { createRequire } from 'module';
import type {
  DetectedEffect,
  PremiereRecreation,
  EffectCategory,
  ConfidenceLevel,
  TrainingCorrection,
  YouTubeVideoInfo,
} from '@mayday/types';
import { randomUUID } from 'crypto';

// Use createRequire to load the SDK so rollup doesn't bundle it
const require = createRequire(import.meta.url);
const Anthropic = require('@anthropic-ai/sdk').default as typeof import('@anthropic-ai/sdk').default;

const EFFECT_CATEGORIES: EffectCategory[] = [
  'transition', 'color-grade', 'transform', 'overlay',
  'compositing', 'speed-ramp', 'lens-effect', 'other',
];

interface FramePairResult {
  effects: Array<{
    category: EffectCategory;
    secondaryCategories: EffectCategory[];
    description: string;
    confidence: ConfidenceLevel;
    premiereRecreation: PremiereRecreation;
  }>;
}

interface StyleSummary {
  summary: string;
  styleNotes: string;
}

export class VisionAnalyzer {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  async analyzeFramePair(
    frameBeforePath: string,
    frameAfterPath: string,
    context: { videoTitle: string; timestamp: number; previousEffects: string[] },
  ): Promise<FramePairResult> {
    const beforeData = fs.readFileSync(frameBeforePath);
    const afterData = fs.readFileSync(frameAfterPath);

    const systemPrompt = this.buildSystemPrompt();

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze these two consecutive frames from "${context.videoTitle}" at timestamp ${context.timestamp.toFixed(1)}s.

Previously detected effects in this video: ${context.previousEffects.length > 0 ? context.previousEffects.join(', ') : 'None yet'}

Compare BEFORE and AFTER frames. Identify all visual editing effects/changes between them.

Return a JSON object with this exact structure:
{
  "effects": [
    {
      "category": "one of: ${EFFECT_CATEGORIES.join(', ')}",
      "secondaryCategories": [],
      "description": "what changed and how",
      "confidence": "high|medium|low",
      "premiereRecreation": {
        "steps": ["step 1", "step 2"],
        "suggestedEffects": ["Effect Name"],
        "estimatedParameters": {"param": "value"},
        "notes": "any caveats"
      }
    }
  ]
}

If the frames show no significant editing change (just natural motion or a hard cut), return {"effects": []}.`,
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: beforeData.toString('base64'),
              },
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: afterData.toString('base64'),
              },
            },
          ],
        },
      ],
    });

    const text = response.content.find(b => b.type === 'text')?.text || '{"effects":[]}';
    return this.parseResponse(text);
  }

  async analyzeOverallStyle(
    sampleFramePaths: string[],
    videoInfo: YouTubeVideoInfo,
  ): Promise<StyleSummary> {
    const imageBlocks: Anthropic.Messages.ContentBlockParam[] = [
      {
        type: 'text',
        text: `These are sample frames from "${videoInfo.title}" by ${videoInfo.channel} (${videoInfo.duration.toFixed(0)}s, ${videoInfo.resolution}).

Provide:
1. A brief summary of the overall editing style
2. Style notes covering: color palette, pacing/rhythm, transition style, typography, visual mood

Return JSON:
{
  "summary": "2-3 sentence overview",
  "styleNotes": "detailed style observations"
}`,
      },
    ];

    for (const framePath of sampleFramePaths) {
      if (!fs.existsSync(framePath)) continue;
      const data = fs.readFileSync(framePath);
      imageBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: data.toString('base64'),
        },
      });
    }

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: imageBlocks }],
    });

    const text = response.content.find(b => b.type === 'text')?.text || '{}';
    try {
      const json = JSON.parse(this.extractJson(text));
      return {
        summary: json.summary || '',
        styleNotes: json.styleNotes || '',
      };
    } catch {
      return { summary: text.slice(0, 500), styleNotes: '' };
    }
  }

  private buildSystemPrompt(corrections?: TrainingCorrection[]): string {
    let prompt = `You are an expert Premiere Pro editor analyzing consecutive video frames to reverse-engineer editing techniques applied on the timeline.

Your job:
1. Compare before/after frames and identify visual changes caused by deliberate editing
2. Categorize each effect into one of these categories: ${EFFECT_CATEGORIES.join(', ')}
3. Rate your confidence: high (obvious effect), medium (likely effect), low (uncertain)
4. Provide step-by-step Premiere Pro recreation instructions
5. List suggested Premiere Pro effects and estimated parameter values
6. Flag uncertainties explicitly
7. Return structured JSON only — no markdown fences, no extra text

Category definitions (reference Premiere Pro panels and effects):
- transition: Cross Dissolve, Dip to Black, Film Dissolve, wipe transitions, morph cuts — anything in the Video Transitions panel
- color-grade: Lumetri Color adjustments, LUT applications, RGB Curves, HSL Secondary, color wheels, exposure/contrast shifts
- transform: Motion panel keyframes — Scale, Position, Rotation, Anchor Point, Opacity keyframes (linear, bezier, ease in/out)
- overlay: Pre-assembled titles, lower thirds, logos, watermarks, or graphics placed on the timeline (Essential Graphics panel items). All complex visual objects (animated text, infographics, motion graphics) were assembled outside Premiere and placed as a single asset — do NOT break them into sub-components
- compositing: Ultra Key, blend modes, track mattes, masking (pen tool / shape masks), nested sequences used for compositing
- speed-ramp: Time Remapping keyframes, speed/duration changes, freeze frames
- lens-effect: Gaussian Blur, Camera Blur, Warp Stabilizer, vignette, lens distortion effects
- other: Any editing effect that does not fit the above categories

CRITICAL: Do NOT report hard cuts (straight scene changes with no transition effect). If a frame pair is simply a different scene with no creative transition, return {"effects": []}. Hard cuts are not editing effects — they are the absence of a transition.

Distinguish between:
- Deliberate editing effects (transitions, color grades, overlays, compositing)
- Natural motion or camera movement (NOT an editing effect)
- Hard cuts / scene changes with no transition (NOT an editing effect)

Be specific about Premiere Pro effect names and parameters. Reference keyframe types (linear, bezier, ease in/out) where applicable.`;

    if (corrections && corrections.length > 0) {
      prompt += '\n\nPast corrections to learn from:\n';
      for (const corr of corrections.slice(0, 10)) {
        prompt += `- Original: "${corr.originalDescription}" (${corr.originalCategory}) → Correction: "${corr.correctionNote}"${corr.correctedCategory ? ` (should be: ${corr.correctedCategory})` : ''}\n`;
      }
    }

    return prompt;
  }

  private parseResponse(text: string): FramePairResult {
    try {
      const jsonStr = this.extractJson(text);
      const parsed = JSON.parse(jsonStr);
      if (!parsed.effects || !Array.isArray(parsed.effects)) {
        return { effects: [] };
      }
      return {
        effects: parsed.effects.map((e: Record<string, unknown>) => ({
          category: EFFECT_CATEGORIES.includes(e.category as EffectCategory)
            ? e.category as EffectCategory
            : 'other',
          secondaryCategories: Array.isArray(e.secondaryCategories)
            ? (e.secondaryCategories as string[]).filter(c => EFFECT_CATEGORIES.includes(c as EffectCategory)) as EffectCategory[]
            : [],
          description: String(e.description || ''),
          confidence: ['high', 'medium', 'low'].includes(e.confidence as string)
            ? e.confidence as ConfidenceLevel
            : 'medium',
          premiereRecreation: {
            steps: Array.isArray((e.premiereRecreation as Record<string, unknown>)?.steps)
              ? (e.premiereRecreation as Record<string, unknown>).steps as string[]
              : [],
            suggestedEffects: Array.isArray((e.premiereRecreation as Record<string, unknown>)?.suggestedEffects)
              ? (e.premiereRecreation as Record<string, unknown>).suggestedEffects as string[]
              : [],
            estimatedParameters: typeof (e.premiereRecreation as Record<string, unknown>)?.estimatedParameters === 'object'
              ? (e.premiereRecreation as Record<string, unknown>).estimatedParameters as Record<string, string>
              : {},
            notes: String((e.premiereRecreation as Record<string, unknown>)?.notes || ''),
          },
        })),
      };
    } catch {
      return { effects: [] };
    }
  }

  private extractJson(text: string): string {
    // Strip markdown code fences if present
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();

    // Try to find JSON object
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return text.slice(start, end + 1);

    return text;
  }
}
