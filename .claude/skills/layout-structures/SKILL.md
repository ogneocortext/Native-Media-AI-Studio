---
name: layout-structures
description: >-
  Reusable layout primitives and page composition patterns (containers,
  grids, split views, cards, sidebars) as explicit props rather than
  hidden context config. Use when starting a new page, refactoring
  spaghetti CSS, building layout components for a design system, or
  reviewing whether markup follows a known structure.
---

# Skill: layout-structures

# Layout Structures

> [!warning] A layout structure is the invisible skeleton of a page. Good structure = effortless responsive behavior, predictable maintenance, clear component boundaries. This skill catalogs reusable layout primitives and composition patterns.

## When to Use

- Starting a new page — pick the right structure first
- Refactoring spaghetti CSS — impose structure
- Building a design system — document layout primitives
- Code review — "Does this follow a known structure?"

## Layout Primitives (Atoms)

### 1. Stack (Vertical Rhythm)
```tsx
// Consistent vertical spacing
<Stack gap={4} className="space-y-4">
  <Item />
  <Item />
  <Item />
</Stack>

// Inline: Tailwind
<div className="space-y-4 sm:space-y-6">
```

### 2. Inline (Horizontal Rhythm)
```tsx
// Consistent horizontal spacing
<Inline gap={3} className="flex items-center gap-3">
  <Item />
  <Item />
</Inline>

// Wrapping
<InlineWrap gap={2} className="flex flex-wrap gap-2">
```

### 3. Cluster (Even Distribution)
```tsx
// Space-between with wrap
<Cluster className="flex flex-wrap items-center justify-between gap-4">
  <PrimaryActions />
  <SecondaryActions />
</Cluster>
```

### 4. Grid (2D Alignment)
```tsx
<Grid columns={3} gap={4} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
  <Item />
  <Item />
  <Item />
</Grid>
```

### 5. Container (Width Constraint)
```tsx
<Container size="lg" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
  <Children />
</Container>
```

Sizes: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px), `2xl` (1536px), `full` (100%)

### 6. Section (Semantic Grouping)
```tsx
<Section className="py-12 sm:py-16 lg:py-24">
  <Container>
    <Header />
    <Content />
  </Container>
</Section>
```

### 7. Sidebar (Fixed/Responsive)
```tsx
<Sidebar width="280px" collapsible breakpoint="lg">
  <SidebarTrigger />  // Mobile: button, Desktop: hidden
  <SidebarContent />
</Sidebar>
```

### 8. Header (Sticky/Static)
```tsx
<Header sticky className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b">
  <Container>
    <Inline gap={4} className="flex items-center justify-between h-16">
      <Logo />
      <Nav className="hidden lg:flex gap-6" />
      <Actions />
      <MobileMenuButton className="lg:hidden" />
    </Inline>
  </Container>
</Header>
```

### 9. Footer
```tsx
<Footer className="border-t border-border py-8 sm:py-12">
  <Container>
    <Grid columns={4} className="grid grid-cols-2 lg:grid-cols-4 gap-8">
      <Column><h4>Product</h4><Links /></Column>
      <Column><h4>Resources</h4><Links /></Column>
      <Column><h4>Company</h4><Links /></Column>
      <Column><h4>Legal</h4><Links /></Column>
    </Grid>
    <Divider className="my-8 border-border" />
    <Inline className="flex flex-col sm:flex-row justify-between gap-4">
      <Copyright />
      <SocialLinks />
    </Inline>
  </Container>
</Footer>
```

### 10. Modal / Dialog (Overlay)
```tsx
<Dialog open={isOpen} onClose={close}>
  <DialogOverlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
  <DialogPanel className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg max-h-[90vh] overflow-y-auto bg-background rounded-xl border border-border shadow-2xl p-6">
    <DialogHeader className="flex items-center justify-between mb-4">
      <Title />
      <CloseButton />
    </DialogHeader>
    <Content />
    <DialogFooter className="mt-6 flex justify-end gap-3">
      <CancelButton />
      <ConfirmButton />
    </DialogFooter>
  </DialogPanel>
</Dialog>
```

### 11. Drawer / Sheet (Side Overlay)
```tsx
<Drawer open={isOpen} onClose={close} side="right" className="fixed right-0 top-0 h-full w-96 bg-background border-l border-border shadow-2xl z-50 transform transition-transform">
  <DrawerHeader className="p-4 border-b flex items-center justify-between">
    <Title />
    <CloseButton />
  </DrawerHeader>
  <DrawerContent className="p-4 overflow-y-auto h-[calc(100%-80px)]" />
</Drawer>
```

### 12. Tooltip / Popover (Anchored)
```tsx
<Popover trigger={<Button />} position="top" offset={8}>
  <PopoverContent className="bg-popover border border-border rounded-lg shadow-lg p-3 min-w-[200px]">
    <Content />
  </PopoverContent>
</Popover>
```

### 13. Accordion / Disclosure
```tsx
<Accordion type="single" collapsible>
  <AccordionItem value="item-1">
    <AccordionTrigger>Section Title</AccordionTrigger>
    <AccordionContent>Content here...</AccordionContent>
  </AccordionItem>
</Accordion>
```

### 14. Tabs
```tsx
<Tabs defaultValue="tab-1">
  <TabsList className="flex gap-1 p-1 bg-muted rounded-lg">
    <TabsTrigger value="tab-1">Tab 1</TabsTrigger>
    <TabsTrigger value="tab-2">Tab 2</TabsTrigger>
  </TabsList>
  <TabsContent value="tab-1">Content 1</TabsContent>
  <TabsContent value="tab-2">Content 2</TabsContent>
</Tabs>
```

### 15. Breadcrumbs
```tsx
<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbLink href="/docs">Docs</BreadcrumbLink></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>Current Page</BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>
```

## Layout Compositions (Molecules)

### 1. Page Shell (App Wrapper)
```tsx
function PageShell({ children, sidebar }) {
  return (
    <div className="flex h-screen bg-background">
      {sidebar && <aside className="w-64 border-r border-border lg:block hidden">{sidebar}</aside>}
      <main className="flex-1 flex flex-col min-w-0 lg:min-w-0">
        <Header className="sticky top-0 z-40" />
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </div>
        <Footer />
      </main>
    </div>
  );
}
```

### 2. Auth Shell (Centered Card)
```tsx
function AuthShell({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <Card className="w-full max-w-md p-8">
        {children}
      </Card>
    </div>
  );
}
```

### 3. Dashboard Shell (Sidebar + Content)
```tsx
function DashboardShell({ sidebar, header, children }) {
  return (
    <div className="flex h-screen">
      <aside className="w-64 border-r border-border lg:block hidden flex flex-col">
        <Header className="p-4 border-b" />
        <Nav className="flex-1 p-4 overflow-y-auto">{sidebar}</Nav>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <Header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b">{header}</Header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

### 4. Split View (Master-Detail)
```tsx
function SplitView({ left, right, leftWidth = 300 }) {
  return (
    <div className="flex h-full">
      {/* width via style — Tailwind can't see `w-${leftWidth}` interpolations */}
      <aside className="border-r border-border flex-col lg:flex hidden" style={{ width: leftWidth }}>
        {left}
      </aside>
      <main className="flex-1 flex flex-col min-w-0">
        {right}
      </main>
    </div>
  );
}
```

### 5. Canvas Toolbar (Creative Tools)
```tsx
function CanvasShell({ toolbar, leftTools, canvas, rightProps, timeline }) {
  return (
    <div className="flex h-screen bg-gray-950">
      <Toolbar className="h-12 border-b border-gray-800">{toolbar}</Toolbar>
      <div className="flex-1 flex">
        <aside className="w-16 border-r border-gray-800">{leftTools}</aside>
        <main className="flex-1 relative">{canvas}</main>
        <aside className="w-80 border-l border-gray-800">{rightProps}</aside>
      </div>
      {timeline && <Timeline className="h-40 border-t border-gray-800">{timeline}</Timeline>}
    </div>
  );
}
```

### 6. Settings Panel (Sidebar + Content)
```tsx
function SettingsShell({ sidebar, content }) {
  return (
    <div className="flex h-full">
      <aside className="w-64 border-r border-border lg:block hidden">
        <SettingsNav>{sidebar}</SettingsNav>
      </aside>
      <main className="flex-1 overflow-y-auto p-6 lg:p-8">
        <SettingsContent>{content}</SettingsContent>
      </main>
    </div>
  );
}
```

### 7. Wizard / Stepper
```tsx
function WizardShell({ steps, currentStep, onNext, onBack, children }) {
  return (
    <div className="flex flex-col h-full">
      <WizardProgress steps={steps} current={currentStep} className="mb-6" />
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
      <div className="flex justify-end gap-3 p-4 border-t">
        <Button variant="outline" onClick={onBack} disabled={currentStep === 0}>Back</Button>
        <Button onClick={onNext} disabled={currentStep === steps.length - 1}>
          {currentStep === steps.length - 1 ? 'Finish' : 'Next'}
        </Button>
      </div>
    </div>
  );
}
```

## Responsive Behavior Matrix

| Structure | Mobile (<640) | Tablet (640-1024) | Desktop (1024+) |
|-----------|---------------|-------------------|-----------------|
| PageShell | Stacked, hamburger menu | Header inline, sidebar drawer | Full sidebar |
| DashboardShell | Stacked, bottom nav | Collapsible sidebar | Fixed sidebar |
| SplitView | Tabs (left/right) | Left drawer + right | Side-by-side |
| CanvasShell | Fullscreen canvas, bottom tools | Left tools drawer | Full three-panel |
| AuthShell | Full screen card | Centered card (400px) | Centered card (400px) |
| Modal | Full screen sheet | Centered (max-w-md) | Centered (max-w-lg) |
| Drawer | Full screen bottom sheet | Side sheet (320px) | Side sheet (384px) |
| SettingsShell | Stacked, bottom nav | Collapsible sidebar | Fixed sidebar |
| WizardShell | Full screen, bottom actions | Centered (600px) | Centered (800px) |

## Composition Rules

### 1. Single Responsibility
Each primitive does ONE thing. Compose for complexity.

### 2. Explicit Props Over Context
Pass layout config as props, not context. Easier to test, debug, compose.

```tsx
// Good
<Sidebar width="280px" collapsible breakpoint="lg" />

// Avoid
<Sidebar /> // Uses context for width, breakpoint, etc.
```

### 3. CSS Grid for 2D, Flex for 1D
```tsx
// 2D alignment → grid
<div className="grid grid-cols-3 gap-4">

// 1D distribution → flex
<div className="flex items-center justify-between gap-4">
```

### 4. Container Queries (Future)
```tsx
// When supported: component owns its responsive logic
@container (min-width: 400px) {
  .card { grid-template-columns: 1fr 1fr; }
}
```

### 5. Logical Properties (RTL-Ready)
```tsx
// Use logical instead of physical
margin-inline-start  // not margin-left
padding-inline-end   // not padding-right
border-inline-start  // not border-left
```

### 6. Intrinsic Sizing (Content-Aware)
```tsx
// Let content determine size, constrain with min/max
<div className="min-w-0 flex-1">  // Prevents flex overflow
<Grid columns="auto-fit" minmax="250px">  // Content-driven columns
```

### 7. Layered Z-Index (Systematic)
```tsx
// Semantic z-index layers
--z-base: 0;
--z-dropdown: 100;
--z-sticky: 200;
--z-modal-backdrop: 300;
--z-modal: 400;
--z-toast: 500;
--z-tooltip: 600;
```

## Structure Catalog (Reference)

| Primitive | Purpose | Key Classes |
|-----------|---------|-------------|
| `Stack` | Vertical rhythm | `space-y-4` |
| `Inline` | Horizontal rhythm | `flex items-center gap-3` |
| `Cluster` | Space-between | `flex flex-wrap justify-between gap-4` |
| `Grid` | 2D layout | `grid grid-cols-1 sm:grid-cols-3 gap-4` |
| `Container` | Width constraint | `max-w-6xl mx-auto px-4 sm:px-6` |
| `Section` | Vertical section | `py-12 sm:py-16` |
| `Sidebar` | Fixed side panel | `w-64 border-r lg:block hidden` |
| `Header` | Top bar | `sticky top-0 z-40 h-16` |
| `Footer` | Bottom bar | `border-t py-8` |
| `Modal` | Centered overlay | `fixed inset-0 z-50` |
| `Drawer` | Side overlay | `fixed right-0 top-0 h-full w-96` |
| `Tooltip` | Anchored popup | `absolute z-50` |
| `Accordion` | Collapsible sections | `border border-border rounded-lg` |
| `Tabs` | Tabbed content | `flex gap-1 p-1 bg-muted rounded-lg` |
| `Breadcrumbs` | Location hierarchy | `flex items-center gap-1 text-sm` |

## Usage in This Repo

Import primitives from `@/components/layout`:
```tsx
import { Stack, Inline, Grid, Container, Section, Sidebar, Header } from "@/components/layout";

export function MyPage() {
  return (
    <PageShell>
      <Section>
        <Container>
          <Stack gap={6}>
            <Header />
            <Grid columns={3} gap={6}>
              <Card>...</Card>
              <Card>...</Card>
              <Card>...</Card>
            </Grid>
          </Stack>
        </Container>
      </Section>
    </PageShell>
  );
}
```