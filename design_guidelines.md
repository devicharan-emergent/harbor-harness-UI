{
  "design_system_name": "ACM macOS Glass (Aqua Light/Dark)",
  "brand_attributes": [
    "native-macOS", 
    "calm + high-clarity", 
    "developer-grade", 
    "low-chrome / content-forward", 
    "depth via translucency"
  ],
  "typography": {
    "font_stack": {
      "ui": "-apple-system, BlinkMacSystemFont, \"SF Pro Display\", \"SF Pro Text\", \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif",
      "mono": "ui-monospace, \"SF Mono\", Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace"
    },
    "tailwind_notes": [
      "Set body to font-sans using the system stack above (update index.css @layer base body).",
      "Use mono stack for YAML and diff surfaces only; keep the rest SF/system."
    ],
    "scale": {
      "h1": "text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight",
      "h2": "text-base md:text-lg font-medium text-muted-foreground",
      "section_title": "text-sm font-semibold tracking-wide text-foreground/80",
      "body": "text-sm md:text-base leading-6",
      "small": "text-xs text-muted-foreground",
      "code": "text-[12.5px] leading-6"
    }
  },
  "color_system": {
    "mode_strategy": "Use prefers-color-scheme as default; allow user override later via app setting. Use HSL CSS vars in index.css to match Shadcn theming.",
    "tokens": {
      "light": {
        "background": "210 25% 98%",
        "foreground": "220 20% 12%",
        "card": "0 0% 100%",
        "card-foreground": "220 20% 12%",
        "popover": "0 0% 100%",
        "popover-foreground": "220 20% 12%",
        "primary": "220 26% 14%",
        "primary-foreground": "0 0% 100%",
        "secondary": "220 14% 96%",
        "secondary-foreground": "220 20% 18%",
        "muted": "220 14% 95%",
        "muted-foreground": "220 10% 42%",
        "accent": "212 55% 94%",
        "accent-foreground": "220 26% 14%",
        "border": "220 14% 88%",
        "input": "220 14% 86%",
        "ring": "211 90% 56%",
        "destructive": "0 72% 51%",
        "destructive-foreground": "0 0% 98%",
        "success-bg": "152 45% 95%",
        "success-fg": "155 45% 28%",
        "warning-bg": "44 90% 92%",
        "warning-fg": "28 90% 36%",
        "info-bg": "212 70% 94%",
        "info-fg": "212 80% 40%",
        "glass-tint": "210 25% 98%",
        "shadow": "220 40% 2%"
      },
      "dark": {
        "background": "220 18% 10%",
        "foreground": "210 20% 96%",
        "card": "220 18% 12%",
        "card-foreground": "210 20% 96%",
        "popover": "220 18% 12%",
        "popover-foreground": "210 20% 96%",
        "primary": "210 20% 96%",
        "primary-foreground": "220 20% 10%",
        "secondary": "220 16% 16%",
        "secondary-foreground": "210 20% 96%",
        "muted": "220 14% 16%",
        "muted-foreground": "215 12% 70%",
        "accent": "212 40% 18%",
        "accent-foreground": "210 20% 96%",
        "border": "220 14% 20%",
        "input": "220 14% 20%",
        "ring": "211 90% 62%",
        "destructive": "0 72% 51%",
        "destructive-foreground": "0 0% 98%",
        "success-bg": "155 35% 16%",
        "success-fg": "145 55% 70%",
        "warning-bg": "28 60% 16%",
        "warning-fg": "42 90% 70%",
        "info-bg": "212 45% 16%",
        "info-fg": "210 90% 74%",
        "glass-tint": "220 18% 12%",
        "shadow": "0 0% 0%"
      }
    },
    "macos_semantic_notes": [
      "Prefer subtle blues for focus/ring (macOS Aqua).",
      "Avoid heavy saturation; keep chroma low and rely on opacity + blur for depth.",
      "Use 1px separators, not heavy shadows, for structure (Finder/System Settings vibe)."
    ]
  },
  "effects": {
    "glassmorphism_rules": [
      "Use blur only for large surfaces: titlebar, sidebar, top toolbars, popovers. Do not blur text-heavy editor content.",
      "Glass surfaces are tinted with --glass-tint at ~70–88% opacity.",
      "Add 1px hairline border with white/black alpha depending on mode to mimic macOS separators."
    ],
    "tailwind_recipes": {
      "glass_surface": "backdrop-blur-xl bg-[hsl(var(--glass-tint)/0.72)] border border-[hsl(var(--border)/0.55)] shadow-[0_18px_50px_hsl(var(--shadow)/0.12)]",
      "glass_surface_strong": "backdrop-blur-2xl bg-[hsl(var(--glass-tint)/0.86)] border border-[hsl(var(--border)/0.6)] shadow-[0_20px_60px_hsl(var(--shadow)/0.18)]",
      "inset_panel": "bg-[hsl(var(--card)/0.72)] border border-[hsl(var(--border)/0.7)] shadow-[inset_0_1px_0_hsl(0_0%_100%/0.35)]",
      "hairline_separator": "bg-[hsl(var(--border)/0.9)]"
    },
    "noise_overlay": {
      "css": ".noise::before{content:\"\";position:absolute;inset:0;pointer-events:none;background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"220\" height=\"220\"><filter id=\"n\"><feTurbulence type=\"fractalNoise\" baseFrequency=\"0.9\" numOctaves=\"3\" stitchTiles=\"stitch\"/></filter><rect width=\"220\" height=\"220\" filter=\"url(%23n)\" opacity=\"0.08\"/></svg>');mix-blend-mode:overlay;opacity:.55}",
      "usage": "Apply 'relative noise' on the app shell background only (never inside form fields)."
    }
  },
  "layout": {
    "shell": {
      "structure": "macOS-window shell: titlebar+toolbar (top), sidebar (left), content (right).",
      "grid": "Use CSS grid: grid-cols-[280px_1fr] on desktop; collapse sidebar into Sheet on mobile.",
      "max_width": "No hard max-width; behave like a desktop app. Use internal content max-w-[1100px] for forms in editor content area.",
      "padding": "More whitespace: px-3 sm:px-4 lg:px-6, vertical gaps 16–24px."
    },
    "titlebar": {
      "height": "h-12 (macOS titlebar), toolbar components align center.",
      "traffic_lights": "Top-left, 3 circles 12px with subtle inner highlight. Must be decorative (no window control actions in web).",
      "classes": "flex items-center gap-3 px-3 glass_surface",
      "testid": "data-testid=\"app-titlebar\""
    },
    "sidebar": {
      "style": "Finder-like: icon+label items, grouped sections, active item has tinted pill background.",
      "classes": "glass_surface h-[calc(100vh-3rem)] sticky top-12",
      "item_classes": {
        "base": "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground/80 hover:bg-[hsl(var(--accent)/0.6)]",
        "active": "bg-[hsl(var(--accent)/0.9)] text-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.35)]"
      },
      "testid": "data-testid=\"app-sidebar\""
    },
    "content": {
      "style": "Subtle insets + separators. Content header row mimics Xcode inspector header.",
      "classes": "min-h-[calc(100vh-3rem)] px-3 sm:px-4 lg:px-6 py-4",
      "testid": "data-testid=\"app-content\""
    }
  },
  "components": {
    "component_path": {
      "button": "/app/frontend/src/components/ui/button.jsx",
      "input": "/app/frontend/src/components/ui/input.jsx",
      "textarea": "/app/frontend/src/components/ui/textarea.jsx",
      "select": "/app/frontend/src/components/ui/select.jsx",
      "switch": "/app/frontend/src/components/ui/switch.jsx",
      "tabs": "/app/frontend/src/components/ui/tabs.jsx",
      "table": "/app/frontend/src/components/ui/table.jsx",
      "dialog": "/app/frontend/src/components/ui/dialog.jsx",
      "popover": "/app/frontend/src/components/ui/popover.jsx",
      "context_menu": "/app/frontend/src/components/ui/context-menu.jsx",
      "hover_card": "/app/frontend/src/components/ui/hover-card.jsx",
      "command_palette": "/app/frontend/src/components/ui/command.jsx",
      "sheet_mobile_sidebar": "/app/frontend/src/components/ui/sheet.jsx",
      "sonner_toast": "/app/frontend/src/components/ui/sonner.jsx",
      "scroll_area": "/app/frontend/src/components/ui/scroll-area.jsx",
      "resizable": "/app/frontend/src/components/ui/resizable.jsx",
      "separator": "/app/frontend/src/components/ui/separator.jsx",
      "badge": "/app/frontend/src/components/ui/badge.jsx",
      "breadcrumb": "/app/frontend/src/components/ui/breadcrumb.jsx",
      "calendar": "/app/frontend/src/components/ui/calendar.jsx",
      "tooltip": "/app/frontend/src/components/ui/tooltip.jsx"
    },
    "button_spec": {
      "style": "macOS-style: rounded, subtle borders, low elevation. Primary is near-black in light mode and near-white in dark mode.",
      "tokens": {
        "radius": "12px",
        "height": "h-9",
        "padding": "px-3",
        "focus": "focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring)/0.55)] focus-visible:ring-offset-0"
      },
      "variants": {
        "primary": "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-95",
        "secondary": "bg-[hsl(var(--secondary)/0.7)] text-foreground border border-[hsl(var(--border)/0.8)] hover:bg-[hsl(var(--secondary))]",
        "ghost": "bg-transparent hover:bg-[hsl(var(--accent)/0.65)]"
      },
      "micro_interaction": "On active: scale(0.98) already exists in App.css; keep. Add subtle highlight on hover using opacity change only (no transform on hover).",
      "testid_rule": "Every Button must include data-testid (e.g., data-testid=\"agent-editor-save-button\")."
    },
    "form_controls": {
      "inputs": "Use Input/Textarea/Select/Switch shadcn components; apply inset_panel wrapper for grouped settings.",
      "native_feel": [
        "Inputs: 34–36px height, rounded-md, subtle border, background slightly translucent.",
        "Switch: keep compact; place labels left, control right (System Settings layout).")
      ],
      "validation": "Errors appear as small text-xs with destructive color and a subtle icon (lucide).",
      "testid_examples": [
        "data-testid=\"agent-general-name-input\"",
        "data-testid=\"agent-model-provider-select\"",
        "data-testid=\"agent-runtime-timeout-input\""
      ]
    },
    "navigation": {
      "pattern": "Sidebar + top toolbar actions. Use Breadcrumb for deep editor routes.",
      "command_palette": "Cmd+K opens Command (shadcn/command) for quick agent search, create, open compare, export.",
      "testid": "data-testid=\"command-palette\""
    },
    "tables": {
      "agent_list": "Use shadcn Table. Add sticky header, zebra rows with very low alpha. Row hover: subtle accent tint.",
      "classes": {
        "table_shell": "rounded-xl border border-[hsl(var(--border)/0.8)] bg-[hsl(var(--card)/0.65)] backdrop-blur-sm overflow-hidden",
        "row_hover": "hover:bg-[hsl(var(--accent)/0.55)]"
      },
      "testid": [
        "data-testid=\"agent-list-table\"",
        "data-testid=\"agent-list-search-input\""
      ]
    },
    "tabs_editor": {
      "agent_editor_tabs": "Use shadcn Tabs; make it look like macOS segmented control: pill background with thumb highlight.",
      "classes": {
        "tabs_list": "bg-[hsl(var(--secondary)/0.75)] border border-[hsl(var(--border)/0.75)] rounded-xl p-1",
        "tabs_trigger": "rounded-lg px-3 py-1.5 text-sm data-[state=active]:bg-[hsl(var(--card)/0.7)] data-[state=active]:shadow-[0_1px_0_hsl(0_0%_100%/0.35)]"
      },
      "testid": "data-testid=\"agent-editor-tabs\""
    },
    "compare_view": {
      "layout": "Two resizable panes (shadcn/resizable). Left=Baseline, Right=Candidate. Top row contains diff options + export.",
      "diff_colors": "Use --diff-added-bg/fg and --diff-removed-bg/fg; avoid saturated neon.",
      "testid": "data-testid=\"compare-view\""
    },
    "version_history": {
      "pattern": "Timeline list: date header + card items. Use Separator and Badge for version tags.",
      "testid": "data-testid=\"version-history\""
    },
    "chat_wizard": {
      "pattern": "iMessage-like but professional: message bubbles are subtle cards, not bright. Input dock is glass.",
      "components": ["scroll-area", "textarea", "button", "badge", "popover"],
      "classes": {
        "dock": "glass_surface_strong rounded-2xl p-2",
        "bubble_user": "ml-auto max-w-[80%] rounded-2xl bg-[hsl(var(--primary)/0.92)] text-[hsl(var(--primary-foreground))] px-3 py-2",
        "bubble_ai": "mr-auto max-w-[80%] rounded-2xl bg-[hsl(var(--card)/0.75)] border border-[hsl(var(--border)/0.75)] px-3 py-2"
      },
      "testid": "data-testid=\"chat-wizard\""
    },
    "context_menus_popovers": {
      "use": "Use shadcn context-menu + popover + dropdown-menu. Style them as glass_surface with higher blur, tighter padding.",
      "testid": "data-testid=\"agent-row-context-menu\""
    },
    "toasts": {
      "use": "Use Sonner. Toast surfaces should be glass_surface_strong; include action buttons.",
      "testid": "data-testid=\"toast\""
    }
  },
  "motion": {
    "principles": [
      "Motion should feel like macOS: quick, subtle, easing out.",
      "No large bouncy animations in a developer tool."
    ],
    "durations": {
      "fast": "120ms",
      "base": "160ms",
      "slow": "220ms"
    },
    "easing": "cubic-bezier(0.2, 0.8, 0.2, 1)",
    "micro_interactions": [
      "Sidebar items: background tint on hover + 1px inset highlight.",
      "Buttons: opacity hover; press scale handled by App.css active transform.",
      "Dialogs/Popovers: fade+translate-y-1 entrance only (framer-motion optional).",
      "Tabs: active thumb highlight via background change (no sliding animation needed)."
    ],
    "optional_library": {
      "name": "framer-motion",
      "install": "npm i framer-motion",
      "usage": "Use for page transitions + dialog entrance; keep subtle (opacity 0→1 and y 4→0)."
    }
  },
  "accessibility": {
    "rules": [
      "WCAG AA contrast: ensure glass tints still yield readable text; increase opacity in dark mode if needed.",
      "Always show focus-visible ring using --ring.",
      "Respect reduced motion: wrap framer-motion transitions in prefers-reduced-motion checks."
    ],
    "keyboard": [
      "Cmd+K command palette.",
      "Esc closes dialogs/sheets.",
      "Tab order: titlebar actions → sidebar → content."
    ]
  },
  "image_urls": {
    "app_shell_backdrop": [
      {
        "url": "https://images.unsplash.com/photo-1589800906168-d3afaf728a4c?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85",
        "description": "Abstract glassy wallpaper for blurred app background layer (use as fixed background image with low opacity).",
        "category": "background"
      },
      {
        "url": "https://images.unsplash.com/photo-1657894825722-2b46c30a3b3c?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85",
        "description": "Soft geometric pattern for optional alt background in dark mode (very low opacity).",
        "category": "background"
      }
    ],
    "empty_states": [
      {
        "url": "https://images.unsplash.com/photo-1613905366061-2add3248a829?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85",
        "description": "Neutral light/ceiling abstract to blur behind empty state cards (keep subtle).",
        "category": "empty-state"
      }
    ]
  },
  "implementation_notes": {
    "instructions_to_main_agent": [
      "Update /app/frontend/src/index.css: replace Inter import with system font stack; keep IBM Plex Mono only if desired, but SF Mono/Menlo preferred for code.",
      "Add :root tokens for macOS Aqua Light and add .dark (or @media prefers-color-scheme: dark) overrides consistent with shadcn variables.",
      "Create an AppShell layout component: Titlebar (traffic lights + breadcrumbs + toolbar actions) + Sidebar + Content.",
      "Use shadcn Sheet for mobile sidebar; keep desktop sidebar always visible.",
      "Style popovers/context menus/dialogs with glass_surface_strong classes.",
      "Ensure every interactive element and key info element has data-testid in kebab-case.",
      "Do not introduce TSX-only patterns; components are .jsx in this repo."
    ]
  },
  "general_ui_ux_design_guidelines": "<General UI UX Design Guidelines>  \n    - You must **not** apply universal transition. Eg: `transition: all`. This results in breaking transforms. Always add transitions for specific interactive elements like button, input excluding transforms\n    - You must **not** center align the app container, ie do not add `.App { text-align: center; }` in the css file. This disrupts the human natural reading flow of text\n   - NEVER: use AI assistant Emoji characters like`🤖🧠💭💡🔮🎯📚🎭🎬🎪🎉🎊🎁🎀🎂🍰🎈🎨🎰💰💵💳🏦💎🪙💸🤑📊📈📉💹🔢🏆🥇 etc for icons. Always use **FontAwesome cdn** or **lucid-react** library already installed in the package.json\n\n **GRADIENT RESTRICTION RULE**\nNEVER use dark/saturated gradient combos (e.g., purple/pink) on any UI element.  Prohibited gradients: blue-500 to purple 600, purple 500 to pink-500, green-500 to blue-500, red to pink etc\nNEVER use dark gradients for logo, testimonial, footer etc\nNEVER let gradients cover more than 20% of the viewport.\nNEVER apply gradients to text-heavy content or reading areas.\nNEVER use gradients on small UI elements (<100px width).\nNEVER stack multiple gradient layers in the same viewport.\n\n**ENFORCEMENT RULE:**\n    • Id gradient area exceeds 20% of viewport OR affects readability, **THEN** use solid colors\n\n**How and where to use:**\n   • Section backgrounds (not content backgrounds)\n   • Hero section header content. Eg: dark to light to dark color\n   • Decorative overlays and accent elements only\n   • Hero section with 2-3 mild color\n   • Gradients creation can be done for any angle say horizontal, vertical or diagonal\n\n- For AI chat, voice application, **do not use purple color. Use color like light green, ocean blue, peach orange etc**\n\n</Font Guidelines>\n\n- Every interaction needs micro-animations - hover states, transitions, parallax effects, and entrance animations. Static = dead. \n   \n- Use 2-3x more spacing than feels comfortable. Cramped designs look cheap.\n\n- Subtle grain textures, noise overlays, custom cursors, selection states, and loading animations: separates good from extraordinary.\n   \n- Before generating UI, infer the visual style from the problem statement (palette, contrast, mood, motion) and immediately instantiate it by setting global design tokens (primary, secondary/accent, background, foreground, ring, state colors), rather than relying on any library defaults. Don't make the background dark as a default step, always understand problem first and define colors accordingly\n    Eg: - if it implies playful/energetic, choose a colorful scheme\n           - if it implies monochrome/minimal, choose a black–white/neutral scheme\n\n**Component Reuse:**\n\t- Prioritize using pre-existing components from src/components/ui when applicable\n\t- Create new components that match the style and conventions of existing components when needed\n\t- Examine existing components to understand the project's component patterns before creating new ones\n\n**IMPORTANT**: Do not use HTML based component like dropdown, calendar, toast etc. You **MUST** always use `/app/frontend/src/components/ui/ ` only as a primary components as these are modern and stylish component\n\n**Best Practices:**\n\t- Use Shadcn/UI as the primary component library for consistency and accessibility\n\t- Import path: ./components/[component-name]\n\n**Export Conventions:**\n\t- Components MUST use named exports (export const ComponentName = ...)\n\t- Pages MUST use default exports (export default function PageName() {...})\n\n**Toasts:**\n  - Use `sonner` for toasts\"\n  - Sonner component are located in `/app/src/components/ui/sonner.tsx`\n\nUse 2–4 color gradients, subtle textures/noise overlays, or CSS-based noise to avoid flat visuals.\n</General UI UX Design Guidelines>"
}
