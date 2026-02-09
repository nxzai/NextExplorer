# Backend Test Suites

This project uses the modern **Vitest + Supertest** stack for testing Express.js applications, following 2025 best practices.

## Tech Stack

- **Test Runner:** [Vitest](https://vitest.dev/) - Blazing fast, Vite-powered, Jest-compatible
- **API Testing:** [Supertest](https://github.com/ladjs/supertest) - HTTP assertions for Express
- **Assertions:** Vitest's built-in `expect()` matchers

## Layout

- `routes/` — endpoint-level suites that mount Express routers and exercise HTTP flows (auth, features, shares, etc.)
- `services/` — business logic, storage, and configuration helpers (users, settings, access control, etc.)
- `utils/` — low-level utilities such as `pathUtils` that enforce safe file operations and normalization
- `helpers/` — shared fixtures or helpers (e.g., `env-test-utils`) used across suites

Keep file names aligned with the code under test (e.g., `services/settings.test.js` targets `src/services/settingsService.js`).

## Running the Suite

```sh
cd backend
npm test           # Run all tests once
npm run test:watch # Watch mode - re-runs on file changes
npm run test:ui    # Open Vitest UI in browser
npm run test:coverage # Run with coverage report
```

## Writing a New Test

### Basic Structure

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setupTestEnv } from '../helpers/env-test-utils.js';

describe('My Feature', () => {
  let envContext;

  beforeAll(async () => {
    envContext = await setupTestEnv({
      tag: 'my-feature-test-',
      modules: ['src/services/myService'],
    });
  });

  afterAll(async () => {
    await envContext.cleanup();
  });

  it('should do something', async () => {
    const myService = envContext.requireFresh('src/services/myService');
    const result = await myService.doSomething();
    expect(result).toBe('expected');
  });
});
```

### Testing Routes with Supertest

```javascript
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

const buildApp = () => {
  const myRouter = require('../../src/routes/myRouter');
  const app = express();
  app.use(express.json());
  app.use('/api', myRouter);
  return app;
};

describe('GET /api/items', () => {
  it('should return items', async () => {
    const app = buildApp();
    const response = await request(app).get('/api/items');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
  });
});
```

## Test Helpers

### `setupTestEnv(options)`

Creates an isolated test environment with:
- Temporary directories for config, cache, and volume
- Environment variable overrides
- Module cache management for fresh requires

```javascript
const envContext = await setupTestEnv({
  tag: 'my-test-',           // Prefix for temp directory
  modules: ['src/services/db'], // Modules to clear from cache
  env: { MY_VAR: 'value' },     // Additional env vars
});

// Use envContext.requireFresh() for clean module imports
const db = envContext.requireFresh('src/services/db');

// Always cleanup after tests
await envContext.cleanup();
```

### `clearModuleCache(modulePath)`

Clears a specific module from Node's require cache, allowing fresh imports.

### `overrideEnv(values)`

Temporarily overrides environment variables and returns a restore function.

```javascript
const restore = overrideEnv({ NODE_ENV: 'test' });
// ... run tests ...
restore(); // Restore original values
```

## Architecture: App/Server Separation

The codebase follows the "Golden Rule" for Express testing:

- `src/app.js` - Exports `createApp()` function that configures middleware and routes
- `src/server.js` - Imports app and calls `app.listen()` (entry point for production)

This separation allows tests to import the app without starting a real server:

```javascript
import { createApp } from '../../src/app.js';

const app = await createApp({
  skipBootstrap: true,
  skipOidc: true,
});
```

## Coverage

Run coverage report:

```sh
npm run test:coverage
```

Coverage reports are generated in:
- `coverage/` - HTML report (open `coverage/index.html`)
- Terminal output with summary
