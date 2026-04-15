import { expect, test } from '@grafana/plugin-e2e';

test.describe('Query editor', () => {
  test(
    'smoke: renders query editor controls',
    { tag: '@plugins' },
    async ({ explorePage, page, readProvisionedDataSource }) => {
      const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
      await explorePage.datasource.set(ds.name);

      // MetricSection root — stable across Explore vs panel edit and avoids panelEditPage, which still
      // targets the old toolbar "Add button" while empty dashboard scenes use CanvasGridAddActions.
      await expect(page.getByTestId('opentsdb-metricsection')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('#opentsdb-aggregator-select')).toBeVisible();
      await expect(page.locator('#opentsdb-metric-select')).toBeVisible();
    }
  );
});
