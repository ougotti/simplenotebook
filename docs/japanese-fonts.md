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

### GitHub Actions Font Installation

The workflow (`.github/workflows/nextjs.yml`) includes font installation steps for both the `deploy-aws` and `build` jobs:

```yaml
- name: Install Japanese fonts
  run: |
    sudo apt-get update
    sudo apt-get install -y fonts-noto-cjk fonts-noto-color-emoji fonts-liberation
    # Refresh font cache
    sudo fc-cache -fv
```

### Playwright Configuration

The project includes a Playwright configuration (`playwright.config.ts`) optimized for Japanese text rendering:

- Japanese locale settings (`ja-JP`)
- Font rendering optimizations
- Browser launch options for proper font handling

### Testing

A test suite (`tests/japanese-fonts.spec.ts`) verifies that:
- Japanese UI text displays correctly
- Japanese input works properly
- Date formatting in Japanese is handled correctly

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

### Running Tests

To run the Japanese font rendering tests:

```bash
# Install Playwright browsers (one-time setup)
npx playwright install

# Run end-to-end tests
npm run test:e2e

# Run tests with UI mode
npm run test:e2e:ui
```

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