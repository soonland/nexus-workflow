# Feature Spec: Theme Switcher — nexus-erp

**Status:** Draft
**Date:** 2026-03-11
**Scope:** nexus-erp frontend

---

## Problem Statement

The nexus-erp portal currently ships with a single fixed light theme. Users working in different environments (dim offices, night shifts, accessibility needs) have no way to adapt the UI to their preference. For a B2B portal used throughout the workday, theme choice is a baseline UX expectation.

---

## Goals

- Let users choose and persist a display theme.
- Support system-level preference (OS dark mode) out of the box.
- Ensure the theme applies instantly with no flash on page load.
- Persist the preference per user across devices.

---

## Non-Goals

- Custom theme builder or per-organization branding (future scope).
- Themes for printed reports or exports.

---

## Users

All nexus-erp users: employees, managers, HR admins.

---

## Requirements

### Themes Available

| Theme | Description |
|---|---|
| Light | Clean, bright default — high readability in well-lit environments |
| Dark | Low-brightness dark mode — reduces eye strain in dim environments |
| System Default | Follows the OS/browser `prefers-color-scheme` setting automatically |
| Nexus Light Pro | Muted greys and blues — professional portal aesthetic, light base |
| Nexus Dark Pro | Dark slate professional theme — popular in enterprise dashboards |

### Theme Switcher UI

- A theme selector is accessible from the user account menu (top-right avatar/menu).
- Each theme is represented by a colour swatch thumbnail next to its name for at-a-glance identification.
- Selection is immediate — theme applies without a page reload.
- The active theme is highlighted in the selector.

### Persistence

- **localStorage**: Theme applies instantly on page load before React hydration to avoid flash of wrong theme (FOUT).
- **Database**: Preference is saved to the user's profile record and loaded on login, enabling cross-device consistency.
- On first visit (unauthenticated or no saved preference), fall back to `System Default`.

### Implementation

- Each theme is a full MUI `ThemeProvider` configuration (palette override) — no CSS variable layer.
- A blocking inline script in `<head>` reads localStorage and sets the initial theme class before React hydration to eliminate flash of wrong theme.
- On login, the server-side preference overrides localStorage if they differ (server wins).

---

## Success Metrics

- 0 reported "flash of wrong theme" regressions on page load.
- Theme preference survives logout/login on a different device.
- All 5 themes pass WCAG 2.1 AA contrast ratio requirements.

---

## Decisions

| Question | Decision |
|---|---|
| Theme naming | Nexus-branded names: **Nexus Light Pro** and **Nexus Dark Pro** |
| Selector UI | Colour swatch thumbnails next to each theme name |
| MUI approach | Full `ThemeProvider` palette override per theme |

---

## Out of Scope

- Per-tenant/organization forced themes.
- Animated theme transitions.
- Admin-level theme enforcement.
