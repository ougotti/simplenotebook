# Simplenotebook

Simplenotebook is a Next.js web application for creating and editing markdown notes. It generates a static site deployed to GitHub Pages with automatic GitHub Actions workflow deployment.

**ALWAYS reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.**

## Working Effectively

### Bootstrap and Setup
- Install dependencies: `npm install` -- takes ~51 seconds. NEVER CANCEL. Set timeout to 90+ seconds.
- The repository requires Node.js v20+ and npm v10+
- No additional system dependencies or setup scripts required

### Development
- Start development server: `npm run dev` -- starts in ~2 seconds, serves at http://localhost:3000/simplenotebook
- **CRITICAL**: The app uses basePath `/simplenotebook` for GitHub Pages compatibility. Access the app at `http://localhost:3000/simplenotebook`, NOT `http://localhost:3000`
- The development server supports hot reload and fast refresh

### Building and Static Export
- Build for production: `npm run build` -- takes ~18 seconds. NEVER CANCEL. Set timeout to 60+ seconds.
- The build generates a static site in the `out/` directory
- Uses Next.js 14 static export with `output: 'export'` configuration
- **NOTE**: `npm run start` does NOT work with static export configuration - use `npm run preview` instead

### Preview Production Build
- Preview built site: `npm run preview` -- uses `npx serve out`, serves at http://localhost:3000
- **IMPORTANT**: Access preview at `http://localhost:3000` (NOT `/simplenotebook` like dev server)
- The serve package will be automatically installed on first run
- **NOTE**: You may see asset loading errors in browser console - this is expected as the build is optimized for GitHub Pages with basePath

### Linting and Code Quality
- Run linting: `npm run lint` -- takes ~2 seconds, uses ESLint with Next.js config
- ALWAYS run `npm run lint` before committing changes - CI will fail if linting errors exist
- No separate formatting tools configured - ESLint handles code quality

## Validation Scenarios

### Manual Testing Requirements
After making changes, ALWAYS test these scenarios:

1. **Note Creation Flow**:
   - Navigate to `http://localhost:3000/simplenotebook`
   - Enter markdown text in the textarea (e.g., `# Test\n\n**Bold text**`)
   - Click "保存" button
   - Verify success message "保存しました（ローカル保存）" appears
   - Verify content persists after page refresh (uses localStorage)

2. **App Router Route**:
   - Navigate to `http://localhost:3000/simplenotebook/notes/new`
   - Verify the same note creation interface appears

3. **Build Validation**:
   - Run `npm run build` and verify no errors
   - Check `out/` directory contains: `index.html`, `notes/new.html`, `_next/` assets
   - Run `npm run preview` and test both routes in production build: `/` and `/notes/new`
   - **NOTE**: Asset loading errors in browser console are expected in preview

## Project Structure

### Key Directories and Files
```
/home/runner/work/simplenotebook/simplenotebook/
├── app/                      # App Router pages (Next.js 13+)
│   ├── layout.tsx           # Root layout with HTML structure
│   └── notes/new/page.tsx   # /notes/new route component
├── pages/                   # Pages Router (legacy, still active)
│   ├── _app.tsx             # App wrapper
│   └── index.tsx            # Root route component
├── styles/globals.css       # Global Tailwind CSS imports
├── public/                  # Static assets (favicon, images)
├── .github/workflows/       # GitHub Actions for deployment
├── next.config.js           # Next.js config with static export + basePath
├── tailwind.config.js       # Tailwind CSS configuration
├── tsconfig.json            # TypeScript configuration
└── package.json             # Dependencies and scripts
```

### Architecture Notes
- **Dual Router Setup**: Uses both Pages Router (`pages/`) and App Router (`app/`) - both are functional
- **Static Export**: Configured for GitHub Pages with `output: 'export'` and `basePath: '/simplenotebook'`
- **Styling**: Tailwind CSS with PostCSS processing
- **State Management**: Uses localStorage for note persistence (client-side only)
- **Deployment**: Automatic deployment via GitHub Actions to GitHub Pages on main branch push

## Build and CI Information

### GitHub Actions Workflow
- **File**: `.github/workflows/nextjs.yml`
- **Trigger**: Push to `main` branch
- **Process**: `npm ci` → `next build` → Deploy `out/` to GitHub Pages
- **Node Version**: 20 (specified in workflow)
- **CRITICAL**: Build timeout in CI is sufficient - builds complete in ~18 seconds

### Dependencies
- **Runtime**: Next.js 14.2.30, React 18.2.0
- **Development**: TypeScript 5.2.2, ESLint 8.38.0, Tailwind CSS 3.4.1
- **Security**: `npm audit` shows 0 vulnerabilities as of validation

## Common Commands Reference

### Quick Command Summary
```bash
npm install          # ~51s - Install dependencies
npm run dev          # ~2s - Start development (http://localhost:3000/simplenotebook)
npm run build        # ~18s - Build static site to out/
npm run preview      # Start preview server (http://localhost:3000)
npm run lint         # ~2s - Run ESLint validation
```

### Timing Expectations (NEVER CANCEL)
- `npm install`: 51 seconds - Set timeout to 90+ seconds
- `npm run build`: 18 seconds - Set timeout to 60+ seconds  
- `npm run dev`: 2 seconds startup - Set timeout to 30+ seconds
- `npm run lint`: 2 seconds - Set timeout to 30+ seconds
- `npm run preview`: 5-10 seconds for serve install - Set timeout to 60+ seconds

## Troubleshooting

### Common Issues
1. **404 on localhost:3000**: Access `http://localhost:3000/simplenotebook` instead (dev mode only)
2. **npm start fails**: Use `npm run preview` for production testing (static export doesn't support server)
3. **Missing serve package**: `npm run preview` auto-installs serve via npx on first run
4. **ESLint version warnings**: These are expected and don't affect functionality
5. **Asset loading errors in preview**: Expected in preview mode due to GitHub Pages basePath optimization

### File Locations for Quick Access
- **Main Components**: `pages/index.tsx` and `app/notes/new/page.tsx`
- **Styling**: `styles/globals.css` (Tailwind imports)
- **Configuration**: `next.config.js` (basePath), `tailwind.config.js` (CSS config)
- **CI/CD**: `.github/workflows/nextjs.yml` (deployment workflow)

### Development Tips
- Both route systems work: Pages Router serves `/` and App Router serves `/notes/new`
- localStorage key used: `new-note-content` for persistence
- Tailwind classes are available throughout the app
- TypeScript strict mode is enabled
- Fast Refresh works in development mode