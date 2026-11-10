---
name: responsive-design-patterns
description: >-
  Battle-tested responsive patterns for Tailwind v4 breakpoints
  (sm/md/lg/xl/2xl): fluid grids, container queries, logical properties,
  breakpoint-specific behavior, overflow prevention. Use when building
  cross-device components, fixing breakpoint-specific layout breaks, or
  auditing responsive behavior — for mobile-first philosophy see
  mobile-first-design.
---

# Skill: responsive-design-patterns

> **Scope:** imported reference guidance, not studio workflow. For studio surfaces the visual style system and visual-hierarchy win on any conflict. Mobile-first and responsive material here targets public-web surfaces, not studio chrome.

# Responsive Design Patterns

> [!warning] This skill provides battle-tested responsive patterns for Tailwind v4 (sm/md/lg/xl/2xl breakpoints). Use when building or refactoring any page that must work across 320px–1920px+.

## When to Use

- Building new pages/components that need cross-device support
- Fixing layout breaks at specific breakpoints
- Establishing consistent responsive behavior across the app
- Auditing existing pages for responsive issues

## Core Breakpoint Strategy (Tailwind v4)

| Breakpoint | Min Width | Target Device | Typical Use |
|------------|-----------|---------------|-------------|
| (none) | 0px | Mobile (320–639px) | Base styles, stacked layouts |
| `sm` | 640px | Large mobile / small tablet | Side-by-side controls, 2-col grids |
| `md` | 768px | Tablet | 3-col grids, inline forms |
| `lg` | 1024px | Laptop / desktop | Full layouts, sidebars visible |
| `xl` | 1280px | Large desktop | Extra whitespace, larger grids |
| `2xl` | 1536px | Ultra-wide | Max-width containers, generous spacing |

**No `xs` breakpoint exists in Tailwind v4** — use base (mobile-first) + `sm:` for 480px-ish tweaks.

## Pattern Library

### 1. Fluid Container
```tsx
// Base: full width, sm: constrained, lg: wider, xl: max
<div className="w-full px-4 sm:px-6 lg:px-8 xl:max-w-7xl mx-auto">
```

### 2. Responsive Grid (Progressive Enhancement)
```tsx
// 1 col → 2 col → 3 col → 4 col
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
```

### 3. Sidebar + Main (Holy Grail)
```tsx
<div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
  <aside className="lg:col-span-1">Sidebar</aside>
  <main className="lg:col-span-3">Content</main>
</div>
```

### 4. Stacked → Inline Controls
```tsx
// Mobile: stacked, Desktop: inline
<div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
  <label className="w-full sm:w-auto">Label</label>
  <input className="w-full sm:w-64" />
</div>
```

### 5. Tab Bar (Scrollable on Mobile)
```tsx
<div className="flex gap-1 overflow-x-auto pb-1 -mx-2 px-2 whitespace-nowrap">
  {tabs.map(t => <button key={t.id} className="flex-shrink-0 px-3 py-2">{t.label}</button>)}
</div>
```

### 6. Table Wrapper (Horizontal Scroll)
```tsx
<div className="overflow-x-auto">
  <table className="w-full min-w-[600px]">...</table>
</div>
```

### 7. Responsive Typography
```tsx
// Base → sm → lg scaling
<h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold">
<p className="text-sm sm:text-base lg:text-lg text-muted">
```

### 8. Spacing Scale
```tsx
// Tighter on mobile, generous on desktop
<div className="space-y-3 sm:space-y-4 lg:space-y-6 xl:space-y-8">
<div className="gap-2 sm:gap-3 lg:gap-4 xl:gap-6">
<div className="p-3 sm:p-4 lg:p-6 xl:p-8">
```

### 9. Show/Hide by Breakpoint
```tsx
// Mobile only
<div className="block sm:hidden">Mobile UI</div>
// Desktop only
<div className="hidden sm:block lg:flex">Desktop UI</div>
// Tablet only
<div className="hidden md:block lg:hidden">Tablet UI</div>
```

### 10. Responsive Card Grid
```tsx
// 1 → 2 → 3 → 4 with consistent sizing
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
  {items.map(item => <Card key={item.id} className="h-full">{item.content}</Card>)}
</div>
```

### 11. Container Queries (Component-Level Responsiveness)
```tsx
// When supported: component owns its responsive logic
@container (min-width: 400px) {
  .card { grid-template-columns: 1fr 1fr; }
}

// Usage
<div className="container">
  <Card className="@container">...</Card>
</div>
```

### 12. Logical Properties (RTL-Ready)
```tsx
// Use logical instead of physical (ms/me/ps/pe/border-s/border-e are Tailwind utilities)
<div className="ms-4 me-2 ps-4 pe-2 border-s border-e">
  Content
</div>
```

### 13. Print Styles
```css
@media print {
  .no-print { display: none; }
  .print-only { display: block; }
  .page-break { page-break-before: always; }
}
```

### 14. Reduced Motion
```tsx
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

### 15. High Contrast Mode
```tsx
@media (prefers-contrast: more) {
  :root { --color-primary: #1d4ed8; --color-border: currentColor; }
}
```

## Anti-Patterns to Avoid

| ❌ Don't | ✅ Do |
|----------|------|
| Fixed `w-[400px]` | `w-full max-w-[400px]` |
| `xs:` prefix (doesn't exist) | Base + `sm:` |
| `grid-cols-4` on mobile | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` |
| Hidden overflow on containers | `overflow-x-auto` wrappers |
| Same padding at all sizes | Progressive `p-3 sm:p-4 lg:p-6` |
| Physical properties (`margin-left`) | Logical properties (`ms-4`) |
| Ignore reduced motion | Respect `prefers-reduced-motion` |
| Ignore high contrast | Test `prefers-contrast: more` |

## Testing Checklist

- [ ] 320px (iPhone SE) — no horizontal scroll
- [ ] 375px (iPhone 12/13/14) — content readable
- [ ] 428px (iPhone 14 Pro Max) — comfortable
- [ ] 640px (sm) — 2-col grids activate
- [ ] 768px (md) — 3-col grids, sidebars
- [ ] 1024px (lg) — full layout, sidebar visible
- [ ] 1440px (xl) — generous whitespace
- [ ] 1920px (2xl) — max-width constrained
- [ ] RTL layout — logical properties work
- [ ] Print view — no nav/sidebar, readable content
- [ ] Reduced motion — animations disabled
- [ ] High contrast — borders visible, colors distinct

## Usage in This Repo

Apply directly as Tailwind classes per patterns above. See `mobile-first-design` and `desktop-layout-patterns` for complementary patterns.