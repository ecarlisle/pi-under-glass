---
name: Pi Under Glass
colors:
  canvas: '#0d100f'
  panel: '#151917'
  surface: '#1b211e'
  surface-raised: '#202722'
  border: '#303933'
  text: '#edf1ee'
  text-muted: '#96a199'
  agent: '#72c798'
  user: '#82b7e8'
  tool: '#d6ab5f'
  usage: '#b5a5e3'
  error: '#e87970'
  warning-surface: '#211d15'
  warning-border: '#54492f'
  warning-text: '#d7c49b'
  timeline-neutral: '#536158'
  timeline-track: '#252c28'
typography:
  title:
    fontFamily: Inter, ui-sans-serif, system-ui, sans-serif
    fontSize: 23px
    fontWeight: '700'
    lineHeight: normal
    letterSpacing: -0.025em
  section-heading:
    fontFamily: Inter, ui-sans-serif, system-ui, sans-serif
    fontSize: 17px
    fontWeight: '700'
    lineHeight: normal
    letterSpacing: '0'
  subsection-heading:
    fontFamily: Inter, ui-sans-serif, system-ui, sans-serif
    fontSize: 13px
    fontWeight: '700'
    lineHeight: normal
    letterSpacing: '0'
  body:
    fontFamily: Inter, ui-sans-serif, system-ui, sans-serif
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.55'
    letterSpacing: '0'
  metadata:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, monospace
    fontSize: 11px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: '0'
  label-caps:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, monospace
    fontSize: 9px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: 0.04em
rounded:
  xs: 2px
  sm: 4px
  md: 6px
  lg: 10px
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 18px
  xl: 22px
  gutter: 18px
  margin-mobile: 12px
  margin-desktop: 22px
---

# Design System: Pi Under Glass

## 1. Visual Theme & Atmosphere

Pi Under Glass is a restrained, dark, evidence-first interface. It should feel like a clear pane placed over a running local agent session: quiet enough to leave the transcript in control, but structured enough to make state, timing, tools, and errors immediately legible. Near-black green neutrals create a calm technical backdrop, while thin borders and small shifts in surface tone establish hierarchy without decorative elevation.

The visual language favors factual density over dashboard spectacle. Metadata is compact and monospaced, prose remains readable in a neutral sans serif, and semantic color is reserved for the actor or event it represents. The interface should remain plain, local, and inspectable. Avoid gradients, ornamental illustration, heavy shadows, oversized statistics, glass effects beyond the lightly blurred sticky header, and visual treatments that make the viewer feel like a general analytics product.

## 2. Color Palette & Roles

### Primary Foundation

- **Deep Green-Black Canvas — `#0d100f`:** Page background, nested evidence background, and code/result wells. This is the deepest layer.
- **Charcoal Forest Panel — `#151917`:** Main overview and detail panels, sticky header base, and fixed options bar.
- **Soft Graphite Surface — `#1b211e`:** Selected facts, quoted agent output, and hoverable row surfaces.
- **Raised Graphite — `#202722`:** Compact controls such as copy buttons. Use sparingly to indicate a control without introducing shadow.
- **Structural Moss Border — `#303933`:** The universal one-pixel divider and container outline.
- **Timeline Track — `#252c28`:** Quiet background for turn ribbons.

Surfaces are flat. Depth comes from nesting darker and lighter fills, one-pixel borders, sticky positioning, and limited backdrop blur rather than drop shadows.

### Accent & Interactive

- **Agent Mint — `#72c798`:** Assistant responses, live state, selected-turn accent, response ribbon segments, and checkbox accents.
- **User Sky — `#82b7e8`:** User prompts, keyboard focus, prompt markers, and temporary evidence focus rings.
- **Tool Amber — `#d6ab5f`:** Tool activity, running/reconnecting states, and processing details.
- **Usage Lavender — `#b5a5e3`:** Usage facts, context/session markers, and sample-data state.
- **Timeline Moss — `#536158`:** Time outside tool or response activity. It is deliberately quieter than semantic event colors.

Accent colors communicate event ownership and state, not decoration. Do not use Agent Mint as a generic brand fill or Tool Amber as a general highlight.

### Typography & Text Hierarchy

- **Primary Frost — `#edf1ee`:** Main headings, transcript content, and primary values.
- **Muted Sage Gray — `#96a199`:** Labels, timestamps, secondary prompts, legends, empty states, and inactive controls.

Primary and muted text must preserve a clear two-level hierarchy against every dark surface. Avoid introducing intermediate grays unless a real information tier requires one.

### Functional States

- **Error Coral — `#e87970`:** Interrupted status, failed tools, error counts, and error markers.
- **Error Border — `#78433f`:** Error outlines without increasing visual weight.
- **Caution Brown Surface — `#211d15`:** Structural signals and agent-processing containers.
- **Caution Ochre Border — `#54492f`:** Caution and processing outlines.
- **Caution Parchment — `#d7c49b`:** Text inside signal callouts.
- **Live Border — `#3c704d`:** Quiet green outline around live and active badges.
- **Reconnect Border — `#765a2b`:** Amber-brown reconnecting outline.

Every state must retain a text label; color is supplementary and must never carry meaning alone.

## 3. Typography Rules

### Font Families

The primary family is **Inter** with native system sans-serif fallbacks. It is not remotely loaded, so rendering must remain dependable and local-first when Inter is unavailable. Use it for headings, prompts, prose, option labels, and empty states. Its neutral, compact character keeps the transcript readable without giving the interface a consumer-product tone.

The metadata family is the platform monospace stack: **ui-monospace, SFMono-Regular, Menlo, monospace**. Use it for labels, facts, table content, statuses, timestamps, tool headings, and preformatted evidence. Monospace is a semantic signal for observed or machine-reported facts, not the default for long assistant prose.

### Hierarchy & Weights

- **Product title:** 23px, bold, slightly tight `-0.025em` tracking. Keep it compact; it is orientation, not a hero statement.
- **Section heading:** 17px, bold. Used for the turn overview and selected-turn title.
- **Subsection heading:** 13px, bold. Used for evidence section labels and rendered markdown headings.
- **Transcript body:** 13px, regular, `1.55` line-height. Preserve wrapping and readable paragraph rhythm.
- **Selected prompt:** 13px, regular, `1.5` line-height, muted.
- **Metadata value:** 10–11px, semibold monospace, approximately `1.2–1.4` line-height.
- **Uppercase label:** 9–10px, semibold monospace, `0.04–0.08em` tracking.
- **Table content:** 10px, semibold monospace with a tight single-line treatment.

Use uppercase only for small structural labels. Avoid uppercase body copy or large display typography.

### Spacing Principles

Text spacing is deliberately compact. Eyebrows sit 4px above headings; evidence headers sit 7px above content; paragraph bodies use line-height rather than large vertical margins. Long text should wrap naturally, while facts and table values remain single-line with ellipsis where space is constrained.

## 4. Component Stylings

### Buttons

The system has no large primary call-to-action. Buttons are quiet utilities:

- **Turn selector:** Transparent fill, 3px radius, Agent Mint text, and a two-pixel User Sky focus outline.
- **Copy control:** Raised Graphite fill, one-pixel Structural Moss border, 4px radius, muted 9px monospace text, and compact `3px 7px` padding.

Keep native cursor and focus behavior obvious. Do not add animated transforms, gradients, or elevated button shadows.

### Panels & Containers

The overview and detail panels use the Panel surface, a one-pixel border, and 10px corners. They do not cast shadows. Panel headings use `16px 18px` padding and a bottom divider. Nested containers use progressively smaller radii: 6px for callouts, 5px for nested evidence, and 4px for timeline tracks and utility controls.

The selected-facts block behaves like a compact data grid. A one-pixel border-colored gap separates cells; each cell uses the Surface fill and 11px internal padding. This treatment should be reused for small groups of equally weighted factual values.

### Status Pills & Fact Badges

Statuses use a full pill radius, a one-pixel semantic or neutral border, and compact monospace text. The default badge is muted and neutral. Active badges switch to Agent Mint with the Live Border; error badges switch to Error Coral with the Error Border. Pills remain labels, not buttons, unless explicit interaction is added.

### Turn Table & Activity Ribbon

The seven-column turn table is compact, fixed-layout, and horizontally scrollable when needed. Header labels are 9px uppercase monospace; rows are 38px tall. Hover uses the Surface fill. Selection uses a faint Agent Mint tint and a three-pixel inset Agent Mint rule on the leading edge.

Each turn ribbon uses the Timeline Track and contains low-profile colored segments: Timeline Moss for time outside tools, Tool Amber for tool activity, and Agent Mint for response output. Three-pixel vertical points mark prompts in User Sky, failures in Error Coral, and session markers in Usage Lavender. Segments must remain keyboard-focusable and expose text labels or titles.

### Evidence Transcript

Evidence is presented as a continuous chronological list rather than separate floating cards. Each item receives `14px 0` padding and a single bottom divider. Prompt headings use User Sky, assistant headings use Agent Mint, tool summaries use Tool Amber, failures use Error Coral, and usage or session markers use Usage Lavender.

Expandable tool and processing details use native `details`/`summary` behavior. Tool arguments and results sit in Deep Green-Black code wells with a one-pixel border, 5px corners, 10px padding, and an 11px monospace body. Preformatted content may scroll up to 420px high and must wrap long values safely.

### Inputs & Options

The options bar is fixed to the viewport bottom and uses native checkboxes with Agent Mint accent color. Labels are muted 11px sans-serif text with a 6px control gap. The expanded options body wraps into compact groups on wide screens and becomes a vertical list on narrow screens. Preserve native form semantics and visible labels.

### Navigation

There is no conventional navigation. Orientation comes from the sticky session header, the turn overview, the selected-turn detail, and the fixed evidence-options tray. Do not introduce a sidebar, tabs, or global navigation unless the product scope changes.

## 5. Layout Principles

### Grid & Structure

The desktop workspace is capped at **1500px** and uses a two-column grid: approximately 42.5% for the turn overview and 57.5% for selected evidence, with an 18px gap. The overview has a 380px minimum and the detail panel a 500px minimum. Both columns align at the top.

The header is sticky at the top; the overview panel is independently sticky below it and limited to the viewport height. The options tray is fixed to the bottom. These anchors keep session identity, turn navigation, and display controls available while evidence scrolls.

### Whitespace Strategy

The design uses an inferred 4px rhythm with deliberate compact exceptions for borders and data-table alignment. Common distances are 4px, 8–12px, 14–18px, and 22–24px. Desktop page margins are 22px, the workspace gap is 18px, panel header padding is 16px by 18px, and evidence content has 18px horizontal padding.

Whitespace should clarify grouping without making the interface airy. Major regions receive approximately 18–22px; factual and tool-level elements receive 3–12px.

### Alignment & Visual Balance

Content is left-aligned. Numeric tool and error columns align right for fast comparison. Header facts flow horizontally and scroll rather than wrap into a tall summary. Visual weight stays balanced between the compact turn table and the more verbose evidence transcript; neither panel should become an ornamental dashboard card.

### Responsive Behavior & Touch

The stylesheet is desktop-first with two `max-width` breakpoints:

- **980px and below:** The sticky header and overview become static, the workspace collapses to one column with a 760px cap and 12px side margins, selected facts use three columns, and the options tray uses the same narrow width.
- **560px and below:** The panel legend moves below its heading, selected facts use two columns, and option groups stack vertically.

The turn table retains a 500px minimum width and scrolls horizontally rather than collapsing columns or hiding evidence. Focus outlines are explicit. Motion is limited to a temporary 1.2-second evidence focus ring and is disabled under `prefers-reduced-motion`.

## 6. Design System Notes for Stitch Generation

### Language to Use

Describe new Pi Under Glass screens as **minimal, dark, local-first, evidence-led, compact, technical, flat, bordered, transcript-focused, and semantically color-coded**. Ask for high information clarity, native browser controls, strong keyboard focus, and calm green-black neutrals.

Avoid prompts such as luxurious, glossy, futuristic, neon, glass dashboard, analytics suite, or highly animated. “Under glass” refers to visibility into a session, not decorative glassmorphism.

### Color References

Anchor every screen with Deep Green-Black Canvas (`#0d100f`), Charcoal Forest Panel (`#151917`), Structural Moss Border (`#303933`), Primary Frost text (`#edf1ee`), and Muted Sage Gray (`#96a199`). Apply Agent Mint, User Sky, Tool Amber, Usage Lavender, and Error Coral only to their corresponding event roles.

### Component Prompts

1. **Turn overview:** “Create a compact dark turn table on a flat charcoal panel. Include prompt excerpts, a slim semantic activity ribbon, pill status labels, wall time, tool count, and error count. Use thin moss-gray borders, monospace facts, green selection, and horizontal scrolling rather than hiding columns.”
2. **Evidence transcript:** “Create a chronological evidence transcript with divider-separated prompt, assistant, tool, usage, and marker entries. Color only each entry heading by actor or event type. Use native expandable tool details with dark code wells and small copy controls; avoid floating cards and shadows.”
3. **Session header and controls:** “Create a sticky compact session header with a quiet connection-status pill and a horizontally scrollable row of factual metrics. Add a fixed bottom disclosure for evidence options using native checkboxes and muted labels.”

### Incremental Iteration

When extending the interface, preserve the existing density and semantic color assignments first. Introduce at most one new layout primitive or functional color at a time. Prefer reusing bordered panels, fact grids, transcript dividers, native disclosures, and compact badges. Validate wide desktop, single-column tablet, 500px table overflow, narrow mobile option stacking, keyboard focus, and reduced-motion behavior after each visual change.
