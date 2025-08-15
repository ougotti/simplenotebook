# Japanese Font Support Documentation

This document describes the Japanese font support setup for the SimpleNotebook project.

## Overview

The project has been configured to properly render Japanese text in both development and production environments, including Copilot (GitHub Actions) environments. This prevents Japanese characters from appearing as garbled text (tofu) when using browsers or testing tools like Playwright.

## Font Packages Installed

In the GitHub Actions workflow, the following font packages are installed:

- **fonts-noto-cjk**: Comprehensive CJK (Chinese, Japanese, Korean) font support
- **fonts-noto-color-emoji**: Color emoji support
- **fonts-liberation**: Liberation fonts for better Latin character rendering

## Implementation Details

### Copilot Environment Setup

The project provides a dedicated workflow (`.github/workflows/copilot-setup-steps.yml`) and composite action (`.github/actions/setup-japanese-fonts/action.yml`) for setting up Japanese fonts in GitHub Actions environments:

**Composite Action Usage:**
```yaml
- name: Setup Japanese fonts
  uses: ./.github/actions/setup-japanese-fonts
```

**Standalone Workflow:**
The `copilot-setup-steps.yml` workflow can be called by other workflows or run manually to set up the Copilot environment with Japanese font support.

### GitHub Actions Font Installation

The main deployment workflow (`.github/workflows/nextjs.yml`) uses the composite action for font installation in both the `deploy-aws` and `build` jobs:

```yaml
- name: Setup Japanese fonts
  uses: ./.github/actions/setup-japanese-fonts
```

### Playwright Configuration

The project includes a Playwright configuration (`playwright.config.ts`) optimized for Japanese text rendering:

- Japanese locale settings (`ja-JP`)
- Font rendering optimizations
- Browser launch options for proper font handling

## Local Development

For local development, ensure your system has Japanese fonts installed:

**Ubuntu/Debian:**
```bash
sudo apt-get install fonts-noto-cjk fonts-noto-color-emoji
sudo fc-cache -fv
```

**macOS:**
Japanese fonts are typically included by default.

**Windows:**
Japanese fonts are typically included by default.

## Usage

### Verifying Font Support

The application uses Japanese text throughout the interface:

- ノートのタイトル (Note title)
- 新規ノート (New note)
- 保存されたノート (Saved notes)
- 保存中... (Saving...)
- サインアウト (Sign out)

All of these should render correctly with proper font support.

## Troubleshooting

### Garbled Text Issues

If you see garbled text (tofu characters):

1. Verify font packages are installed
2. Clear browser cache
3. Check system font configuration
4. Restart the development server

### Playwright Issues

If Playwright tests fail due to font rendering:

1. Ensure system fonts are installed
2. Check the Playwright configuration
3. Verify browser installation: `npx playwright install`

## Technical Notes

- The font installation is performed early in both CI jobs to ensure fonts are available during all build and test phases
- Font cache is refreshed after installation to ensure immediate availability
- The configuration supports both development (localhost:3000/simplenotebook) and production (GitHub Pages) environments