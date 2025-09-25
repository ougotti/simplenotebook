# Testing Documentation

This document describes how to run and maintain tests for the SimpleNotebook application.

## Test Structure

### Unit Tests
Located in `tests/unit/`, these test individual functions and modules:

- **Config Tests (`config.test.ts`)**: Tests the `isLocalMode` function and configuration detection logic
- **API Tests (`api.test.ts`)**: Tests the API client class including CRUD operations, authentication, and error handling

### E2E Tests
Located in `tests/e2e/`, these test the full application flow:

- **App Tests (`app.spec.ts`)**: Core functionality including note creation, Japanese text handling, localStorage persistence
- **Auth Tests (`auth.spec.ts`)**: Authentication flows, error handling, and OAuth callback processing

## Running Tests

### Prerequisites
```bash
npm install
```

### Unit Tests
```bash
# Run all unit tests
npm test

# Run unit tests in watch mode
npm run test:watch

# Run unit tests with coverage
npm test -- --coverage
```

### E2E Tests
```bash
# Install Playwright browsers (first time only)
npx playwright install

# Run all E2E tests
npm run test:e2e

# Run E2E tests with UI mode (interactive)
npm run test:e2e:ui

# Run specific test file
npx playwright test tests/e2e/app.spec.ts
```

### All Tests
```bash
# Run both unit and E2E tests
npm run test:all
```

## Test Configuration

### Jest (Unit Tests)
- Configuration: `jest.config.js`
- Setup file: `jest.setup.js`
- Environment: `jsdom` for DOM simulation
- Includes Next.js integration for proper module resolution

### Playwright (E2E Tests)
- Configuration: `playwright.config.ts`
- Supports multiple browsers: Chromium, Firefox, WebKit
- Japanese locale and font support configured
- Automatic web server startup for testing

## Testing Strategy

### Local Mode Testing
The tests are designed to work in "local mode" where:

1. The application uses placeholder configuration values
2. Authentication is automatically mocked with a fake user
3. API calls are expected to fail gracefully
4. LocalStorage persistence works normally

This allows tests to run reliably without requiring real AWS infrastructure.

### What We Test

#### Unit Level:
- Configuration parsing and local mode detection
- API client HTTP request construction
- Error handling and response parsing
- Authentication header management

#### E2E Level:
- Page navigation and routing
- Form interactions and validation
- Japanese text input and display
- LocalStorage persistence across page reloads
- OAuth callback parameter handling
- Error message display
- Loading states and transitions

## Test Data

### Sample Japanese Text
Tests include various Japanese text patterns:
- Hiragana: こんにちは
- Katakana: カタカナ
- Kanji: 日本語
- Mixed: 日本語のテキストです
- Emoji: 🎌

### Mock Data
- User: `local@example.com` (LOCAL_USER)
- API Endpoints: `https://test.execute-api.ap-northeast-1.amazonaws.com/prod`
- Notes: Various title/content combinations for testing CRUD operations

## Troubleshooting

### Unit Test Issues
- **Import errors**: Check `jest.config.js` module name mapping
- **Fetch not available**: Ensure `whatwg-fetch` polyfill is loaded in `jest.setup.js`
- **Mock issues**: Clear mocks between tests with `jest.clearAllMocks()`

### E2E Test Issues
- **Browser installation**: Run `npx playwright install` 
- **Server not starting**: Check if port 3000 is available
- **Asset loading errors**: Expected in preview mode due to base path configuration
- **Japanese text rendering**: Ensure Japanese fonts are installed in CI environment

### Development Server vs Preview
- **Development** (`npm run dev`): Access at `http://localhost:3000/simplenotebook`
- **Preview** (`npm run preview`): Access at `http://localhost:3000` (no base path)

The E2E tests are configured to use the preview server for consistency with production builds.

## CI/CD Integration

The tests are ready for CI integration. Add to your workflow:

```yaml
- name: Run unit tests
  run: npm test

- name: Install Playwright browsers
  run: npx playwright install --with-deps

- name: Run E2E tests
  run: npm run test:e2e
```

## Coverage Reports

Jest generates coverage reports in `coverage/` directory. Key metrics:
- Statements: Function and statement coverage
- Branches: Conditional path coverage  
- Functions: Function execution coverage
- Lines: Line-by-line coverage

Target coverage levels:
- **Utilities/Config**: >90% (simple, predictable functions)
- **API Client**: >80% (complex error handling scenarios)
- **E2E Coverage**: Functional coverage of user workflows

## Maintenance

### Adding New Tests
1. **Unit tests**: Add to appropriate `tests/unit/*.test.ts` file
2. **E2E tests**: Add to appropriate `tests/e2e/*.spec.ts` file
3. Follow existing patterns for mocking and assertions
4. Update this documentation for new test categories

### Test Data Updates
When application features change:
1. Update mock responses in unit tests
2. Update selector patterns in E2E tests
3. Add new test cases for new functionality
4. Verify Japanese text handling for international features

The test suite provides comprehensive coverage while maintaining independence from external services, making it reliable for continuous integration and local development.