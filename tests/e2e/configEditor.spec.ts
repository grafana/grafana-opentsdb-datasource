import { expect, test } from '@grafana/plugin-e2e';
import { type Locator, type Page } from '@playwright/test';

const PLUGIN_TYPE = 'opentsdb';

// OpenTSDB uses DataSourceHttpSettings; URL field uses components.DataSource.DataSourceHttpSettings.urlInput
// (see @grafana/e2e-selectors). Match both the modern data-testid value and older / a11y fallbacks.
function getDataSourceHttpUrlInput(page: Page): Locator {
  return page
    .getByTestId('data-testid Datasource HTTP settings url')
    .or(page.getByTestId('Datasource HTTP settings url'))
    .or(page.getByRole('textbox', { name: 'URL' }))
    .or(page.getByPlaceholder('http://localhost:4242'));
}

test.describe('Config editor', () => {
  test(
    'smoke: should render config editor',
    { tag: '@plugins' },
    async ({ createDataSourceConfigPage, page }) => {
      await createDataSourceConfigPage({ type: PLUGIN_TYPE });

      await expect(page.getByRole('heading', { name: 'HTTP', exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(getDataSourceHttpUrlInput(page)).toBeVisible();
      await expect(page.locator('#basic-settings-name')).toBeVisible();
      await expect(page.getByText('OpenTSDB settings')).toBeVisible();
    }
  );

  test(
    '"Save & test" should be successful when configuration is valid',
    { tag: '@plugins' },
    async ({ createDataSourceConfigPage, readProvisionedDataSource, page }) => {
      const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
      const configPage = await createDataSourceConfigPage({ type: ds.type });
      await expect(page.getByRole('heading', { name: 'HTTP', exact: true })).toBeVisible({ timeout: 30_000 });
      await getDataSourceHttpUrlInput(page).fill(ds.url ?? 'http://opentsdb:4242');
      await expect(configPage.saveAndTest()).toBeOK();
    }
  );
});
