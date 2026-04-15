import { test, expect } from '@grafana/plugin-e2e';
import { type Locator, type Page } from '@playwright/test';

// Grafana 13 migrated multiple UI surfaces from aria-label to data-testid
// (https://github.com/grafana/grafana/pull/121784). Helpers match both shapes where applicable,
// mirroring grafana-zipkin-datasource tests/e2e/configEditor.spec.ts.
function getDataSourceConnectionUrlInput(page: Page): Locator {
  return page.locator(
    '[data-testid="data-testid Data source connection URL"], [aria-label="Data source connection URL"]'
  );
}

/** Fillable URL control: prefer label (stable for save & test); fall back to legacy "URL" textbox name. */
function dataSourceConnectionUrlTextbox(page: Page): Locator {
  return page.getByLabel('Data source connection URL').or(page.getByRole('textbox', { name: 'URL' }));
}

test('smoke: should render config editor', async ({ createDataSourceConfigPage, readProvisionedDataSource, page }) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await createDataSourceConfigPage({ type: ds.type });
  await expect(getDataSourceConnectionUrlInput(page)).toBeVisible();
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
  await dataSourceConnectionUrlTextbox(page).fill(ds.url ?? 'http://opentsdb:4242');
  await expect(configPage.saveAndTest()).toBeOK();
});