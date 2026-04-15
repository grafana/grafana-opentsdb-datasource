import { test, expect } from '@grafana/plugin-e2e';
import { type Locator, type Page } from '@playwright/test';

// DataSourceHttpSettings exposes the connection URL field under different accessible
// names across Grafana versions (e.g. "URL" vs "Data source connection URL"), similar
// to the aria-label / data-testid split addressed for the query editor in Grafana 13.
function dataSourceConnectionUrlInput(page: Page): Locator {
  return page.getByRole('textbox', { name: 'URL' }).or(page.getByLabel('Data source connection URL'));
}

test('smoke: should render config editor', async ({ createDataSourceConfigPage, readProvisionedDataSource, page }) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await createDataSourceConfigPage({ type: ds.type });
  await expect(dataSourceConnectionUrlInput(page)).toBeVisible();
  const settingsSection = page.getByText('OpenTSDB settings');
  await settingsSection.scrollIntoViewIfNeeded();
  await expect(settingsSection).toBeVisible();
});

test('"Save & test" should be successful when configuration is valid', async ({
  createDataSourceConfigPage,
  readProvisionedDataSource,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  const configPage = await createDataSourceConfigPage({ type: ds.type });
  await dataSourceConnectionUrlInput(page).fill(ds.url ?? 'http://opentsdb:4242');
  await expect(configPage.saveAndTest()).toBeOK();
});