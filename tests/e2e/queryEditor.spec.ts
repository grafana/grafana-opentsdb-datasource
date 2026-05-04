/// <reference types="node" />
import { expect, test } from '@grafana/plugin-e2e';
import { type Locator, type Page, type Response } from '@playwright/test';

import { OpenTsdbOptions } from '../../src/types';

const DS_NAME = process.env.DS_INSTANCE_NAME || 'opentsdb';
const PROVISIONED_FILE = 'datasources.yml';

// OpenTSDB only retains data within its retention window, so the loader writes
// fixture points relative to "now" (1 hour worth at 60 s spacing). Compute the
// query window once at module load so every test in this run uses the same
// range. A 2 h lookback comfortably contains the just-loaded fixtures.
const DYNAMIC_TO_ISO = new Date().toISOString();
const DYNAMIC_FROM_ISO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

// Grafana 13 migrated query editor row selectors from aria-label to data-testid
// (https://github.com/grafana/grafana/pull/121784). This helper matches both
// shapes so tests work across versions until @grafana/plugin-e2e ships a fix
// and this repo upgrades.
function getQueryEditorRow(page: Page, refId: string): Locator {
  return page
    .locator('[data-testid="data-testid Query editor row"], [aria-label="Query editor row"]')
    .filter({
      has: page.locator(
        `[data-testid="data-testid Query editor row title ${refId}"], [aria-label="Query editor row title ${refId}"]`
      ),
    });
}

// Builds an Explore URL with an OpenTSDB metric query pre-encoded in the panes
// parameter. Uses the computed ISO timestamps so the query lands within the
// loaded fixture window.
function exploreUrl(dsUid: string, metric: string, extra: Record<string, unknown> = {}): string {
  const panes = JSON.stringify({
    explore: {
      datasource: dsUid,
      queries: [
        {
          refId: 'A',
          metric,
          aggregator: 'sum',
          datasource: { type: 'opentsdb', uid: dsUid },
          ...extra,
        },
      ],
      range: { from: DYNAMIC_FROM_ISO, to: DYNAMIC_TO_ISO },
    },
  });
  return `/explore?orgId=1&schemaVersion=1&panes=${encodeURIComponent(panes)}`;
}

// Waits for the first /api/ds/query response where results.A has frames.
// response.json() must be called inside the predicate while the CDP body
// reference is still valid; calling it after the await fails intermittently
// with "No resource with given identifier found".
async function waitForMainQueryResponse(page: Page): Promise<{ response: Response; body: any }> {
  let body: any;
  const response = await page.waitForResponse(async (r: Response) => {
    if (!r.url().includes('/api/ds/query') || !r.ok()) {
      return false;
    }
    const b = await r.json().catch(() => null);
    if (!Array.isArray(b?.results?.A?.frames)) {
      return false;
    }
    body = b;
    return true;
  });
  return { response, body };
}

test.describe('Query editor', () => {
  test.beforeEach(async ({ explorePage }) => {
    // explorePage.goto() is called by the fixture before this hook runs.
    // OpenTSDB is provisioned as the default; datasource.set() confirms the
    // selection without firing a new query (Grafana treats it as a no-op when
    // unchanged).
    await explorePage.datasource.set(DS_NAME);
  });

  test.describe('rendering', () => {
    test(
      'smoke: renders metric and aggregator selects',
      { tag: '@plugins' },
      async ({ explorePage, page }) => {
        // Suggest endpoints fire on mount via the OpenTSDB resource API. Mock
        // them so the smoke test does not depend on a healthy backend.
        await explorePage.mockResourceResponse('suggest?type=metrics&max=1000', []);
        await explorePage.mockResourceResponse('aggregators', []);
        await explorePage.mockResourceResponse('config/filters', []);

        await expect(page.getByTestId('opentsdb-editor')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('opentsdb-metricsection')).toBeVisible();
        await expect(page.locator('#opentsdb-metric-select')).toBeVisible();
        await expect(page.locator('#opentsdb-aggregator-select')).toBeVisible();
      }
    );

    test('renders all query sections', async ({ explorePage, page }) => {
      await explorePage.mockResourceResponse('suggest?type=metrics&max=1000', []);
      await explorePage.mockResourceResponse('aggregators', []);
      await explorePage.mockResourceResponse('config/filters', []);

      const queryRow = getQueryEditorRow(page, 'A');
      await expect(queryRow.getByTestId('opentsdb-metricsection')).toBeVisible();
      await expect(queryRow.getByTestId('opentsdb-downsample')).toBeVisible();
      // FilterSection renders for tsdbVersion >= 2; the provisioned datasource
      // is configured with tsdbVersion: 3 (OpenTSDB 2.3.x).
      await expect(queryRow.getByTestId('opentsdb-filter')).toBeVisible();
      await expect(queryRow.getByTestId('opentsdb-tag')).toBeVisible();
      await expect(queryRow.getByTestId('opentsdb-rate')).toBeVisible();
    });

    test('shows alias input', async ({ explorePage, page }) => {
      await explorePage.mockResourceResponse('suggest?type=metrics&max=1000', []);
      await explorePage.mockResourceResponse('aggregators', []);
      await explorePage.mockResourceResponse('config/filters', []);

      await expect(page.getByTestId('metric-alias')).toBeVisible();
    });
  });

  test.describe('rate section', () => {
    test('toggling Rate reveals Counter switch', async ({ explorePage, page }) => {
      await explorePage.mockResourceResponse('suggest?type=metrics&max=1000', []);
      await explorePage.mockResourceResponse('aggregators', []);
      await explorePage.mockResourceResponse('config/filters', []);

      // Grafana's InlineSwitch hides the underlying <input> behind its <label>,
      // so a normal click on the input is intercepted by the label. Use force
      // (or setChecked) to toggle the underlying switch directly.
      const rateSwitch = page.getByTestId('opentsdb-shouldComputeRate');
      await rateSwitch.click({ force: true });
      await expect(page.getByTestId('opentsdb-is-counter')).toBeVisible();
    });
  });

  test.describe('query execution', () => {
    test('executes a metric query and receives OK response', async ({
      explorePage,
      page,
      readProvisionedDataSource,
    }) => {
      const ds = await readProvisionedDataSource<OpenTsdbOptions>({ fileName: PROVISIONED_FILE });

      await explorePage.mockQueryDataResponse({ results: { A: { frames: [] } } });
      await explorePage.mockResourceResponse('suggest?type=metrics&max=1000', []);
      await explorePage.mockResourceResponse('aggregators', []);
      await explorePage.mockResourceResponse('config/filters', []);

      const responsePromise = page.waitForResponse((resp) => resp.url().includes('/api/ds/query'));
      await page.goto(exploreUrl(ds.uid, 'cpu.usage'));

      const response = await responsePromise;
      expect(response.ok()).toBe(true);
    });
  });
});

// These tests use real fixture data loaded by the opentsdb-loader service in
// docker-compose.yaml. Each navigates to an Explore URL with a known metric
// name pre-encoded in the panes parameter and asserts on the response shape.
//
// The metric names match what's in the cloud-hosted OpenTSDB instance so the
// same tests pass against both the local docker-compose DB and the Cloud DB.
test.describe('Query editor with fixture data', () => {
  // Serialize fixture-data tests so they don't compete for the shared OpenTSDB
  // instance and produce slow responses that look like failures.
  test.describe.configure({ mode: 'serial' });

  test.describe('cpu.usage', () => {
    test('returns frames for the cpu metric', async ({ page, readProvisionedDataSource }) => {
      const ds = await readProvisionedDataSource<OpenTsdbOptions>({ fileName: PROVISIONED_FILE });
      const responsePromise = waitForMainQueryResponse(page);
      await page.goto(exploreUrl(ds.uid, 'cpu.usage'));
      const { response, body } = await responsePromise;
      expect(response.ok()).toBe(true);
      expect(body.results?.A?.error).toBeUndefined();
      expect(body.results?.A?.frames?.length).toBeGreaterThan(0);
    });
  });

  test.describe('memory.usage_bytes', () => {
    test('returns frames for the memory metric', async ({ page, readProvisionedDataSource }) => {
      const ds = await readProvisionedDataSource<OpenTsdbOptions>({ fileName: PROVISIONED_FILE });
      const responsePromise = waitForMainQueryResponse(page);
      await page.goto(exploreUrl(ds.uid, 'memory.usage_bytes'));
      const { response, body } = await responsePromise;
      expect(response.ok()).toBe(true);
      expect(body.results?.A?.error).toBeUndefined();
      expect(body.results?.A?.frames?.length).toBeGreaterThan(0);
    });
  });

  test.describe('aggregator switch', () => {
    test('avg aggregator returns frames', async ({ page, readProvisionedDataSource }) => {
      const ds = await readProvisionedDataSource<OpenTsdbOptions>({ fileName: PROVISIONED_FILE });
      const responsePromise = waitForMainQueryResponse(page);
      await page.goto(exploreUrl(ds.uid, 'cpu.usage', { aggregator: 'avg' }));
      const { response, body } = await responsePromise;
      expect(response.ok()).toBe(true);
      expect(body.results?.A?.error).toBeUndefined();
      expect(body.results?.A?.frames?.length).toBeGreaterThan(0);
    });
  });
});
