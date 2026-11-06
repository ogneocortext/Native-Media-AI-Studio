/**
 * Tailwind v4 Container Query Utilities
 * 
 * Component-level responsiveness using @container variants.
 * No plugin needed - built into Tailwind v4 core.
 * 
 * Usage:
 *   <div class="@container">
 *     <div class="flex flex-col gap-4 @md:flex-row">
 *       <img class="w-full @md:w-32" />
 *       <div>Details</div>
 *     </div>
 *   </div>
 * 
 * Named containers for nested contexts:
 *   <div class="@container/sidebar">
 *     <div class="@md/sidebar:hidden @lg/sidebar:block">...</div>
 *   </div>
 * 
 * Max-width variants:
 *   <div class="@max-md:hidden">Hidden when container < md</div>
 * 
 * Container units (cqw, cqh, etc.):
 *   <div class="w-[50cqw]">Half container width</div>
 *   <h2 class="text-[5cqw]">Scales with container</h2>
 */

// ─── CSS Container Query Base Styles ────────────────────────────────────────

/**
 * Inject these base styles globally (e.g., in index.css or global.css).
 * These define the container query infrastructure.
 */

export const containerQueryStyles = `
/* 
 * Tailwind v4 Container Query Base Styles
 * Include in your global CSS or import as CSS module
 */

/* Default container type (inline-size = width) */
@container {
  container-type: inline-size;
}

/* Named containers */
@container /sidebar {
  container-type: inline-size;
  container-name: sidebar;
}

@container /main {
  container-type: inline-size;
  container-name: main;
}

@container /card {
  container-type: inline-size;
  container-name: card;
}

/* Size containers (query both width and height) */
@container-size {
  container-type: size;
}

/* Named size containers */
@container-size /dashboard {
  container-type: size;
  container-name: dashboard;
}

/* Container query breakpoints (match Tailwind's default breakpoints) */
/* These are generated automatically by Tailwind v4, but here for reference:
 * @container (min-width: 40rem)  -> @md:
 * @container (min-width: 48rem)  -> @lg:
 * @container (min-width: 64rem)  -> @xl:
 * @container (min-width: 80rem)  -> @2xl:
 * 
 * Max-width variants:
 * @container (max-width: 39.99rem) -> @max-sm:
 * @container (max-width: 47.99rem) -> @max-md:
 * @container (max-width: 63.99rem) -> @max-lg:
 */

/* Container units (browser-native, no Tailwind needed) */
/* cqw = 1% of container width */
/* cqh = 1% of container height */
/* cqi = 1% of container inline size */
/* cqb = 1% of container block size */
/* cqmin = 1% of min(container width, container height) */
/* cqmax = 1% of max(container width, container height) */

/* Example utility classes for container units (if not using Tailwind) */
.cqw-50 { width: 50cqw; }
.cqh-50 { height: 50cqh; }
.text-cqw-5 { font-size: 5cqw; }
`;

// ─── Tailwind v4 Container Query Class Reference ────────────────────────────

/**
 * Complete reference of Tailwind v4 container query utilities.
 * These are available out-of-the-box in Tailwind v4 (no config needed).
 */

export const CONTAINER_QUERY_CLASSES = {
  // Container declaration
  container: "@container",                    // Makes element a query container
  containerNamed: "@container/sidebar",       // Named container
  containerSize: "@container-size",           // Query both width & height
  containerSizeNamed: "@container-size/dashboard",
  
  // Width-based variants (mobile-first, like regular breakpoints)
  xs: "@min-[20rem]:",      // 320px
  sm: "@min-[24rem]:",      // 384px  
  md: "@min-[28rem]:",      // 448px
  lg: "@min-[32rem]:",      // 512px
  xl: "@min-[36rem]:",      // 576px
  xl2: "@min-[42rem]:",     // 672px
  xl3: "@min-[48rem]:",     // 768px
  xl4: "@min-[56rem]:",     // 896px
  xl5: "@min-[64rem]:",     // 1024px
  xl6: "@min-[72rem]:",     // 1152px
  xl7: "@min-[80rem]:",     // 1280px
  xl8: "@min-[88rem]:",     // 1408px
  xl9: "@min-[96rem]:",     // 1536px
  
  // Max-width variants (inverse logic)
  maxXs: "@max-[19.99rem]:",
  maxSm: "@max-[23.99rem]:",
  maxMd: "@max-[27.99rem]:",
  maxLg: "@max-[31.99rem]:",
  maxXl: "@max-[35.99rem]:",
  maxXl2: "@max-[41.99rem]:",
  maxXl3: "@max-[47.99rem]:",
  maxXl4: "@max-[55.99rem]:",
  maxXl5: "@max-[63.99rem]:",
  maxXl6: "@max-[71.99rem]:",
  maxXl7: "@max-[79.99rem]:",
  maxXl8: "@max-[87.99rem]:",
  maxXl9: "@max-[95.99rem]:",
  
  // Named container variants
  mdSidebar: "@min-[28rem]/sidebar:",
  lgSidebar: "@min-[32rem]/sidebar:",
  mdCard: "@min-[28rem]/card:",
  lgMain: "@min-[32rem]/main:",
  
  // Named max-width variants
  maxMdSidebar: "@max-[27.99rem]/sidebar:",
  
  // Arbitrary values
  min400px: "@min-[400px]:",
  max500px: "@max-[500px]:",
  min300pxMax500px: "@min-[300px]:@max-[500px]:",
  
  // Container units (CSS native, use with arbitrary values)
  w50cqw: "w-[50cqw]",           // 50% of container width
  h50cqh: "h-[50cqh]",           // 50% of container height
  text5cqw: "text-[5cqw]",       // Font size = 5% of container width
  w25cqi: "w-[25cqi]",           // 25% of container inline size
  h10cqb: "h-[10cqb]",           // 10% of container block size
} as const;

// ─── Component Patterns ────────────────────────────────────────────────────

/**
 * Common component patterns using container queries.
 * Copy these into your components.
 */

export const containerPatterns = {
  // Basic responsive card
  card: `
<div class="@container">
  <div class="flex flex-col gap-4 @md:flex-row">
    <img class="w-full @md:w-32 @lg:w-48 object-cover rounded" src="..." />
    <div class="flex-1">
      <h3 class="text-lg font-semibold @lg:text-xl">Title</h3>
      <p class="mt-1 text-sm text-muted @lg:text-base">Description</p>
    </div>
  </div>
</div>
  `,
  
  // Sidebar navigation
  sidebar: `
<div class="@container/sidebar">
  <nav class="space-y-2">
    <a class="flex items-center gap-3 px-3 py-2 rounded @md/sidebar:gap-2 @md/sidebar:px-2 @md/sidebar:py-1 @lg/sidebar:justify-center @lg/sidebar:px-4">
      <Icon class="w-5 h-5 @md/sidebar:w-4 @lg/sidebar:w-6" />
      <span class="hidden @md/sidebar:inline @lg/sidebar:text-sm">Dashboard</span>
    </a>
  </nav>
</div>
  `,
  
  // Responsive grid that adapts to container
  grid: `
<div class="@container">
  <div class="grid gap-4 
    grid-cols-1 
    @sm:grid-cols-2 
    @md:grid-cols-3 
    @lg:grid-cols-4 
    @xl:grid-cols-5">
    {items.map(item => <Card key={item.id} {...item} />)}
  </div>
</div>
  `,
  
  // Form that stacks on narrow containers
  form: `
<div class="@container">
  <form class="space-y-4">
    <div class="flex flex-col gap-2 @md:flex-row @md:items-center @md:gap-4">
      <label class="w-full @md:w-24 text-right @md:text-right">Email</label>
      <input class="flex-1 px-3 py-2 rounded border" type="email" />
    </div>
    <div class="flex flex-col @md:flex-row @md:justify-end gap-2">
      <button type="button" class="px-4 py-2 rounded border">Cancel</button>
      <button type="submit" class="px-4 py-2 rounded bg-primary">Submit</button>
    </div>
  </form>
</div>
  `,
  
  // Table that becomes cards on narrow containers
  table: `
<div class="@container">
  <div class="hidden @md:block overflow-x-auto">
    <table class="w-full">
      <thead><tr><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td>{r.name}</td><td>{r.status}</td><td><Button>Edit</Button></td></tr>)}</tbody>
    </table>
  </div>
  <div class="@md:hidden space-y-2">
    {rows.map(r => (
      <div key={r.id} class="p-4 border rounded">
        <p class="font-medium">{r.name}</p>
        <p class="text-sm text-muted">{r.status}</p>
        <Button class="mt-2 w-full">Edit</Button>
      </div>
    ))}
  </div>
</div>
  `,
  
  // Modal that sizes to container
  modal: `
<div class="@container fixed inset-0 z-50 flex items-center justify-center p-4">
  <div class="w-full max-w-lg @sm:max-w-xl @md:max-w-2xl @lg:max-w-3xl bg-white rounded-lg shadow-xl">
    <div class="p-6">Content adapts to container</div>
  </div>
</div>
  `,
  
  // Typography that scales with container
  fluidTypography: `
<div class="@container">
  <h1 class="text-2xl @sm:text-3xl @md:text-4xl @lg:text-5xl @xl:text-6xl">Fluid Heading</h1>
  <p class="text-base @sm:text-lg @md:text-xl @lg:text-2xl">Fluid body text</p>
</div>
  `,
  
  // Using container units for precise control
  containerUnits: `
<div class="@container">
  <!-- Element takes 50% of container width -->
  <div class="w-[50cqw] h-[30cqh] bg-primary">Half width, 30% height</div>
  
  <!-- Font scales with container -->
  <h2 class="text-[5cqw]">Scales with container width</h2>
  
  <!-- Width between 25% and 75% of container -->
  <div class="w-[max(25cqw,min(75cqw,300px))]">Clamped fluid width</div>
</div>
  `,
} as const;

// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Generate container query classes dynamically.
 * Useful for programmatic class generation.
 */
export function cq(
  variant: "min" | "max" | "min-max",
  size: string,
  name?: string
): string {
  const prefix = name ? `/${name}` : "";
  
  if (variant === "min") {
    return `@min-[${size}]${prefix}:`;
  }
  if (variant === "max") {
    return `@max-[${size}]${prefix}:`;
  }
  // min-max
  const [min, max] = size.split("-").map(s => s.trim());
  return `@min-[${min}]${prefix}:@max-[${max}]${prefix}:`;
}

/**
 * Generate container unit classes.
 */
export function cqUnit(
  unit: "w" | "h" | "min-w" | "max-w" | "min-h" | "max-h" | "text" | "p" | "m",
  value: number,
  unitType: "cqw" | "cqh" | "cqi" | "cqb" | "cqmin" | "cqmax" = "cqw"
): string {
  const prefixes: Record<string, string> = {
    w: "w",
    h: "h",
    "min-w": "min-w",
    "max-w": "max-w",
    "min-h": "min-h",
    "max-h": "max-h",
    text: "text",
    p: "p",
    m: "m",
  };
  
  return `${prefixes[unit]}-[${value}${unitType}]`;
}

/**
 * Check if container queries are supported (for progressive enhancement).
 * Returns CSS @supports rule content.
 */
export const containerQuerySupport = `
@supports (container-type: inline-size) {
  /* Container queries supported */
  .cq-supported { display: block; }
  .cq-not-supported { display: none; }
}

@supports not (container-type: inline-size) {
  /* Fallback for old browsers */
  .cq-supported { display: none; }
  .cq-not-supported { display: block; }
}
`;

// ─── Migration from v3 ──────────────────────────────────────────────────────

/**
 * v3 -> v4 migration notes for container queries.
 * 
 * v3: Required @tailwindcss/container-queries plugin
 * v4: Built-in, no plugin needed
 * 
 * Migration:
 * 1. Remove @tailwindcss/container-queries from package.json
 * 2. Remove plugin from tailwind.config.js
 * 3. Classes work the same (@container, @md:, @lg:, etc.)
 * 4. New in v4: @max-* variants, @container-size, named containers
 */
export const migrationGuide = `
// v3 package.json
// "@tailwindcss/container-queries": "^0.1.0"  // REMOVE

// v3 tailwind.config.js
// plugins: [require("@tailwindcss/container-queries")]  // REMOVE

// v4: Nothing needed! Just use:
// <div class="@container">...</div>
// <div class="@md:flex-row">...</div>
`;

// ─── Export All ────────────────────────────────────────────────────────────

export const containerQueries = {
  styles: containerQueryStyles,
  classes: CONTAINER_QUERY_CLASSES,
  patterns: containerPatterns,
  cq,
  cqUnit,
  support: containerQuerySupport,
  migration: migrationGuide,
};