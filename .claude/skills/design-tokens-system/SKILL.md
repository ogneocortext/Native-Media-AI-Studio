---
name: design-tokens-system
description: >-
  Create, maintain, and consume a design-token system (color, spacing,
  typography, motion) as CSS custom properties / Tailwind theme values.
  Use when establishing tokens, adding dark mode or theming, migrating
  hardcoded values, or syncing Figma ↔ code — not for page layout or
  component structure decisions.
---

# Skill: design-tokens-system

# Design Tokens System

> [!warning] Design tokens are the atomic units of design — color, spacing, typography, motion, etc. — expressed as platform-agnostic values. This skill covers creating, maintaining, and consuming a token system that works across CSS, Tailwind, React Native, Figma, and code.

## When to Use

- Establishing a new design system
- Migrating from hardcoded values to tokens
- Adding dark mode / theming
- Syncing design (Figma) ↔ code
- Cross-platform (web, mobile, desktop) consistency

## Token Taxonomy

```
design-tokens/
├── color/
│   ├── primitive/       # Raw values (blue-500, #3b82f6)
│   ├── semantic/        # Purpose-based (primary, danger, surface)
│   └── component/       # Component-specific (btn-primary-bg)
├── spacing/
│   ├── scale/           # 0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64
│   └── component/       # card-padding, btn-gap
├── typography/
│   ├── font-family/     # sans, mono, display
│   ├── font-size/       # xs, sm, base, lg, xl, 2xl, 3xl, 4xl
│   ├── font-weight/     # normal, medium, semibold, bold
│   ├── line-height/     # tight, normal, relaxed
│   └── letter-spacing/  # tight, normal, wide
├── border-radius/
│   ├── scale/           # none, sm, md, lg, xl, full
│   └── component/       # btn-radius, card-radius
├── shadow/
│   ├── elevation/       # 1, 2, 3, 4, 5
│   └── component/       # dropdown-shadow, modal-shadow
├── motion/
│   ├── duration/        # instant, fast, normal, slow
│   ├── easing/          # linear, ease-in, ease-out, ease-in-out, spring
│   └── component/       # modal-enter, tooltip-delay
├── z-index/
│   └── layer/           # base, dropdown, modal, toast, tooltip
├── breakpoint/
│   └── viewport/        # sm, md, lg, xl, 2xl
└── opacity/
    └── scale/           # 0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100
```

## Token Format (Style Dictionary / W3C DTCG)

```json
{
  "color": {
    "primitive": {
      "blue": {
        "500": { "value": "#3b82f6", "type": "color" }
      },
      "gray": {
        "900": { "value": "#111827", "type": "color" }
      }
    },
    "semantic": {
      "primary": {
        "value": "{color.primitive.blue.500}",
        "type": "color"
      },
      "surface": {
        "value": "{color.primitive.gray.900}",
        "type": "color"
      }
    }
  },
  "spacing": {
    "scale": {
      "4": { "value": "1rem", "type": "dimension" }
    }
  }
}
```

## Implementation: Tailwind v4 Config

### 1. CSS-First Tokens (Recommended for Tailwind v4)

```css
/* globals.css - Single source of truth */
@theme {
  /* Color Primitives */
  --color-blue-500: #3b82f6;
  --color-gray-900: #111827;
  --color-gray-50: #f9fafb;

  /* Semantic Colors */
  --color-primary: var(--color-blue-500);
  --color-surface: var(--color-gray-900);
  --color-background: var(--color-gray-50);
  --color-text: var(--color-gray-900);
  --color-text-muted: var(--color-gray-500);

  /* Dark mode overrides */
  @media (prefers-color-scheme: dark) {
    --color-surface: var(--color-gray-50);
    --color-background: var(--color-gray-900);
    --color-text: var(--color-gray-50);
    --color-text-muted: var(--color-gray-400);
  }

  /* Spacing Scale */
  --spacing-1: 0.25rem;   /* 4px */
  --spacing-2: 0.5rem;    /* 8px */
  --spacing-3: 0.75rem;   /* 12px */
  --spacing-4: 1rem;      /* 16px */
  --spacing-5: 1.25rem;   /* 20px */
  --spacing-6: 1.5rem;    /* 24px */
  --spacing-8: 2rem;      /* 32px */
  --spacing-10: 2.5rem;   /* 40px */
  --spacing-12: 3rem;     /* 48px */
  --spacing-16: 4rem;     /* 64px */

  /* Typography */
  --font-sans: "Geist", system-ui, sans-serif;
  --font-mono: "Geist Mono", monospace;
  --font-display: "Cal Sans", "Geist", sans-serif;

  --text-xs: 0.75rem;      /* 12px */
  --text-sm: 0.875rem;     /* 14px */
  --text-base: 1rem;       /* 16px */
  --text-lg: 1.125rem;     /* 18px */
  --text-xl: 1.25rem;      /* 20px */
  --text-2xl: 1.5rem;      /* 24px */
  --text-3xl: 1.875rem;    /* 30px */
  --text-4xl: 2.25rem;     /* 36px */

  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;

  /* Border Radius */
  --radius-sm: 0.25rem;    /* 4px */
  --radius-md: 0.375rem;   /* 6px */
  --radius-lg: 0.5rem;     /* 8px */
  --radius-xl: 0.75rem;    /* 12px */
  --radius-2xl: 1rem;      /* 16px */
  --radius-full: 9999px;

  /* Shadows */
  --shadow-1: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-2: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
  --shadow-3: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  --shadow-4: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
  --shadow-5: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);

  /* Motion */
  --duration-instant: 0ms;
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 350ms;

  --ease-linear: linear;
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Z-Index Layers */
  --z-base: 0;
  --z-dropdown: 100;
  --z-modal: 200;
  --z-toast: 300;
  --z-tooltip: 400;

  /* Breakpoints */
  --breakpoint-sm: 640px;
  --breakpoint-md: 768px;
  --breakpoint-lg: 1024px;
  --breakpoint-xl: 1280px;
  --breakpoint-2xl: 1536px;
}
```

### 2. Consuming Tokens in Tailwind

```tsx
// Direct usage via arbitrary values (always works)
<div className="bg-[var(--color-primary)] text-[var(--color-text)] p-[var(--spacing-4)] rounded-[var(--radius-lg)]" />

// Or map to Tailwind utilities (recommended)
```

### 3. Tailwind Config Mapping (tailwind.config.ts)

```ts
import type { Config } from "tailwindcss";

export default {
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        surface: "var(--color-surface)",
        background: "var(--color-background)",
        text: "var(--color-text)",
        "text-muted": "var(--color-text-muted)",
      },
      spacing: {
        // Uses CSS vars automatically in v4
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
        display: ["var(--font-display)"],
      },
      fontSize: {
        xs: ["var(--text-xs)", { lineHeight: "var(--leading-tight)" }],
        sm: ["var(--text-sm)", { lineHeight: "var(--leading-normal)" }],
        base: ["var(--text-base)", { lineHeight: "var(--leading-normal)" }],
        lg: ["var(--text-lg)", { lineHeight: "var(--leading-relaxed)" }],
        xl: ["var(--text-xl)", { lineHeight: "var(--leading-relaxed)" }],
        "2xl": ["var(--text-2xl)", { lineHeight: "var(--leading-tight)" }],
        "3xl": ["var(--text-3xl)", { lineHeight: "var(--leading-tight)" }],
        "4xl": ["var(--text-4xl)", { lineHeight: "var(--leading-tight)" }],
      },
      fontWeight: {
        normal: "var(--font-weight-normal)",
        medium: "var(--font-weight-medium)",
        semibold: "var(--font-weight-semibold)",
        bold: "var(--font-weight-bold)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        1: "var(--shadow-1)",
        2: "var(--shadow-2)",
        3: "var(--shadow-3)",
        4: "var(--shadow-4)",
        5: "var(--shadow-5)",
      },
      transitionDuration: {
        instant: "var(--duration-instant)",
        fast: "var(--duration-fast)",
        normal: "var(--duration-normal)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        linear: "var(--ease-linear)",
        in: "var(--ease-in)",
        out: "var(--ease-out)",
        "in-out": "var(--ease-in-out)",
        spring: "var(--ease-spring)",
      },
      zIndex: {
        base: "var(--z-base)",
        dropdown: "var(--z-dropdown)",
        modal: "var(--z-modal)",
        toast: "var(--z-toast)",
        tooltip: "var(--z-tooltip)",
      },
      screens: {
        sm: "var(--breakpoint-sm)",
        md: "var(--breakpoint-md)",
        lg: "var(--breakpoint-lg)",
        xl: "var(--breakpoint-xl)",
        "2xl": "var(--breakpoint-2xl)",
      },
    },
  },
} satisfies Config;
```

## Semantic Token Mapping (The "Right" Way)

### Color Semantics
| Primitive | Semantic Light | Semantic Dark | Usage |
|-----------|----------------|---------------|-------|
| `blue-500` | `primary` | `primary` | Buttons, links, focus |
| `gray-900` | `surface` | `background` | Cards, containers |
| `gray-50` | `background` | `surface` | Page bg |
| `gray-900` | `text` | `text` | Primary text |
| `gray-500` | `text-muted` | `text-muted` | Secondary text |
| `green-500` | `success` | `success` | Success states |
| `red-500` | `danger` | `danger` | Errors, destructive |
| `amber-500` | `warning` | `warning` | Warnings |
| `violet-500` | `accent` | `accent` | Highlights |

### Component Tokens (Derived)
```css
/* Button */
--btn-primary-bg: var(--color-primary);
--btn-primary-text: white;
--btn-primary-hover: color-mix(in srgb, var(--color-primary) 90%, black);
--btn-secondary-bg: var(--color-surface);
--btn-secondary-text: var(--color-text);
--btn-radius: var(--radius-lg);
--btn-padding-x: var(--spacing-4);
--btn-padding-y: var(--spacing-2);

/* Card */
--card-bg: var(--color-surface);
--card-border: var(--color-border);
--card-radius: var(--radius-xl);
--card-padding: var(--spacing-6);

/* Input */
--input-bg: var(--color-background);
--input-border: var(--color-border);
--input-focus-ring: var(--color-primary);
--input-radius: var(--radius-md);
```

## Theming Strategy

### 1. CSS Custom Properties (Runtime Theming)
```css
:root {
  --color-primary: #3b82f6;
}

[data-theme="dark"] {
  --color-primary: #60a5fa;
}

[data-theme="high-contrast"] {
  --color-primary: #1d4ed8;
}
```

```tsx
// Toggle theme
const toggleTheme = () => {
  document.documentElement.dataset.theme = 
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
};
```

### 2. Multiple Themes (Brand, Seasonal, Accessibility)
```css
/* Base */
:root { --color-primary: #3b82f6; }

/* Brand variants */
[data-brand="acme"] { --color-primary: #ef4444; }
[data-brand="globex"] { --color-primary: #22c55e; }

/* Accessibility */
[data-contrast="high"] { --color-primary: #1d4ed8; }
@media (prefers-reduced-motion: reduce) {
  :root { --duration-normal: 0ms; --duration-fast: 0ms; --duration-slow: 0ms; }
}
```

## Figma ↔ Code Sync

### 1. Tokens Studio (Figma Plugin) → Style Dictionary → Tailwind
```
Figma (Tokens Studio)
    ↓ Export JSON
Style Dictionary (build)
    ↓ Transform
CSS Custom Properties + Tailwind Config
    ↓ Consume
React Components
```

### 2. Token Naming Convention
```
{category}.{subcategory}.{property}.{variant}.{state}

Examples:
color.primitive.blue.500
color.semantic.primary
color.semantic.primary.hover
spacing.scale.4
typography.fontSize.lg
borderRadius.component.card
shadow.elevation.3
motion.duration.normal
```

## Token Documentation (Auto-Generated)

```ts
// tokens.d.ts - TypeScript types for tokens
export interface DesignTokens {
  color: {
    primitive: Record<string, Record<string, string>>;
    semantic: {
      primary: string;
      surface: string;
      background: string;
      text: string;
      "text-muted": string;
      success: string;
      danger: string;
      warning: string;
      accent: string;
    };
  };
  spacing: { scale: Record<string, string> };
  typography: {
    fontFamily: { sans: string; mono: string; display: string };
    fontSize: Record<string, string>;
    fontWeight: Record<string, string>;
    lineHeight: Record<string, string>;
  };
  borderRadius: { scale: Record<string, string> };
  shadow: { elevation: Record<string, string> };
  motion: {
    duration: Record<string, string>;
    easing: Record<string, string>;
  };
  zIndex: { layer: Record<string, string> };
  breakpoint: { viewport: Record<string, string> };
}
```

## Validation & Testing

```ts
// test/tokens.test.ts
import { designTokens } from "@/tokens";

describe("Design Tokens", () => {
  test("semantic colors reference primitives", () => {
    expect(designTokens.color.semantic.primary).toMatch(/^\{color\.primitive\./);
  });

  test("spacing scale is consistent", () => {
    const scale = designTokens.spacing.scale;
    expect(scale["4"]).toBe("1rem");
    expect(scale["8"]).toBe("2rem");
  });

  test("dark mode overrides exist", () => {
    // Verify CSS has @media (prefers-color-scheme: dark)
  });
});
```

## Anti-Patterns

| ❌ Don't | ✅ Do |
|----------|-------|
| Hardcode `#3b82f6` in components | Use `var(--color-primary)` |
| Duplicate values across files | Single source in CSS vars |
| Mix semantic + primitive in same rule | Semantic for UI, primitive for brand |
| Skip dark mode values | Every token has light/dark |
| Arbitrary opacity (`bg-blue-500/50`) | `bg-primary/50` via semantic |
| Magic numbers in animation | `duration-normal`, `ease-out` |

## Usage in This Repo

```tsx
// globals.css - defines all tokens as CSS vars
// tailwind.config.ts - maps tokens to Tailwind utilities

// Component usage:
<button className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors duration-fast ease-out">
  Primary Action
</button>

<Card className="bg-surface border-border shadow-3 p-6 rounded-xl">
  <h3 className="text-xl font-semibold text-text">Title</h3>
  <p className="text-text-muted mt-2">Description</p>
</Card>
```