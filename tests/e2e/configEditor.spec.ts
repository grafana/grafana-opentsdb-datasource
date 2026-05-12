import { expect, test } from '@grafana/plugin-e2e';
import { type Locator, type Page } from '@playwright/test';

import { OpenTsdbOptions } from '../../src/types';

const PLUGIN_TYPE = 'opentsdb';
const PROVISIONED_FILE = 'datasources.yml';

// In CI/Cloud the data source URL is provisioned from Vault and exposed via
// DS_INSTANCE_URL. Locally docker-compose names the backend `opentsdb` and the
// provisioned datasources.yml uses http://opentsdb:4242.
const DS_URL = process.env.DS_INSTANCE_URL || 'http://opentsdb:4242';

// The DataSourceHttpSettings URL input migrated from aria-label to data-testid
// in Grafana 13 (https://github.com/grafana/grafana/pull/121784). Match both
// shapes plus the placeholder/role fallbacks so tests work across versions.
function getDataSourceHttpUrlInput(page: Page): Locator {
  return page
    .getByTestId('data-testid Datasource HTTP settings url')
    .or(page.getByTestId('Datasource HTTP settings url'))
    .or(page.getByRole('textbox', { name: 'URL' }))
    .or(page.getByPlaceholder('http://localhost:4242'));
}

test.describe('Config editor', () => {
  test.describe('rendering', () => {
    test(
      'smoke: should render config editor',
      { tag: '@plugins' },
      async ({ createDataSourceConfigPage, page }) => {
        await createDataSourceConfigPage({ type: PLUGIN_TYPE });

        await expect(page.getByRole('heading', { name: 'HTTP', exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(getDataSourceHttpUrlInput(page)).toBeVisible();
        // Grafana >=13.1 replaced the #basic-settings-name input with an inline
        // editable heading. Match both shapes so the test works across versions.
        await expect(
          page.locator('#basic-settings-name').or(page.getByRole('button', { name: 'Edit title' }))
        ).toBeVisible();
      }
    );

    test('should render OpenTSDB settings section', async ({ createDataSourceConfigPage, page }) => {
      await createDataSourceConfigPage({ type: PLUGIN_TYPE });

      const heading = page.getByText('OpenTSDB settings', { exact: true }).first();
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeVisible();

      // OpenTsdbDetails renders three labelled fields: Version, Resolution, Lookup limit.
      await expect(page.getByLabel('Version')).toBeVisible();
      await expect(page.getByLabel('Resolution')).toBeVisible();
      await expect(page.getByLabel('Lookup limit')).toBeVisible();
    });
  });

  test.describe('provisioned datasource', () => {
    test('should load provisioned URL', async ({ readProvisionedDataSource, gotoDataSourceConfigPage, page }) => {
      const ds = await readProvisionedDataSource<OpenTsdbOptions>({ fileName: PROVISIONED_FILE });
      await gotoDataSourceConfigPage(ds.uid);

      await page.getByRole('heading', { name: 'HTTP', exact: true }).scrollIntoViewIfNeeded();
      await expect(getDataSourceHttpUrlInput(page)).toHaveValue(DS_URL);
    });

    test('should load provisioned OpenTSDB settings', async ({
      readProvisionedDataSource,
      gotoDataSourceConfigPage,
      page,
    }) => {
      const ds = await readProvisionedDataSource<OpenTsdbOptions>({ fileName: PROVISIONED_FILE });
      await gotoDataSourceConfigPage(ds.uid);

      await page.getByText('OpenTSDB settings', { exact: true }).first().scrollIntoViewIfNeeded();

      // Map the numeric jsonData values to the labels rendered in the Select dropdowns.
      // See src/components/OpenTsdbDetails.tsx for the source of truth.
      const versionLabels: Record<number, string> = { 1: '<=2.1', 2: '==2.2', 3: '==2.3', 4: '==2.4' };
      const resolutionLabels: Record<number, string> = { 1: 'second', 2: 'millisecond' };

      const expectedVersion = versionLabels[ds.jsonData.tsdbVersion] ?? versionLabels[1];
      const expectedResolution = resolutionLabels[ds.jsonData.tsdbResolution] ?? resolutionLabels[1];

      await expect(page.getByText(expectedVersion, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(expectedResolution, { exact: true }).first()).toBeVisible();
      await expect(page.getByLabel('Lookup limit')).toHaveValue(String(ds.jsonData.lookupLimit ?? 1000));
    });
  });

  test.describe('save & test', () => {
    test('should pass health check for provisioned datasource', async ({
      readProvisionedDataSource,
      gotoDataSourceConfigPage,
      page,
    }) => {
      const ds = await readProvisionedDataSource({ fileName: PROVISIONED_FILE });
      const configPage = await gotoDataSourceConfigPage(ds.uid);

      // Match both `Save & test` (editable: true) and `Test` (editable: false).
      // configPage.saveAndTest() times out on provisioned datasources since the
      // form is in read-only mode for non-editable provisioning.
      await page.getByRole('button', { name: /^(Save & test|Test)$/ }).click();
      await expect(configPage).toHaveAlert('success');
    });

    test('should show error alert when health check fails', async ({ createDataSourceConfigPage, page }) => {
      const configPage = await createDataSourceConfigPage({ type: PLUGIN_TYPE });

      // `localhost` from inside the Grafana container never resolves to the
      // OpenTSDB service running in a sibling container.
      await getDataSourceHttpUrlInput(page).fill('http://localhost:4242');
      await page.getByRole('button', { name: /^(Save & test|Test)$/ }).click();
      await expect(configPage).toHaveAlert('error');
    });

    test('should show error alert when backend is unreachable', async ({ createDataSourceConfigPage, page }) => {
      const configPage = await createDataSourceConfigPage({ type: PLUGIN_TYPE });

      // Point at a port nothing is listening on (uses the Cloud host where present).
      const url = DS_URL.replace(/:(\d+)$/, ':14242');
      await getDataSourceHttpUrlInput(page).fill(url);
      await page.getByRole('button', { name: /^(Save & test|Test)$/ }).click();
      await expect(configPage).toHaveAlert('error');
    });
  });
});
