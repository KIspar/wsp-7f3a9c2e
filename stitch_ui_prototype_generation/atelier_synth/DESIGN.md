---
name: Atelier Synth
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#464555'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4d44e3'
  primary: '#3525cd'
  on-primary: '#ffffff'
  primary-container: '#4f46e5'
  on-primary-container: '#dad7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#4648d4'
  on-secondary: '#ffffff'
  secondary-container: '#6063ee'
  on-secondary-container: '#fffbff'
  tertiary: '#004d70'
  on-tertiary: '#ffffff'
  tertiary-container: '#006693'
  on-tertiary-container: '#b8e0ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3323cc'
  secondary-fixed: '#e1e0ff'
  secondary-fixed-dim: '#c0c1ff'
  on-secondary-fixed: '#07006c'
  on-secondary-fixed-variant: '#2f2ebe'
  tertiary-fixed: '#c9e6ff'
  tertiary-fixed-dim: '#89ceff'
  on-tertiary-fixed: '#001e2f'
  on-tertiary-fixed-variant: '#004c6e'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-mono-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: -0.01em
  label-mono-md:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
  label-mono-xs:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 12px
    letterSpacing: 0.04em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-dense: 0.5rem
  margin: 1.5rem
  margin-dense: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
  space-2xl: 2rem
---

## Brand & Style

This design system is engineered specifically for high-velocity fashion e-commerce digital merchandising, generative lookbook creation, and batch marketing asset production. It is built for professional desktop operators—digital merchandisers, prompt engineers, fashion art directors, and catalog specialists—working on Windows 11 desktop environments with native-like performance expectations.

### Personality & Tone
- **Precision Instrument:** The interface treats generative AI as a high-throughput manufacturing engine rather than a chat companion. Chat bubbles, avatar banter, and conversational flairs are strictly eliminated.
- **Architectural Clarity:** Strict structural discipline using precision borders, high-density metric grids, and unambiguous state signifiers.
- **Controlled Contrast:** A dual-atmosphere paradigm pairing a high-density, dark slate navigational anchor (`#0F172A`) with an ultra-clean, neutral canvas (`#F8FAFC` to `#FFFFFF`) for visual clarity during color correction, texture inspection, and garment silhouette verification.

### Design Movement
- **Technical Minimalist / Slate Utility:** Borrowing the rigor of professional video grading suites and CAD interfaces, balanced with modern typography, micro-borders (`1px`), and deliberate indigo/violet laser highlights for high-priority operational interactions.

## Colors

The system uses a calibrated dual-zone scheme. The global navigation and persistent control panels inhabit a deep slate spectrum, while the primary production canvas operates in high-legibility neutral gray and pure white to preserve garment color integrity.

### Primary & Accent Spectrum
- **Primary Indigo (`#4F46E5`)**: Primary execution actions, generation triggers, active selection frames, and primary toggles.
- **Secondary Indigo (`#6366F1`)**: Focus rings, multi-select active highlights, and hover state elevations.
- **Electric Cyan (`#0EA5E9`)**: High-speed real-time telemetry, model parameter overrides, and agent node status.

### Neutral & Structural Canvas (Light Work Surface)
- **Canvas Base (`#F8FAFC`)**: Global backdrop behind task cards and agent flows.
- **Surface High (`#FFFFFF`)**: Card containers, inspect drawers, parameter modals, and active inputs.
- **Border Subdued (`#E2E8F0`)**: Card separators, perimeter strokes, and modular splitters.
- **Border Strong (`#CBD5E1`)**: Form field borders, active droppable drop-targets, and modal headers.

### Navigational Dark Slate (Sidebar & Frame Anchors)
- **Sidebar Surface (`#0F172A`)**: Primary persistent shell navigation.
- **Sidebar Elevated (`#1E293B`)**: Group headings, hovered navigation nodes, and workspace pills.
- **Sidebar Border (`#334155`)**: Navigational dividers and status separator lines.
- **Text on Dark (`#F1F5F9`)**: Navigation labels, tier headers.
- **Text Subdued on Dark (`#94A3B8`)**: Hotkey prompts, category counters, and build identifiers.

### Semantic Production States
- **Queued (`#64748B` / Slate)**: Pending pipeline workers.
- **Generating (`#4F46E5` / Indigo Pulsing)**: Model actively synthesizing textures or geometry.
- **Success (`#059669` / Emerald)**: Clean render approved and cached.
- **Review Required / Pending Verification (`#D97706` / Amber)**: Artifacts detected, mask confidence below 92%, or size mismatch.
- **Unsaved / Staged (`#2563EB` / Blue)**: Generation complete, awaiting catalog commit or S3 sync.
- **Failed (`#DC2626` / Crimson)**: Compute crash, prompt safety trigger, or API timeout.

## Typography

The typography pairs **Inter** for dense interface hierarchies and **JetBrains Mono** for technical parameter values, seeds, latencies, tokens, and model identifiers.

### Hierarchy Rules
- **Headline-XL & LG**: Reserved for workspace top headers, skill catalog titles, and agent wizard module designations. Never used inside feed cards.
- **Headline-MD**: Component and drawer panel headings, parameter modal quadrant dividers.
- **Body-LG & MD**: Form control inputs, prompt text in execution docks, and skill markdown body documentation.
- **Body-SM**: Microcopy, parameter tooltips, and task card file metadata.
- **Label-Mono Scale**: All model tags (e.g., `SDXL-Fashion-V4`, `FLUX-Dev-Schnell`), seed hashes (`#92847103`), resolution tokens (`1024x1536`), GPU memory footprint trackers, and execution timers. Monospaced clarity avoids column jitter during streaming telemetry.

## Layout & Spacing

The layout is optimized for 1440px and 1920px desktop viewports, using an exact 8pt spacing rhythm (supplemented with 4px micro-steps for compact data rows).

### Structural Architecture
1. **Left Navigational Spine (Fixed 240px)**:
   - Deep slate container (`#0F172A`).
   - Vertically structured: Workspace branding, Category switches (All, Image, Video, Agents, Settings), local backend connectivity health indicator, and hardware utilization gauges at the base.
2. **Production Canvas (Flexible Width)**:
   - Dynamic fluid area filling remaining viewport width.
   - Fixed header bar (48px height) housing active skill documentation, pipeline state, token quotas, and active job counters.
3. **Feed & Task Layouts**:
   - Standard Studio: Uniform height task-card grid using responsive auto-fill columns (`minmax(320px, 1fr)`).
   - Agent Workflow Studio (One-Click Benchmark): A horizontal, three-column layout:
     - *Column 1 (30% width)*: Reference benchmarking, competitor lookbook ingest, source garments.
     - *Column 2 (40% width)*: Node configuration, garment silhouette extraction, white-background isolation toggles, and lighting modifiers.
     - *Column 3 (30% width)*: Output review, mask correction brush shortcuts, status stamps, and sync switches.
4. **Docked Production Panel (Floating Bottom)**:
   - Positioned fixed horizontally centered above the canvas bottom margin (`bottom: 1.5rem`, `max-width: 1080px`, `width: calc(100% - 320px)`).
   - Elevation layer housing prompt input, stacked reference thumbnails, aspect ratio locks, model selectors, and modal launch triggers.

## Elevation & Depth

Visual depth is achieved through **tonal separation and crisp 1px borders** rather than soft, consumer-style blur drops. This maintains precise edge visibility for fashion asset inspection.

### Elevation Levels
- **Level 0 (Flat Ground - `#F8FAFC`)**: Base canvas workspace.
- **Level 1 (Card & Module Resting - `#FFFFFF`)**:
  - Border: `1px solid #E2E8F0`.
  - Shadow: `0 1px 2px 0 rgba(15, 23, 42, 0.04)`.
- **Level 2 (Hovered Cards & Docked Production Engine)**:
  - Border: `1px solid #CBD5E1`.
  - Shadow: `0 4px 12px -2px rgba(15, 23, 42, 0.08), 0 2px 6px -1px rgba(15, 23, 42, 0.04)`.
- **Level 3 (Inspection Drawers & Floating Controls)**:
  - Border: `1px solid #E2E8F0`.
  - Shadow: `-4px 0 24px -4px rgba(15, 23, 42, 0.12)`.
- **Level 4 (Parameter Matrix Modals & Media Zoom Viewports)**:
  - Backdrop: `rgba(15, 23, 42, 0.65)` with an `8px` gaussian backdrop filter.
  - Container Border: `1px solid #334155`.
  - Container Shadow: `0 24px 48px -12px rgba(15, 23, 42, 0.28)`.

## Shapes

The system implements strict, utilitarian roundedness (`roundedness: 1`) to preserve vertical and horizontal alignment across dense UI panels.

### Radius Metrics
- **Interactive Controls (Inputs, Micro Buttons, Segment Toggles)**: `4px` (`0.25rem`).
- **Cards, Surface Panels, Media Thumbnails**: `6px` (`0.375rem`).
- **Floating Input Dock, Flyout Menus, Parameter Modals**: `8px` (`0.5rem`).
- **Status Pills, Counter Badges**: `9999px` (Strict full capsule pill).
- **Prohibited**: Freeform asymmetrical curves, pill buttons for main actions, and roundness exceeding 8px on rect containers.

## Components

### 1. Navigation Sidebar (Slate Shell)
- **Container**: Solid `#0F172A` with a right border `1px solid #1E293B`.
- **Category Nodes**: Height 36px, horizontal padding 12px. Idle text `#94A3B8`, icon 18px. Active node has background `#1E293B`, text `#FFFFFF`, and an Indigo left accent indicator (`3px width`, `#4F46E5`).
- **System Telemetry Bar (Bottom)**: Local backend pulse indicator (Emerald dot `#10B981` + `localhost:7860`), GPU memory utilization progress bar (4px height), and direct link to Settings.

### 2. Task Result Card (Uniform Height Feed Element)
- **Container**: Fixed height 420px. Background `#FFFFFF`, border `1px solid #E2E8F0`, corner radius `6px`.
- **Header Strip**: Task ID (`#04928`), timestamp, and dynamic Status Pill:
  - *Queued*: Slate border and subtle slate tint.
  - *Generating*: Indigo border, animated 1.5s breathing pulse indicator, progress bar along the bottom edge.
  - *Success*: Emerald fill badge with white mono text.
  - *Pending Verification*: Amber tag with manual checkmark trigger.
  - *Unsaved*: Blue outline badge with commit prompt.
  - *Failed*: Crimson tag with error code popover trigger.
- **Media Presentation Viewport**: 1:1 or 3:4 locked aspect preview area with neutral checkerboard pattern (`#F1F5F9` / `#FFFFFF`) for transparency visibility. Hover overlays quick-action bar: zoom modal, compare slider trigger, seed copy, and single item re-roll.
- **Footer**: Single-line prompt summary with tooltip expansion, token cost badge, and ZIP package export icon.

### 3. Floating High-Output Production Dock
- **Container**: Positioned at bottom center, floating above the canvas. High-opacity surface (`rgba(255, 255, 255, 0.96)` with 12px background blur), crisp outer border `1px solid #CBD5E1`.
- **Stacked Ingest Rail**: Dropped fashion garments or model poses appear as 44x44px overlapping sticky note tiles with quick-delete badges and weight multipliers (`1.0x`, `0.8x`).
- **Primary Input Box**: Multiline auto-expanding textarea, zero-border inner container, mono-styled prompt enhancer pills.
- **Action Toolbar**:
  - Model selector dropdown (e.g., `FLUX.1-D`, `Inpainting-Fashion-Pro`).
  - Quick dimension buttons (`3:4 E-com`, `1:1 Detail`, `9:16 Story`).
  - Parameter Matrix modal trigger button (`SettingsSliders` icon).
  - Primary Generate button: High-contrast `#4F46E5` background, hover `#4338CA`, active `#3730A3`, white bold text with immediate shortcut hint (`Ctrl + Enter`).

### 4. Parameter Matrix Modal
- **Split-Engine Architecture**:
  - *Left Zone (Skill Base Parameters)*: Denoising strength slider, Guidance Scale (CFG), Seed locker, Sampler dropdown, Clip Skip counter.
  - *Right Zone (Model Architecture & Hardware Flags)*: VAE selector, LoRA stack weight array (multi-row stack with separate trigger weights), Face Restoration toggles, FP16/BF16 precision switches, batch execution size (1 to 16).
- **Footer**: Preset manager ("Zara Catalog Look", "Amazon Clean White", "Ghost Mannequin") + Reset to Defaults + Confirm.

### 5. Task Detail & Inspection Drawer (Right Slide-over)
- **Dimensions**: Fixed 480px width, slides over right boundary.
- **Tabbed Hierarchy**:
  1. *Metadata Snapshot*: Execution node tree, complete unclipped prompt + negative prompt, resolution, generation duration (ms), VRAM peak.
  2. *Runtime Logs*: Monospaced terminal output (`JetBrains Mono`, 11px) detailing pipeline steps and worker thread assignments.
  3. *Cost & Quota Ledger*: Local GPU compute-seconds or cloud inference token burn breakdown.
  4. *Attempt History*: Timeline of re-rolls linked to this SKU root.

### 6. Agent Workflow Layout: One-Click Competitor Benchmark
- **Three-Column Fixed Height Shell**:
  - *Left (Reference Intake)*: Drag-and-drop competitor product detail page images, auto-scraped lookbook URLs, automatic pose estimation skeleton viewer.
  - *Center (Transform Matrix)*: SKU fabric mask sensitivity, white-background isolation mode toggle (auto alpha channel cut), target model demographic matrix, ambient studio lighting profile selector.
  - *Right (Result & Catalog Commit)*: High-resolution real-time preview, side-by-side split wiper for visual diff against competitor standard, direct "Approve & Push to Store" CTA.