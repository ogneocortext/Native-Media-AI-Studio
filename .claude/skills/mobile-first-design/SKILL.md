---
name: mobile-first-design
description: >-
  Mobile-first design methodology: design from 320px constraints upward,
  touch targets, 100dvh, progressive enhancement across Tailwind
  breakpoints. Use when designing new pages from scratch, refactoring
  desktop-first pages that break on mobile, or auditing mobile UX — for
  breakpoint mechanics see responsive-design-patterns.
---

# Skill: mobile-first-design

# Mobile-First Design

> [!warning] Mobile-first isn't just "make it work on phone" — it's designing FROM the constraints upward. Start with 320px, then enhance. This skill covers the mindset, patterns, and Tailwind v4 techniques for mobile-excellent experiences.

## When to Use

- Designing new pages/features from scratch
- Refactoring desktop-first pages that break on mobile
- Creating touch-optimized interfaces
- Audit: "Does this feel native on mobile?"

## Mobile-First Principles

### 1. Content Priority = Visual Hierarchy
On 320px, every pixel earns its keep. **Cut, condense, stack.**

```tsx
// Desktop: side-by-side panels
// Mobile: stacked, most important first
<div className="space-y-4">
  <PrimaryAction />      // Always visible
  <SecondaryContent />   // Scroll to see
  <TertiaryDetails />    // Maybe hidden behind accordion
</div>
```

### 2. Touch-First Interaction
- **44×44px minimum** tap targets (WCAG AA)
- **No hover-only** — all actions accessible via tap
- **Swipe gestures** for carousels, drawers, tabs
- **Pull-to-refresh** where appropriate

```tsx
// Minimum tap target
<button className="min-h-[44px] min-w-[44px] flex items-center justify-center p-3">
  <Icon size={20} />
</button>

// Touch-friendly slider
<input type="range" className="h-8 accent-violet-500" />
```

### 3. Thumb Zone Optimization
Place primary actions in **bottom-center** (easy thumb reach):

```tsx
// Fixed bottom bar for primary actions
<div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur-sm border-t border-border sm:static sm:bg-transparent sm:border-0 sm:p-0">
  <PrimaryAction className="w-full sm:w-auto" />
</div>
```

### 4. Progressive Disclosure
Mobile: show summary → tap to expand. Desktop: show all.

```tsx
// Accordion on mobile, open sections on desktop
<details className="group">
  <summary className="flex items-center justify-between p-3 bg-surface rounded-lg cursor-pointer">
    <span className="font-medium">Section Title</span>
    <ChevronDown className="transition-transform group-open:rotate-180" />
  </summary>
  <div className="p-3 border-t border-border animate-in slide-in-from-top-2">
    Detailed content here...
  </div>
</details>
```

### 5. Form Optimization
- **Single column** always
- **Native inputs** (date, email, tel) for correct keyboards
- **Auto-focus** first field
- **Inline validation** (not modal alerts)

```tsx
<form className="space-y-4">
  <div>
    <label className="block text-sm font-medium mb-1">Email</label>
    <input type="email" autoComplete="email" className="w-full px-4 py-3 bg-surface border border-border rounded-lg text-lg" />
  </div>
  <button type="submit" className="w-full py-3 bg-primary text-white rounded-lg text-base font-medium mt-2">
    Submit
  </button>
</form>
```

### 6. Navigation Patterns

**Bottom Tab Bar** (3-5 items):
```tsx
<nav className="fixed bottom-0 left-0 right-0 bg-background border-t border-border flex sm:hidden">
  {tabs.map(t => (
    <a key={t.id} href={t.href} className="flex-1 flex flex-col items-center p-2 text-xs">
      <t.icon size={24} />
      <span>{t.label}</span>
    </a>
  ))}
</nav>
```

**Hamburger + Slide-out Drawer** (many items):
```tsx
// Trigger
<button className="sm:hidden p-2" onClick={() => setDrawerOpen(true)} aria-label="Menu">
  <Menu size={24} />
</button>

// Drawer (fixed, full height)
{isDrawerOpen && (
  <>
    <div className="fixed inset-0 bg-black/50 z-40 sm:hidden" onClick={() => setDrawerOpen(false)} />
    <aside className="fixed top-0 right-0 h-full w-72 bg-background z-50 p-6 overflow-y-auto sm:hidden">
      <button className="mb-6" onClick={() => setDrawerOpen(false)}>Close</button>
      <nav className="space-y-2">{/* links */}</nav>
    </aside>
  </>
)}
```

### 7. Data Density
| Desktop | Mobile |
|---------|--------|
| Table with 8 cols | Card list (1 col) |
| Dense dashboard | Stacked stat cards |
| Side-by-side panels | Accordion sections |
| Hover tooltips | Tap to expand |

```tsx
// Desktop: table, Mobile: cards
<div className="hidden sm:block">
  <Table>...</Table>
</div>
<div className="sm:hidden space-y-3">
  {items.map(item => <Card key={item.id}>{item.content}</Card>)}
</div>
```

### 8. Performance on Mobile
- **Lazy-load** images below fold
- **Defer** non-critical JS
- **Skeleton loaders** not spinners
- **Optimize** bundle for 3G

```tsx
// Skeleton instead of spinner
<div className="animate-pulse space-y-3">
  <div className="h-4 bg-gray-700 rounded w-3/4" />
  <div className="h-4 bg-gray-700 rounded w-1/2" />
  <div className="h-32 bg-gray-700 rounded" />
</div>
```

### 9. Safe Areas (Notched Devices)
```tsx
// Bottom safe area for home indicator
<div className="pb-safe pb-4 sm:pb-4">
  <BottomAction />
</div>

// Top safe area for Dynamic Island
<div className="pt-safe pt-4 sm:pt-4">
  <Header />
</div>
```

### 10. Viewport Units & Dynamic Viewport
```tsx
// Use dvh/dvw for mobile browser chrome
<div className="h-[100dvh] min-h-[100dvh]">
  // Fills viewport minus browser chrome
</div>

// Avoid 100vh on mobile (includes browser chrome)
<div className="h-screen"> // Bad on mobile
<div className="h-[100dvh]"> // Good
```

### 11. Touch Action Control
```tsx
// Prevent unwanted scrolling on draggable elements
<div className="touch-pan-x"> // Horizontal swipe only
<div className="touch-pan-y"> // Vertical scroll only
<div className="touch-none">  // No browser gestures
<div className="touch-auto">  // Default
```

### 12. Virtual Keyboard Handling
```tsx
// Prevent layout shift when keyboard opens
<div className="relative h-[100dvh]">
  <main className="flex-1 overflow-y-auto">
    {content}
  </main>
  <footer className="sticky bottom-0">
    <InputField />
  </footer>
</div>

// Listen for keyboard
useEffect(() => {
  const handler = () => setKeyboardOpen(true);
  window.addEventListener('focusin', handler);
  return () => window.removeEventListener('focusin', handler);
}, []);
```

### 13. Mobile Testing Checklist
- [ ] 320px width — no horizontal scroll
- [ ] Tap targets ≥ 44×44px
- [ ] Thumb can reach primary actions
- [ ] Forms use correct keyboards (email, tel, number)
- [ ] No hover-only interactions
- [ ] Text ≥ 16px (prevents zoom on iOS)
- [ ] Safe area padding applied
- [ ] Works offline (service worker)
- [ ] Loads < 3s on 3G
- [ ] Gestures work (swipe, pull-refresh)
- [ ] Dynamic viewport (dvh) used, not vh
- [ ] Touch actions controlled
- [ ] Keyboard doesn't shift layout

## Anti-Patterns

| ❌ Desktop-First | ✅ Mobile-First |
|------------------|-----------------|
| "Hide on mobile" | "Show on desktop" |
| Hover tooltips | Tap expand / bottom sheet |
| 12-col desktop grid | Single column stack |
| Sidebars always visible | Drawer / bottom sheet |
| Dense tables | Card lists / accordions |
| Modal dialogs | Inline expansion / sheets |
| `100vh` | `100dvh` |
| `touch-auto` on draggables | `touch-pan-x` / `touch-none` |

## Usage in This Repo

Apply mobile-first classes directly:
```tsx
// Base = mobile, sm+ = enhancements
<div className="flex flex-col sm:flex-row gap-3 sm:gap-4 p-3 sm:p-6">
  <button className="w-full sm:w-auto min-h-[44px]">Action</button>
</div>
```

Reference: `responsive-design-patterns` for breakpoint details.