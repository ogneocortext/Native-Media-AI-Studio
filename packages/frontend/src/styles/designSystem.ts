/**
 * Shared design system for Native Media AI Studio
 * Import these constants to ensure consistent styling across all pages.
 * 
 * Usage:
 *   import { DS } from "../../styles/designSystem";
 *   <div className={DS.card}>...</div>
 */

export const DS = {
  // Layout
  page: "max-w-6xl mx-auto p-6 space-y-6",
  pageNarrow: "max-w-4xl mx-auto p-6 space-y-6",
  pageWide: "max-w-7xl mx-auto p-6 space-y-6",
  section: "space-y-4",
  grid2: "grid grid-cols-1 md:grid-cols-2 gap-4",
  grid3: "grid grid-cols-1 md:grid-cols-3 gap-4",
  grid4: "grid grid-cols-2 md:grid-cols-4 gap-4",
  gridMainSidebar: "grid grid-cols-1 lg:grid-cols-3 gap-6",
  gridChat: "grid grid-cols-1 lg:grid-cols-4 gap-6",
  flexBetween: "flex items-center justify-between",
  flexCenter: "flex items-center gap-2",
  flexWrap: "flex flex-wrap gap-2",

  // Cards (adaptive fills so token text + light: variants resolve correctly
  // in both themes; fixed-dark fills live behind .theme-dark islands instead)
  card: "bg-surface rounded-xl p-4 border border-token shadow-md",
  cardTight: "bg-surface rounded-xl p-3 border border-token shadow-md",
  cardHighlight: "bg-surface rounded-xl p-4 border border-violet-500/30 shadow-md",
  cardGradient: "rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 via-transparent to-transparent p-4",
  cardError: "p-4 bg-red-900/30 border border-red-700 rounded-xl flex items-center gap-3 text-red-300 light:text-red-700",
  cardWarning: "flex gap-2 text-sm text-muted bg-amber-500/5 border border-amber-500/20 rounded-xl p-3",
  cardSuccess: "p-4 bg-green-900/20 border border-green-700 rounded-lg",

  // Headers (text-foreground: near-white in dark, near-black in light —
  // raw text-white headings are invisible on light surfaces)
  pageTitle: "text-2xl font-bold text-foreground flex items-center gap-2",
  pageSubtitle: "text-sm text-muted mt-1",
  sectionTitle: "text-sm font-bold text-foreground flex items-center gap-2",
  cardTitle: "text-lg font-bold text-foreground flex items-center gap-2",

  // Text (theme tokens — gray-400/500 fail on light surfaces)
  textXs: "text-xs text-muted",
  textSm: "text-sm text-muted",
  textSmWhite: "text-sm text-foreground",
  textSmMedium: "text-sm font-medium text-secondary",
  textBold: "text-sm font-bold text-foreground",
  textBoldLg: "text-lg font-bold text-foreground",
  textBoldXl: "text-xl font-bold text-foreground",
  textBold2xl: "text-2xl font-bold text-foreground",
  textMute: "text-xs text-muted",
  textMuteSm: "text-xs text-muted",
  textLabel: "text-xs text-muted",
  textLabelSm: "text-[11px] text-muted",

  // Accent colors (400s fail on light tints — light: escape hatch each)
  accentViolet: "text-violet-400 light:text-violet-700",
  accentSky: "text-sky-400 light:text-sky-700",
  accentEmerald: "text-emerald-400 light:text-emerald-700",
  accentRed: "text-red-400 light:text-red-700",
  accentAmber: "text-amber-400 light:text-amber-700",
  accentGreen: "text-green-400 light:text-green-700",
  accentPurple: "text-purple-400 light:text-purple-700",

  // Stats (labels muted for both themes; values stay bright)
  statCard: "bg-surface rounded-xl p-3 border border-border text-center",
  statLabel: "text-xs text-muted",
  statValue: "text-xl font-bold text-foreground",
  statSub: "text-xs text-muted",

  // Buttons (solid fills are identical islands in both themes — keep white)
  btnPrimary: "px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2",
  btnPrimarySm: "px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-medium flex items-center gap-2",
  btnSecondary: "px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-xl text-sm font-medium flex items-center gap-2",
  btnSecondarySm: "px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium flex items-center gap-2",
  btnGhost: "p-1.5 hover:bg-gray-700 rounded-lg text-muted",
  btnGhostSm: "p-1 hover:bg-gray-700 rounded text-muted",
  btnDisabled: "disabled:bg-gray-600 disabled:cursor-not-allowed",
  btnFull: "w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-600 text-white rounded-xl font-medium flex items-center justify-center gap-2",

  // Inputs
  input: "w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-violet-500 focus:outline-none",
  inputSm: "px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm",
  textarea: "w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:border-violet-500 focus:outline-none",
  select: "w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-violet-500 focus:outline-none",
  selectSm: "px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm",
  range: "w-full accent-violet-500",

  // Badges (tinted fills adapt; text gets a light-theme escape hatch)
  badge: "text-xs px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 light:text-violet-700",
  badgeGreen: "text-xs px-2 py-0.5 rounded-full bg-green-900/30 border border-green-700 text-green-400 light:text-green-700",
  badgeRed: "text-xs px-2 py-0.5 rounded-full bg-red-900/30 border border-red-700 text-red-400 light:text-red-700",
  badgeAmber: "text-xs px-2 py-0.5 rounded-full bg-amber-900/30 border border-amber-700 text-amber-400 light:text-amber-700",
  badgeBlue: "text-xs px-2 py-0.5 rounded-full bg-blue-900/30 border border-blue-700 text-blue-400 light:text-blue-700",

  // Upload
  uploadZone: "relative border-2 border-dashed rounded-xl p-8 text-center transition-colors",
  uploadZoneActive: "border-violet-500 bg-violet-500/10",
  uploadZoneIdle: "border-gray-600 hover:border-gray-500",

  // Misc
  divider: "border-b border-gray-700",
  iconBtn: "p-1.5 hover:bg-gray-700 rounded-lg",
  iconBtnSm: "p-1 hover:bg-gray-700 rounded",
  loading: "animate-spin",
  pulse: "animate-pulse",
  truncate: "truncate",
  mono: "font-mono text-xs text-muted",
  link: "text-violet-400 light:text-violet-700 hover:underline",
} as const;

// Section color map for song structures
export const SECTION_COLORS: Record<string, string> = {
  intro: "bg-blue-500",
  verse: "bg-green-500",
  chorus: "bg-violet-500",
  bridge: "bg-orange-500",
  outro: "bg-red-500",
  full: "bg-gray-500",
};

// Energy level colors
export const ENERGY_COLORS = {
  high: "text-red-400",
  medium: "text-amber-400",
  low: "text-emerald-400",
} as const;
