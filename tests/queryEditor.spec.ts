import { test, expect } from '@grafana/plugin-e2e';
import { type Locator, type Page } from '@playwright/test';

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

// Use explorePage (not panelEditPage): panelEditPage runs DashboardPage.addPanel(), which relies on
// toolbar "Add" selectors that broke on Grafana 13; Explore avoids that path (see grafana-zipkin-datasource tests).
test.describe('Query editor', () => {
  test('smoke: should render query editor', async ({ explorePage, readProvisionedDataSource, page }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    await explorePage.datasource.set(ds.name);

    const queryRow = getQueryEditorRow(page, 'A');
    await expect(queryRow.locator('#opentsdb-aggregator-select')).toBeVisible();
  });

  test('should render metric input in query editor', async ({ explorePage, readProvisionedDataSource, page }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    await explorePage.datasource.set(ds.name);

    const queryRow = getQueryEditorRow(page, 'A');
    await expect(queryRow.locator('#opentsdb-metric-select')).toBeVisible();
  });
});
