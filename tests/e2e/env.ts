/// <reference types="node" />
import { type Page } from '@playwright/test';

export const isCloudRun = !!process.env.GRAFANA_URL;

function requireOnCloud(name: string, localDefault: string): string {
  const value = process.env[name]?.trim();
  if (value) {
    return value;
  }
  if (isCloudRun) {
    throw new Error(
      `${name} is not set, but GRAFANA_URL is, so this Cloud run expects it from Vault. ` +
        `Check the repo-secrets paths in .github/workflows/cron.yml; they are relative to ` +
        `ci/repo/grafana/grafana-opentsdb-datasource/.`
    );
  }
  return localDefault;
}

export const DS_NAME = requireOnCloud('DS_INSTANCE_NAME', 'opentsdb');
export const DS_URL = requireOnCloud('DS_INSTANCE_URL', 'http://opentsdb:4242');

const LOCAL_DS_UID = 'opentsdb-e2e';

export async function resolveDataSourceUid(page: Page): Promise<string> {
  const override = process.env.DS_E2E_UID?.trim();
  if (override) {
    return override;
  }
  if (!isCloudRun) {
    return LOCAL_DS_UID;
  }

  const response = await page.request.get('/api/datasources');
  if (!response.ok()) {
    throw new Error(`Could not list data sources on ${process.env.GRAFANA_URL}: HTTP ${response.status()}`);
  }

  const openTsdbDataSources: Array<{ name: string; uid: string }> = (await response.json()).filter(
    (ds: { type: string }) => ds.type === 'opentsdb'
  );
  const exactMatch = openTsdbDataSources.find((ds) => ds.name === DS_NAME);
  if (exactMatch) {
    return exactMatch.uid;
  }

  if (openTsdbDataSources.length === 1) {
    console.warn(
      `DS_INSTANCE_NAME does not match any data source; using the only OpenTSDB data source ` +
        `on the instance ("${openTsdbDataSources[0].name}"). Update the Vault secret.`
    );
    return openTsdbDataSources[0].uid;
  }

  throw new Error(
    `Could not resolve an OpenTSDB data source matching DS_INSTANCE_NAME. Found ` +
      `${openTsdbDataSources.length} OpenTSDB data source(s): ` +
      `${JSON.stringify(openTsdbDataSources.map((ds) => ds.name))}.`
  );
}
