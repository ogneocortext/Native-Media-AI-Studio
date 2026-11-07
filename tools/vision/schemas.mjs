/**
 * Per-mode JSON schemas for Ollama structured outputs.
 *
 * Ollama accepts a JSON Schema object in the chat `format` field — constrained
 * decoding at the sampler level, which is more reliable for small local models
 * than `format: "json"` plus schema instructions in the prompt (docs.ollama.com
 * /capabilities/structured-outputs). Caveat measured in the wild (photoprism
 * #5450): still model-dependent — reasoning models like qwen3-vl can exhaust
 * num_predict in `thinking` regardless, which analyze.mjs already handles.
 *
 * Design rules (2026 research consensus):
 * - Keep schemas FLAT and SMALL — every extra field is another chance to guess.
 * - `required` lists only the keys the caller actually consumes.
 * - Always include an explicit uncertainty/empty representation so the model
 *   can say "cannot determine" instead of confabulating.
 * - additionalProperties stays true — constrained decoding should shape, not
 *   strangle, the answer.
 */

const loose = { type: 'string' };

export const MODE_SCHEMAS = {
  ui: {
    type: 'object',
    properties: {
      elements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: loose,
            text: loose,
            state: loose,
            issue: loose,
          },
        },
      },
      layout: loose,
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['critical', 'major', 'minor', 'info'] },
            issue: loose,
            fix: loose,
          },
        },
      },
      uncertain: { type: 'array', items: loose },
      summary: loose,
    },
    required: ['findings', 'summary'],
  },

  responsive: {
    type: 'object',
    properties: {
      viewport_fit: loose,
      touch_targets: loose,
      readability: loose,
      navigation: loose,
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['critical', 'major', 'minor', 'info'] },
            issue: loose,
            fix: loose,
          },
        },
      },
      uncertain: { type: 'array', items: loose },
    },
    required: ['findings'],
  },

  regression: {
    type: 'object',
    properties: {
      discrepancies: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            what: loose,
            severity: { type: 'string', enum: ['critical', 'major', 'minor', 'info'] },
            fix: loose,
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
        },
      },
      uncertain: { type: 'array', items: loose },
      summary: loose,
    },
    required: ['discrepancies'],
  },

  compare: {
    type: 'object',
    properties: {
      differences: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            location: loose,
            change: loose,
            impact: loose,
            suggestion: loose,
          },
        },
      },
      promote: { type: 'array', items: loose },
      uncertain: { type: 'array', items: loose },
    },
    required: ['differences'],
  },

  multicomp: {
    type: 'object',
    properties: {
      differences: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            location: loose,
            change: loose,
            severity: { type: 'string', enum: ['critical', 'major', 'minor', 'info'] },
          },
        },
      },
      uncertain: { type: 'array', items: loose },
    },
    required: ['differences'],
  },

  video: {
    type: 'object',
    properties: {
      per_frame: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            t: loose,
            visible_regions: { type: 'array', items: loose },
            notes: loose,
          },
        },
      },
      transitions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            t: loose,
            change: loose,
            severity: { type: 'string', enum: ['critical', 'major', 'minor', 'info'] },
          },
        },
      },
      overlaps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            t: loose,
            elements: loose,
            severity: { type: 'string', enum: ['critical', 'major', 'minor', 'info'] },
          },
        },
      },
      uncertain: { type: 'array', items: loose },
      summary: loose,
    },
    required: ['transitions', 'summary'],
  },

  ocr: {
    type: 'object',
    properties: {
      text: loose,
      tables: { type: 'array', items: loose },
      uncertain_regions: { type: 'array', items: loose },
    },
    required: ['text'],
  },
};

/** Schema for a mode, or null when the mode has no dedicated shape. */
export function schemaForMode(mode) {
  return MODE_SCHEMAS[mode] || null;
}
