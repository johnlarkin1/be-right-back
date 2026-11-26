"""Write tokens.json for the design system.

This file is the token map. It holds the values from the desktop styles
(apps/desktop/src/styles) and the website palette (apps/website/src/app/globals.css).
To change a token, edit the source CSS and this file. The drift check at the end
warns when a primitive here no longer matches primitives.css.

Usage: tokens.py <dist dir> <build dir> <git ref> <date>
"""

import json, re, sys, os

out = sys.argv[1]
C = []


def P(prefix, usage, pairs):
    for n, v in pairs:
        C.append({"name": f"primitive-{prefix}{n}", "value": v, "usage": usage})


RAW = "Raw value. Do not use it in components. Use a semantic token that points to it."
P("zinc-", "Retro neutral scale. " + RAW, [
    ("50", "#fafafa"), ("100", "#f4f4f5"), ("200", "#e4e4e7"), ("300", "#d4d4d8"), ("400", "#a1a1aa"),
    ("500", "#71717a"), ("600", "#52525b"), ("700", "#3f3f46"), ("800", "#27272a"), ("900", "#18181b"), ("950", "#09090b")])
P("crt-", "CRT terminal palette. " + RAW, [
    ("bg", "#0a0e0a"), ("bg-light", "#0f150f"), ("green", "#00ff41"),
    ("green-dim", "rgba(0, 255, 65, 0.6)"), ("green-glow", "rgba(0, 255, 65, 0.5)"),
    ("green-subtle", "rgba(0, 255, 65, 0.2)"), ("green-faint", "rgba(0, 255, 65, 0.1)"),
    ("amber", "#ffb000"), ("amber-dim", "rgba(255, 176, 0, 0.6)"), ("amber-subtle", "rgba(255, 176, 0, 0.2)"),
    ("amber-faint", "rgba(255, 176, 0, 0.1)"), ("purple", "#8b00ff"), ("cyan", "rgba(0, 255, 255, 0.5)"),
    ("cyan-solid", "#00ffff"), ("error", "#ff4141")])
P("ghost-", "Ghost mascot palette. " + RAW, [
    ("green", "#00ff41"), ("pink", "#ff69b4"), ("pink-hover", "#ff8dc7"), ("pink-active", "#ffb6d9"),
    ("magenta", "#ff00ff"), ("purple", "#8b5cf6"), ("cyan", "#00ffff"), ("amber", "#ffb000")])
P("slate-", "Modern neutral scale. The source defines no slate-600. " + RAW, [
    ("50", "#f8fafc"), ("100", "#f1f5f9"), ("200", "#e2e8f0"), ("300", "#cbd5e1"), ("400", "#94a3b8"),
    ("500", "#64748b"), ("700", "#334155"), ("800", "#1e293b"), ("900", "#0f172a"), ("950", "#020617")])
P("", "Modern accent. " + RAW, [
    ("emerald-400", "#34d399"), ("emerald-500", "#10b981"), ("emerald-600", "#059669"),
    ("blue-500", "#3b82f6"), ("blue-600", "#2563eb"), ("violet-500", "#8b5cf6"), ("violet-600", "#7c3aed"),
    ("rose-500", "#f43f5e")])
P("", "Insights chart color. " + RAW, [("mint-400", "#3dffbe"), ("sky-400", "#00d4ff")])


WEB = {}
def S(name, retro, modern, usage):
    a = lambda v: v if v.startswith(("#", "rgb", "{")) else "{primitive-" + v + "}"
    v = {"retro": a(retro)}
    if modern is not None: v["modern"] = a(modern)
    elif name in WEB: v["modern"] = a(retro)
    if name in WEB: v["website"] = WEB[name][0]; usage += " Website: " + WEB[name][1]
    C.append({"name": name, "value": v if len(v) > 1 else v["retro"], "usage": usage})

W = "Website palette (apps/website). Use it through a semantic token in the Website theme."
for n, v, u in [("crt-bg", "#0b0f0c", "Website page background."), ("surface", "#10140f", "Website panels and code blocks."),
                ("surface-elevated", "#161b14", "Website raised panels."), ("text-primary", "#ede7d6", "Website headings and strong text."),
                ("text-secondary", "#a8a294", "Website supporting text."), ("text-muted", "#6e685b", "Website faint text. About 3.5:1 on web-crt-bg, below 4.5:1."),
                ("crt-body", "#d8d3c2", "Website article body text."), ("crt-body-muted", "#a8a294", "Website muted article text."),
                ("crt-accent", "#ffb000", "Website lead accent: amber links, labels and borders."), ("crt-accent-soft", "#e8a042", "Website article headings and links."),
                ("crt-text", "#00ff41", "Website terminal green."), ("crt-glow", "rgba(0, 255, 65, 0.3)", "Website green glow."),
                ("crt-purple", "#8b00ff", "Website purple accent."), ("crt-cyan", "rgba(0, 255, 255, 0.5)", "Website cyan accent."),
                ("border-subtle", "rgba(232, 228, 210, 0.08)", "Website hairline borders.")]:
    C.append({"name": "web-" + n, "value": v, "usage": u + " " + W})
WEB.update({
    "color-surface": ("{web-crt-bg}", "page background."),
    "color-surface-elevated": ("{web-surface}", "panels."),
    "color-surface-card": ("{web-surface-elevated}", "raised panels."),
    "color-surface-tooltip": ("{web-surface-elevated}", "tooltips."),
    "color-text-primary": ("{web-text-primary}", "warm off-white."),
    "color-text-secondary": ("{web-text-secondary}", "warm gray."),
    "color-text-muted": ("{web-text-muted}", "about 3.5:1 on the page background, so decorative only."),
    "color-text-accent": ("{web-crt-accent}", "amber."),
    "color-text-accent-secondary": ("{web-crt-text}", "green."),
    "color-accent": ("{web-crt-accent}", "amber leads on the website."),
    "color-accent-dim": ("rgba(255, 176, 0, 0.6)", "from text-crt-accent/60."),
    "color-accent-subtle": ("rgba(255, 176, 0, 0.1)", "from bg-crt-accent/10."),
    "color-accent-secondary": ("{web-crt-text}", "green is the second accent."),
    "color-accent-secondary-dim": ("rgba(0, 255, 65, 0.6)", "from text-crt-text/60."),
    "color-accent-secondary-subtle": ("rgba(0, 255, 65, 0.1)", "from bg-crt-text/10."),
    "color-border": ("{web-border-subtle}", "hairline."),
    "color-border-subtle": ("{web-border-subtle}", "hairline."),
    "color-border-accent": ("rgba(255, 176, 0, 0.3)", "from border-crt-accent/30."),
    "color-border-accent-secondary": ("rgba(0, 255, 65, 0.2)", "from border-crt-text/20."),
    "nav-item-active-bg": ("rgba(255, 176, 0, 0.1)", "amber fill."),
    "nav-item-hover-bg": ("rgba(255, 176, 0, 0.05)", "amber fill."),
    "nav-item-active-text": ("{web-crt-accent}", "amber."),
    "nav-item-inactive-text": ("{web-text-secondary}", "warm gray."),
    "input-text": ("{web-text-primary}", "warm off-white."),
    "input-caret": ("{web-crt-accent}", "amber."),
    "scrollbar-thumb": ("{web-text-muted}", "warm gray."),
})


S("color-surface", "crt-bg", "slate-950", "App background. Also the text color of a text selection.")
S("color-surface-elevated", "crt-bg-light", "slate-900", "Elevated cards, the scrollbar track and the top of the settings modal.")
S("color-surface-overlay", "rgba(0, 0, 0, 0.8)", None, "Backdrop behind modals.")
S("color-surface-card", "rgba(24, 24, 27, 0.4)", "rgba(30, 41, 59, 0.5)", "Default card fill on color-surface.")
S("color-surface-tooltip", "rgba(24, 24, 27, 0.95)", "rgba(15, 23, 42, 0.95)", "Tooltip fill.")
S("color-text-primary", "zinc-50", "slate-50", "Body copy and headings on color-surface, color-surface-elevated and color-surface-card.")
S("color-text-secondary", "zinc-400", "slate-400", "Supporting copy on color-surface and color-surface-elevated.")
S("color-text-muted", "zinc-500", "slate-500", "Hints and the terminal prompt prefix on color-surface. Contrast is about 4.0:1 in retro and 4.3:1 in modern, below 4.5:1. The source value stays exact. Do not use it for text a user must read.")
S("color-text-inverse", "zinc-950", None, "Text on a color-accent fill, for example the primary button.")
S("color-text-accent", "crt-green", "emerald-500", "Accent text on color-surface.")
S("color-text-accent-secondary", "crt-amber", "blue-500", "Second accent text on color-surface.")
S("color-accent", "crt-green", "emerald-500", "Primary accent. Terminal text, active states, focus ring, selection background and primary button fill.")
S("color-accent-dim", "crt-green-dim", "emerald-400", "Inactive tabs, placeholders and hints in retro. Primary button hover in modern.")
S("color-accent-subtle", "crt-green-faint", "rgba(16, 185, 129, 0.1)", "Hover fill for secondary buttons. Toggle and slider track.")
S("color-accent-secondary", "crt-amber", "blue-500", "Second accent. Persona voice, section titles, the enabled toggle thumb and the slider thumb.")
S("color-accent-secondary-dim", "crt-amber-dim", "blue-600", "Dimmed second accent.")
S("color-accent-secondary-subtle", "crt-amber-faint", None, "Faint second accent fill. The modern theme does not override it, so it stays amber there.")
S("color-border", "rgba(39, 39, 42, 0.8)", "rgba(51, 65, 85, 0.5)", "Default border for cards, inputs and the top bar.")
S("color-border-subtle", "rgba(255, 255, 255, 0.08)", "rgba(255, 255, 255, 0.05)", "Dividers and settings section borders. Decorative only.")
S("color-border-accent", "crt-green-subtle", "rgba(16, 185, 129, 0.3)", "Border of secondary buttons, terminal buttons and settings inputs.")
S("color-border-accent-secondary", "crt-amber-subtle", None, "Border for second accent surfaces.")
S("color-border-tooltip", "zinc-700", "slate-700", "Tooltip border.")
S("color-success", "crt-green", "emerald-500", "Success status. Pair it with a word or icon.")
S("color-warning", "crt-amber", "#f59e0b", "Warning status. Pair it with a word or icon.")
S("color-error", "crt-error", "rose-500", "Error status. Pair it with a word or icon.")
S("color-info", "crt-cyan-solid", "blue-500", "Info status.")
for g, u in [("green", "Standard ghost."), ("pink", "Casper, the helper ghost."), ("pink-hover", "Casper hover state."),
             ("pink-active", "Casper pressed state."), ("magenta", "Mischievous ghost."), ("purple", "Accent ghost."),
             ("cyan", "Accent ghost."), ("amber", "Accent ghost.")]:
    S(f"color-ghost-{g}", f"ghost-{g}", None, u + " Fill of the pixel ghost on color-surface.")
S("message-user-bg", "crt-green-faint", "rgba(16, 185, 129, 0.1)", "Fill of the user message bubble.")
S("message-user-border", "crt-green-subtle", "rgba(16, 185, 129, 0.2)", "Border of the user message bubble.")
S("message-user-text", "crt-green", "emerald-400", "Text in the user message bubble, on message-user-bg.")
S("message-persona-bg", "crt-amber-faint", "rgba(59, 130, 246, 0.1)", "Fill of the persona message bubble.")
S("message-persona-border", "crt-amber-subtle", "rgba(59, 130, 246, 0.2)", "Border of the persona message bubble.")
S("message-persona-text", "crt-amber", "blue-500", "Text in the persona message bubble, on message-persona-bg.")
S("nav-item-active-bg", "crt-green-faint", "rgba(16, 185, 129, 0.1)", "Fill of the active navigation item.")
S("nav-item-hover-bg", "rgba(0, 255, 65, 0.05)", "rgba(16, 185, 129, 0.05)", "Fill of a hovered navigation item.")
S("nav-item-active-text", "crt-green", "emerald-500", "Label of the active navigation item.")
S("nav-item-inactive-text", "crt-green-dim", "slate-400", "Label of an inactive navigation item.")
S("input-border", "{color-border}", None, "Input border at rest.")
S("input-focus-border", "{color-accent}", "emerald-500", "Input border on focus. Border of the enabled toggle.")
S("input-text", "crt-green", "slate-50", "Typed text in inputs.")
S("input-caret", "crt-green", "emerald-500", "Input caret.")
S("card-bg", "{color-surface-card}", None, "Fill of the .card pattern.")
S("card-border", "{color-border}", None, "Border of the .card pattern.")
S("topbar-border", "{color-border}", None, "Bottom border of the top bar.")
S("hub-button-color", "ghost-pink", None, "Ghost home button.")
S("hub-button-hover", "ghost-pink-hover", None, "Ghost home button on hover.")
S("hub-button-active", "ghost-pink-active", None, "Ghost home button when pressed.")
S("insights-gradient-start", "mint-400", "emerald-400", "Start of the Insights gradient.")
S("insights-gradient-end", "violet-500", "blue-500", "End of the Insights gradient.")
S("insights-you-color", "crt-green", "emerald-500", "Chart series for your messages.")
S("insights-them-color", "sky-400", "blue-500", "Chart series for the contact's messages.")
S("title-gradient-start", "mint-400", "emerald-400", "Start of the page title gradient.")
S("title-gradient-end", "violet-500", None, "End of the page title gradient.")
S("scrollbar-track", "{color-surface-elevated}", None, "Scrollbar track.")
S("scrollbar-thumb", "crt-green-dim", "slate-700", "Scrollbar thumb.")
S("cursor-color", "crt-green", None, "Blinking terminal cursor. Retro only.")
S("scanline-color", "rgba(0, 0, 0, 0.15)", None, "CRT scanline stripes. Retro only.")
S("phosphor-glow-color", "rgba(0, 255, 65, 0.03)", None, "Center of the CRT phosphor glow. Retro only.")

sp = [("0", "0"), ("px", "1px"), ("0-5", "0.125rem"), ("1", "0.25rem"), ("1-5", "0.375rem"), ("2", "0.5rem"),
      ("2-5", "0.625rem"), ("3", "0.75rem"), ("3-5", "0.875rem"), ("4", "1rem"), ("5", "1.25rem"), ("6", "1.5rem"),
      ("7", "1.75rem"), ("8", "2rem"), ("9", "2.25rem"), ("10", "2.5rem"), ("11", "2.75rem"), ("12", "3rem"),
      ("14", "3.5rem"), ("16", "4rem"), ("20", "5rem"), ("24", "6rem")]
SPU = {"2": "Vertical padding of .btn and tooltips.", "3": "Horizontal padding of tooltips.", "4": "Horizontal padding of .btn."}
spacing = [{"name": f"primitive-space-{n}", "value": v, "usage": SPU.get(n, "Step of the 4px spacing scale.")} for n, v in sp]
spacing += [
    {"name": "space-section", "value": "2rem", "usage": "Gap between page sections. Used by .stack-section."},
    {"name": "space-element", "value": "1rem", "usage": "Gap between elements. Used by .stack and .row."},
    {"name": "space-inline", "value": "0.5rem", "usage": "Gap between inline items, for example an icon and its label."},
    {"name": "space-tight", "value": "0.25rem", "usage": "Tight gap. Used by .stack-tight and .row-tight."}]
radius = [{"name": f"primitive-radius-{n}", "value": v, "usage": u} for n, v, u in [
    ("none", "0", "Square corners."), ("sm", "0.125rem", "Raw step."), ("md", "0.375rem", "Raw step. Inputs."),
    ("lg", "0.5rem", "Raw step. Buttons and settings sections."), ("xl", "0.75rem", "Raw step. Cards."),
    ("2xl", "1rem", "Raw step. Modern modal."), ("3xl", "1.5rem", "Raw step."), ("full", "9999px", "Pills and discs.")]]
radius += [
    {"name": "radius-card", "value": "0.75rem", "usage": "Cards, tooltips and the navigation container. Same in both themes."},
    {"name": "radius-button", "value": "0.5rem", "usage": "Buttons and navigation tabs."},
    {"name": "radius-input", "value": "0.375rem", "usage": "Inputs and selects."},
    {"name": "radius-badge", "value": "9999px", "usage": "Badges and status pills."},
    {"name": "web-radius-sm", "value": "0.375rem", "usage": "Website small corners. The source computes it as --radius minus 4px."},
    {"name": "web-radius-md", "value": "0.5rem", "usage": "Website code blocks and buttons. The source computes it as --radius minus 2px."},
    {"name": "web-radius-lg", "value": "0.625rem", "usage": "Website base radius (--radius)."},
    {"name": "web-radius-xl", "value": "0.875rem", "usage": "Website large panels. The source computes it as --radius plus 4px."},
    {"name": "radius-modal", "value": "0.75rem", "usage": "Modals. The modern theme uses 1rem. The component stylesheet sets that override."}]
G = "rgba(0, 255, 65, "
sh = {
    "primitive-shadow-sm": "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
    "primitive-shadow-md": "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
    "primitive-shadow-lg": "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
    "primitive-shadow-xl": "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
    "primitive-shadow-glow-green": f"0 0 8px {G}0.5)",
    "primitive-shadow-glow-green-strong": f"0 0 4px {G}0.8), 0 0 8px {G}0.6), 0 0 16px {G}0.4)",
    "primitive-shadow-glow-amber": "0 0 8px rgba(255, 176, 0, 0.5)",
    "primitive-shadow-glow-pink": "0 0 8px rgba(255, 105, 180, 0.5)"}
shadow = [{"name": k, "value": v, "usage": "Raw shadow. Use a semantic shadow token."} for k, v in sh.items()]
shadow += [
    {"name": "shadow-card", "value": sh["primitive-shadow-md"], "usage": "Elevated cards and the modern tooltip."},
    {"name": "shadow-elevated", "value": sh["primitive-shadow-lg"], "usage": "Popovers and the modern settings modal."},
    {"name": "shadow-modal", "value": sh["primitive-shadow-xl"], "usage": "Modals."},
    {"name": "shadow-glow", "value": {"retro": sh["primitive-shadow-glow-green"], "modern": "none"}, "usage": "Green glow around retro surfaces. None in modern."},
    {"name": "shadow-glow-strong", "value": sh["primitive-shadow-glow-green-strong"], "usage": "Strong green glow. Retro only. The modern theme does not reset it, so do not use it there."},
    {"name": "box-glow", "value": {"retro": f"0 0 8px {G}0.5), inset 0 0 8px {G}0.1)", "modern": "none"}, "usage": "Focus glow on inputs and the enabled toggle thumb. None in modern."}]
z = [("z-dropdown", "1000", "Dropdown menus."), ("z-sticky", "1100", "Sticky headers."), ("z-fixed", "1200", "Fixed bars. Primitive only."),
     ("z-modal-backdrop", "1300", "Modal backdrop."), ("z-modal", "1400", "Modals."), ("z-popover", "1500", "Popovers. Primitive only."),
     ("z-tooltip", "1600", "Tooltips."), ("z-crt-glow", "9996", "CRT phosphor glow layer."), ("z-crt-vignette", "9997", "CRT vignette layer."),
     ("z-crt-scanlines", "9998", "CRT scanline layer.")]
zi = [{"name": n, "value": v, "usage": u} for n, v, u in z]

BODY = "Your data never leaves your device"
typ = {
    "fonts": [],
    "families": {"vt323": "\"VT323\", monospace", "ibm-plex": "\"IBM Plex Mono\", monospace",
                 "inter": "\"Inter\", system-ui, sans-serif", "geist": "\"Geist Sans\", system-ui, sans-serif",
                 "geist-mono": "\"Geist Mono\", monospace",
                 "jetbrains": "\"JetBrains Mono\", monospace"},
    "groups": [
        {"name": "Retro display", "family": "vt323", "styles": [
            {"name": "settings-modal-title", "fontSize": "20px", "fontWeight": 400, "sample": "Ingestion Settings", "usage": "Modal titles in retro. Add .text-glow."},
            {"name": "topbar-brand", "fontSize": "18px", "fontWeight": 400, "sample": "Be Right Back", "usage": "App name in the retro top bar."},
            {"name": "topbar-tab", "fontSize": "14px", "fontWeight": 400, "sample": "[home] [chat] [insights]", "usage": "Retro navigation tabs and terminal buttons."}]},
        {"name": "Modern UI", "family": "geist", "styles": [
            {"name": "topbar-brand-text", "fontSize": "16px", "fontWeight": 600, "letterSpacing": "-0.01em", "sample": "Be Right Back", "usage": "App name in the modern top bar."},
            {"name": "topbar-tab-modern", "fontSize": "13px", "fontWeight": 500, "sample": "Home  Chat  Insights", "usage": "Modern navigation tabs."}]},
        {"name": "Labels", "family": "ibm-plex", "styles": [
            {"name": "message-body", "fontSize": "14px", "lineHeight": 1.625, "fontWeight": 400, "sample": "> be right back, training my digital twin", "usage": "Message bubble text."},
            {"name": "settings-label", "fontSize": "12px", "fontWeight": 400, "sample": "Embedding batch size", "usage": "Form labels, inputs and settings buttons."},
            {"name": "settings-section-title", "fontSize": "11px", "fontWeight": 500, "letterSpacing": "1px", "sample": "DATE RANGE", "usage": "Section titles. Uppercase in retro. Sentence case at 12px in modern."},
            {"name": "settings-hint", "fontSize": "10px", "fontWeight": 400, "sample": "All processing happens locally on your Mac", "usage": "Hints under form fields."}]},
        {"name": "Website prose", "family": "inter", "styles": [
            {"name": "web-prose-h1", "fontSize": "2rem", "fontWeight": 700, "letterSpacing": "-0.025em", "sample": "How it's built", "usage": "Website article title, in web-crt-accent-soft."},
            {"name": "web-prose-h2", "fontSize": "1.5rem", "fontWeight": 600, "letterSpacing": "-0.015em", "sample": "The ingestion pipeline", "usage": "Website article section heading."},
            {"name": "web-prose-h3", "fontSize": "1.2rem", "fontWeight": 600, "letterSpacing": "-0.01em", "sample": "Vector search", "usage": "Website article subsection heading."},
            {"name": "web-prose-body", "fontSize": "1.0625rem", "lineHeight": 1.7, "fontWeight": 400, "sample": "All processing runs on-device with Apple Silicon.", "usage": "Website article body, in web-crt-body."}]},
        {"name": "Scale", "family": "ibm-plex", "styles": [
            {"name": f"primitive-text-{n}", "fontSize": v, "fontWeight": 400, "sample": BODY, "usage": "Raw size step. The source defines no line height for it."}
            for n, v in [("4xl", "2.25rem"), ("3xl", "1.875rem"), ("2xl", "1.5rem"), ("xl", "1.25rem"), ("lg", "1.125rem"),
                         ("base", "1rem"), ("sm", "0.875rem"), ("xs", "0.75rem")]]}]}

tokens = {
    "name": "Be Right Back", "version": 1,
    "color": {"themes": [{"id": "retro", "name": "Retro"}, {"id": "modern", "name": "Modern"}, {"id": "website", "name": "Website"}], "tokens": C},
    "type": typ, "spacing": {"tokens": spacing}, "radius": {"tokens": radius}, "shadow": {"tokens": shadow},
    "zIndex": {"tokens": zi},
    "meta": {"source": "github", "repo": "johnlarkin1/be-right-back-internal", "ref": sys.argv[3], "package": "apps/desktop",
             "paths": {"tokens": ["src/styles/tokens/primitives.css", "src/styles/tokens/semantic.css", "src/styles/themes/retro.css", "src/styles/themes/modern.css"],
                       "fonts": ["index.html"], "assets": ["public/ghost.svg", "src-tauri/icons/128x128@2x.png"],
                       "docs": ["src/styles/globals.css", "src/styles/utilities/shared.css", "src/styles/utilities/retro.css"],
                       "website": ["../website/src/app/globals.css", "../website/src/app/layout.tsx"]},
             "components": {"Ghost": "src/components/Ghost.tsx", "ModeAwareMascot": "src/components/ModeAwareMascot.tsx", "TopBar": "src/components/TopBar.tsx",
                            "ThemeToggle": "src/components/theme/ThemeToggle.tsx", "Tooltip": "src/components/ui/Tooltip.tsx", "Accordion": "src/components/ui/Accordion.tsx",
                            "StepStatusIcon": "src/components/ui/StepStatusIcon.tsx", "MarkdownRenderer": "src/components/ui/MarkdownRenderer.tsx",
                            "MessageBubble": "src/components/chat/MessageBubble.tsx", "TypingIndicator": "src/components/chat/TypingIndicator.tsx",
                            "ChatInput": "src/components/chat/ChatInput.tsx", "PrivacyBadge": "src/components/home/PrivacyBadge.tsx",
                            "CompactStatsBar": "src/components/home/CompactStatsBar.tsx", "ThinkingBlock": "src/components/casper/ThinkingBlock.tsx",
                            "ToolCallCard": "src/components/casper/ToolCallCard.tsx"},
             "synced": sys.argv[4]}}
names = [t["name"] for fam in (C, spacing, radius, shadow, zi) for t in fam]
assert len(names) == len(set(names)), [n for n in names if names.count(n) > 1]
os.makedirs(out + "/project", exist_ok=True)
json.dump(tokens, open(out + "/project/tokens.json", "w"), indent=1)
json.dump(names, open(sys.argv[2] + "/names.json", "w"))

# test-only tokens.css (never published)
def cv(v): return re.sub(r"\{([^}]+)\}", r"var(--\1)", v)
blocks = {"retro": [], "modern": [], "website": []}
for t in C + shadow:
    v = t["value"]
    if isinstance(v, str): blocks["retro"].append(f"--{t['name']}:{cv(v)};")
    else:
        for k in v: blocks[k].append(f"--{t['name']}:{cv(v[k])};")
css = ":root,[data-theme=retro]{" + "".join(blocks["retro"]) + "}\n" + "".join(f"[data-theme={k}]{{" + "".join(blocks[k]) + "}\n" for k in ("modern", "website")) + ":root{"
css += "".join(f"--{t['name']}:{t['value']};" for t in spacing + radius + zi)
css += "".join(f"--font-{k}:{v};" for k, v in typ["families"].items()) + "}\n"
open(sys.argv[2] + "/tokens.css", "w").write(css)
print(len(C), "colors", len(names), "token names")

# Drift check: compare the primitives above with apps/desktop/src/styles/tokens/primitives.css.
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
src = open(os.path.join(root, "apps/desktop/src/styles/tokens/primitives.css")).read()
css_vals = {m[0]: " ".join(m[1].split()) for m in re.findall(r"--(primitive-[a-z0-9-]+):\s*([^;]+);", src)}
mine = {t["name"]: t["value"] for fam in (C, spacing, radius) for t in fam if t["name"].startswith("primitive-")}
drift = [f"  {n}: CSS has {css_vals[n]}, tokens.py has {v}" for n, v in mine.items() if n in css_vals and css_vals[n] != v]
gone = [f"  {n}: not in primitives.css" for n in mine if n not in css_vals]
new = [f"  {n}: in primitives.css, not in tokens.py" for n in css_vals
       if n not in mine and re.match(r"primitive-(zinc|crt|ghost|slate|emerald|blue|violet|rose|mint|sky|space|radius)-", n)]
if drift or gone or new:
    print("WARNING: tokens.py differs from primitives.css:\n" + "\n".join(drift + gone + new))

