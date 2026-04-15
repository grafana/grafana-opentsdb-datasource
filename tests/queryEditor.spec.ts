import { test, expect } from '@grafana/plugin-e2e';
import { Locator, Page } from '@playwright/test';

// Grafana 13 migrated query editor row selectors from aria-label to data-testid
// (https://github.com/grafana/grafana/pull/121784). This helper matches both so tests work across versions
// until @grafana/plugin-e2e ships a fix and this repo upgrades.
function getQueryEditorRow(page: Page, refId: string): Locator {
  return page
    .locator('[data-testid="data-testid Query editor row"], [aria-label="Query editor row"]')
    .filter({
      has: page.locator(
        `[data-testid="data-testid Query editor row title ${refId}"], [aria-label="Query editor row title ${refId}"]`
      ),
    });
}

test.describe('Query editor', () => {
  test('smoke: renders query editor controls', { tag: '@plugins' }, async ({ explorePage, page }) => {
    await explorePage.mockResourceResponse('services', []);
    await explorePage.datasource.set('opentsdb');

    const queryRow = getQueryEditorRow(page, 'A');
    await expect(queryRow.locator('#opentsdb-aggregator-select')).toBeVisible();
  });

  test('should render metric input in query editor', async ({ explorePage, page }) => {
    await explorePage.mockResourceResponse('services', []);
    await explorePage.datasource.set('opentsdb');

    const queryRow = getQueryEditorRow(page, 'A');
    await expect(queryRow.locator('#opentsdb-metric-select')).toBeVisible();
  });
});
