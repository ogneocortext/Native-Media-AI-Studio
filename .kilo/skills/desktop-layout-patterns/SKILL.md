---
name: desktop-layout-patterns
description: >-
  Desktop-specific layout patterns for dense, multi-panel, power-user UIs:
  IDE/DAW-style docks, dashboards, resizable panels, window persistence,
  keyboard-driven workflows. Use when building or refactoring desktop web
  app chrome — pair with layout-structures for primitives and
  mobile-first-design for the small-viewport story.
---

# Skill: desktop-layout-patterns

> **Scope:** imported reference guidance, not studio workflow. For studio surfaces the visual style system and visual-hierarchy win on any conflict. Mobile-first and responsive material here targets public-web surfaces, not studio chrome.

# Desktop Layout Patterns

> [!warning] Desktop isn't "mobile with more space" — it's a different medium. Mouse/keyboard, large viewports, multi-window workflows, dense information. This skill covers layouts that *exploit* desktop capabilities.

## When to Use

- Building dashboard/analytics pages
- Multi-panel tools (IDE-style, DAW-style, video editors)
- Data-dense interfaces (tables, grids, trees)
- Power-user workflows needing simultaneous visibility

## Desktop-Specific Advantages

| Capability | Mobile | Desktop |
|------------|--------|---------|
| Input | Touch (imprecise) | Mouse/keyboard (pixel-perfect) |
| Viewport | 320–430px | 1024–3840px+ |
| Windows | Single fullscreen | Multiple, resizable, side-by-side |
| Density | Low (thumb-friendly) | High (scan-optimized) |
| Navigation | Sequential (tabs/drawers) | Spatial (panels, sidebars) |
| Shortcuts | None | Full keyboard support |

## Layout Archetypes

### 1. Three-Panel (IDE / DAW / Editor)
```
┌─────────┬──────────────────┬─────────┐
│ Sidebar │    Main Canvas   │ Inspector│
│ (200px) │     (flex-1)     │ (280px) │
└─────────┴──────────────────┴─────────┘
```

```tsx
<div className="grid grid-cols-[200px_1fr_280px] h-full">
  <Sidebar className="border-r border-border overflow-y-auto" />
  <MainCanvas className="relative overflow-hidden" />
  <Inspector className="border-l border-border overflow-y-auto" />
</div>
```

**Responsive collapse:**
```tsx
// lg+: three panels, md: two panels (main + collapsible), sm: tabs
<div className="grid grid-cols-1 lg:grid-cols-[200px_1fr_280px]">
  <Sidebar className="lg:block hidden" />
  <MainCanvas />
  <Inspector className="lg:block hidden" />
</div>
```

### 2. Dashboard (Header + Grid + Sidebar)
```
┌─────────────────────────────────────┐
│ Header (logo, search, user, actions)│
├──────────────┬──────────────────────┤
│              │                      │
│   Sidebar    │   Stat Cards Grid    │
│   (nav)      │   (2-4 cols)         │
│              │                      │
├──────────────┼──────────────────────┤
│              │   Charts / Tables    │
└──────────────┴──────────────────────┘
```

```tsx
<div className="flex h-screen">
  <aside className="w-64 border-r border-border flex flex-col">
    <Header className="p-4 border-b" />
    <Nav className="flex-1 p-4 overflow-y-auto" />
  </aside>
  <main className="flex-1 overflow-y-auto">
    <header className="sticky top-0 z-10 p-4 border-b bg-background/95 backdrop-blur">
      <SearchAndActions />
    </header>
    <div className="p-6 space-y-6">
      <StatGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" />
      <ChartSection />
      <DataTable />
    </div>
  </main>
</div>
```

### 3. Master-Detail (Split View)
```
┌─────────────┬─────────────────────┐
│  List/Tree  │   Detail Pane       │
│  (300px)    │   (flex-1)          │
│             │                     │
│  [filter]   │  [breadcrumb]       │
│  [search]   │  [content]          │
│  [items...] │  [actions]          │
└─────────────┴─────────────────────┘
```

```tsx
<div className="flex h-full">
  <aside className="w-80 border-r border-border flex flex-col">
    <FilterBar className="p-3 border-b" />
    <SearchInput className="p-3 border-b" />
    <VirtualizedList className="flex-1 overflow-y-auto" />
  </aside>
  <main className="flex-1 flex flex-col">
    <DetailHeader className="p-4 border-b sticky top-0 bg-background" />
    <DetailContent className="flex-1 p-6 overflow-y-auto" />
  </main>
</div>
```

### 4. Canvas + Toolbar (Creative Tools)
```
┌─────────────────────────────────────┐
│  Top Toolbar (tools, modes, export) │
├─────────┬───────────────────────────┤
│         │                           │
│  Left   │      Canvas (flex-1)      │
│  Tools  │                           │
│         │                           │
├─────────┼───────────────────────────┤
│         │  Bottom Timeline/Props    │
└─────────┴───────────────────────────┘
```

```tsx
<div className="flex h-screen bg-gray-950">
  <Toolbar className="h-12 border-b border-gray-800 flex items-center gap-2 px-4" />
  <div className="flex-1 flex">
    <LeftTools className="w-16 border-r border-gray-800 flex flex-col items-center p-2 gap-2" />
    <Canvas className="flex-1 relative" />
    <RightProps className="w-80 border-l border-gray-800 overflow-y-auto" />
  </div>
  <Timeline className="h-40 border-t border-gray-800" />
</div>
```

### 5. Data Grid + Detail (Admin / Analytics)
```
┌─────────────────────────────────────┐
│  Header: Title | Search | + New     │
├─────────────────────────────────────┤
│  ▼ ▼ ▼  ▼  ▼  ▼  ▼  ▼  ▼  ▼        │
│  █ █ █ █ █ █ █ █ █ █ █ █ █ █ █     │  ← Sortable, filterable, paginated
│  █ █ █ █ █ █ █ █ █ █ █ █ █ █ █     │     row click → detail panel
│  █ █ █ █ █ █ █ █ █ █ █ █ █ █ █     │
├─────────────────────────────────────┤
│  Pagination | Rows/page | Export    │
└─────────────────────────────────────┘
```

```tsx
<div className="h-full flex flex-col">
  <TableToolbar className="p-4 border-b flex items-center justify-between gap-4" />
  <DataTable className="flex-1 overflow-auto" />
  <Pagination className="p-4 border-t flex items-center justify-between" />
</div>
// Row click → sliding detail panel from right
```

### 6. Multi-Window / Tabbed Interface
```tsx
// Tab strip with drag-reorder, close, new tab
<div className="flex h-full">
  <TabStrip className="h-8 border-b border-border flex items-center px-2 gap-1">
    {tabs.map(t => (
      <Tab key={t.id} 
        onClose={() => closeTab(t.id)}
        onDragStart={dragStart}
      />
    ))}
    <NewTabButton />
  </TabStrip>
  <TabPanels className="flex-1">
    {activeTab && <activeTab.component />}
  </TabPanels>
</div>
```

## Desktop-Specific Patterns

### Keyboard Shortcuts (Global + Contextual)
```tsx
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'n') { e.preventDefault(); createNew(); }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); save(); }
    if (e.ctrlKey && e.shiftKey && e.key === 'p') { e.preventDefault(); openCommandPalette(); }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

### Context Menus (Right-Click)
```tsx
const [menu, setMenu] = useState<{x: number; y: number; items: MenuItem[]} | null>(null);

const handleContextMenu = (e: React.MouseEvent, items: MenuItem[]) => {
  e.preventDefault();
  setMenu({ x: e.clientX, y: e.clientY, items });
};

return (
  <>
    <div onContextMenu={e => handleContextMenu(e, rowActions)}>...</div>
    {menu && (
      <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
    )}
  </>
);
```

### Drag & Drop (Reorder, Upload, Move)
```tsx
// Sortable list
<SortableList
  items={items}
  onReorder={(from, to) => reorder(from, to)}
  renderItem={(item) => <DraggableItem {...item} />}
/>

// File drop zone
<div 
  className="upload-zone border-2 border-dashed rounded-xl p-8 text-center"
  onDragOver={e => { e.preventDefault(); setDragActive(true); }}
  onDragLeave={e => { e.preventDefault(); setDragActive(false); }}
  onDrop={handleDrop}
>
  <UploadIcon size={48} />
  <p>Drop files here or click to browse</p>
</div>
```

### Resizable Panels (User-Controlled Layout)
```tsx
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

<PanelGroup direction="horizontal" className="h-full">
  <Panel defaultSize={20} minSize={15} maxSize={40}>
    <Sidebar />
  </Panel>
  <PanelResizeHandle className="w-1 bg-border hover:bg-primary" />
  <Panel defaultSize={60}>
    <MainContent />
  </Panel>
  <PanelResizeHandle className="w-1 bg-border hover:bg-primary" />
  <Panel defaultSize={20} minSize={15} maxSize={40}>
    <Inspector />
  </Panel>
</PanelGroup>
```

### Command Palette (⌘K / Ctrl+K)
```tsx
// Global command palette for power users
<CommandPalette
  trigger="ctrl+k"
  commands={[
    { id: 'new-project', label: 'New Project', shortcut: '⌘N', action: createProject },
    { id: 'open-settings', label: 'Settings', shortcut: '⌘,', action: openSettings },
    { id: 'toggle-theme', label: 'Toggle Theme', shortcut: '⌘⇧T', action: toggleTheme },
    // ... searchable, fuzzy-matched
  ]}
/>
```

### Toast / Notification System (Non-Modal)
```tsx
// Top-right stack, auto-dismiss, actionable
<Toaster position="top-right" toastOptions={{ duration: 5000 }}>
  {toasts.map(t => (
    <Toast key={t.id} onAction={t.action} onDismiss={() => dismiss(t.id)}>
      {t.message}
    </Toast>
  ))}
</Toaster>
```

### Multi-Monitor & Window Management
```tsx
// Persist window position/size per monitor
const useWindowPersistence = (windowId: string) => {
  const [bounds, setBounds] = useState(() => 
    JSON.parse(localStorage.getItem(`window-${windowId}`) || 'null') || 
    { x: 100, y: 100, width: 1200, height: 800 }
  );
  
  useEffect(() => {
    // NOTE: browsers don't emit 'move'/'resize' window events — those are
    // Electron-only. For web apps persist on 'resize' + beforeunload/pagehide,
    // or debounce a rAF loop if live tracking is needed.
    const save = () => localStorage.setItem(`window-${windowId}`, JSON.stringify(getCurrentBounds()));
    const handleResize = () => setBounds(getCurrentBounds());
    window.addEventListener('resize', handleResize);
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [windowId]);
  
  return bounds;
};
```

### Focus Management (Keyboard Navigation)
```tsx
// Roving tabindex for composite widgets
const useRovingTabindex = (items: HTMLElement[], orientation: 'horizontal' | 'vertical') => {
  const [focusedIndex, setFocusedIndex] = useState(0);
  
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = orientation === 'horizontal' ? (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0)
        : (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0);
      if (key !== 0) {
        e.preventDefault();
        setFocusedIndex(i => (i + key + items.length) % items.length);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [items, orientation]);
  
  return items.map((item, i) => ({
    ...item,
    tabIndex: i === focusedIndex ? 0 : -1,
    onFocus: () => setFocusedIndex(i)
  }));
};
```

### Virtualized Lists (Large Datasets)
```tsx
import { FixedSizeList as List } from 'react-window';

<List
  height={600}
  itemCount={10000}
  itemSize={50}
  width="100%"
  itemData={items}
>
  {({ index, style }) => (
    <div style={style} className="p-4 border-b border-border">
      {items[index].name}
    </div>
  )}
</List>
```

## Density & Scanning Optimization

| Element | Desktop Density |
|---------|-----------------|
| Table row height | 36–40px (compact) |
| Card padding | 12–16px |
| Stat card | 120×80px min |
| Sidebar width | 200–280px |
| Toolbar height | 40–48px |
| Modal width | 480–720px |

## Anti-Patterns

| ❌ Mobile Pattern on Desktop | ✅ Desktop Native |
|------------------------------|-------------------|
| Hamburger menu | Visible sidebar / top nav |
| Single column stack | Multi-panel grid |
| Bottom sheets | Side panels / modals |
| Pull-to-refresh | Toolbar refresh button |
| Swipe gestures | Keyboard shortcuts / context menus |
| Large tap targets | Compact, dense controls |

## Testing Checklist

- [ ] 1024px — three-panel works
- [ ] 1440px — generous whitespace, 4-col grids
- [ ] 1920px — max-width constrained, readable line length
- [ ] 3840px (4K) — no awkward stretching
- [ ] Keyboard shortcuts work globally
- [ ] Context menus on right-click
- [ ] Drag-drop reordering works
- [ ] Resizable panels persist sizes
- [ ] Command palette opens instantly
- [ ] Multi-monitor: window remembers position
- [ ] Virtualized lists handle 10k+ items
- [ ] Focus management works in composite widgets
- [ ] Window state persists across sessions

## Usage in This Repo

Pages using desktop patterns:
- `/system/admin` — dashboard with sidebar + tabs
- `/create/3d` — canvas + toolbar + inspector (three-panel)
- `/render/visualizer` — canvas + timeline + controls
- `/system/health` — stat grid + charts + tables
- `/library` — toolbar + data grid + detail panel

For canvas-centric surfaces (visualizer, editors), the stage-chrome
hierarchy model — zone ownership, glanceable vs docked-inspector split,
z-ladder, cover-transition choreography — lives in the `visual-hierarchy`
skill. The three-panel archetype above is the skeleton; that skill is
the interior decoration rules.