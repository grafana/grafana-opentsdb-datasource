import { css } from '@emotion/css';
import React, { useEffect, useMemo, useState } from 'react';

import { GrafanaTheme2, QueryEditorProps, textUtil } from '@grafana/data';
import { useStyles2, Stack } from '@grafana/ui';

import OpenTsDatasource from '../datasource';
import { OpenTsdbOptions, OpenTsdbQuery } from '../types';

import { DownSample } from './DownSample';
import { FilterSection } from './FilterSection';
import { MetricSection } from './MetricSection';
import { RateSection } from './RateSection';
import { TagSection } from './TagSection';

export type OpenTsdbQueryEditorProps = QueryEditorProps<OpenTsDatasource, OpenTsdbQuery, OpenTsdbOptions>;

const fillPolicies: string[] = ['none', 'nan', 'null', 'zero'];
const aggregatorsDefault: string[] = ['avg', 'sum', 'min', 'max', 'dev', 'zimsum', 'mimmin', 'mimmax'];
const filterTypesDefault: string[] = ['wildcard', 'iliteral_or', 'not_iliteral_or', 'not_literal_or', 'iwildcard', 'literal_or', 'regexp'];
export function OpenTsdbQueryEditor({ datasource, onRunQuery, onChange, query }: OpenTsdbQueryEditorProps) {
  const styles = useStyles2(getStyles);

  const [aggregators, setAggregators] = useState<string[]>(aggregatorsDefault);
  const [filterTypes, setFilterTypes] = useState<string[]>(filterTypesDefault);

  const tsdbVersion: number = datasource.tsdbVersion;

  const effectiveQuery = useMemo<OpenTsdbQuery>(
    () => ({
      ...query,
      aggregator: query.aggregator || 'sum',
      downsampleAggregator: query.downsampleAggregator || 'avg',
      downsampleFillPolicy: query.downsampleFillPolicy || 'none',
    }),
    [query]
  );

  useEffect(() => {
    if (
      query.aggregator === effectiveQuery.aggregator &&
      query.downsampleAggregator === effectiveQuery.downsampleAggregator &&
      query.downsampleFillPolicy === effectiveQuery.downsampleFillPolicy
    ) {
      return;
    }

    onChange(effectiveQuery);
  }, [effectiveQuery, onChange, query.aggregator, query.downsampleAggregator, query.downsampleFillPolicy]);

  useEffect(() => {
    datasource.getAggregators().then((aggs: string[]) => {
      if (aggs.length !== 0) {
        setAggregators(aggs);
      }
    });
  }, [datasource]);

  useEffect(() => {
    datasource.getFilterTypes().then((newFilterTypes: string[]) => {
      if (newFilterTypes.length !== 0) {
        setFilterTypes(newFilterTypes);
      }
    });
  }, [datasource]);

  async function suggestMetrics(value: string): Promise<Array<{ value: string; description: string }>> {
    return datasource.metricFindQuery(`metrics(${value})`).then(getTextValues);
  }

  // previously called as an autocomplete on every input,
  // in this we call it once on init and filter in the MetricSection component
  async function suggestTagValues(value: string): Promise<Array<{ value: string; description: string }>> {
    return datasource.metricFindQuery(`suggest_tagv(${value})`).then(getTextValues);
  }

  async function suggestTagKeys(query: OpenTsdbQuery): Promise<string[]> {
    return datasource.suggestTagKeys(query);
  }

  function getTextValues(metrics: Array<{ text: string }>) {
    const variables = datasource.getVariables().map((value) => {
      return {
        value: textUtil.escapeHtml(value),
        description: value,
      };
    });

    const values = metrics.map((value: { text: string }) => {
      return {
        value: textUtil.escapeHtml(value.text),
        description: value.text,
      };
    });

    return variables.concat(values);
  }

  return (
    <div className={styles.container} data-testid={testIds.editor}>
      <Stack gap={0.5} direction="column" grow={1}>
        <MetricSection
          query={effectiveQuery}
          onChange={onChange}
          onRunQuery={onRunQuery}
          suggestMetrics={suggestMetrics}
          aggregators={aggregators}
        />
        <DownSample
          query={effectiveQuery}
          onChange={onChange}
          onRunQuery={onRunQuery}
          aggregators={aggregators}
          fillPolicies={fillPolicies}
          tsdbVersion={tsdbVersion}
        />
        {tsdbVersion >= 2 && (
          <FilterSection
            query={effectiveQuery}
            onChange={onChange}
            onRunQuery={onRunQuery}
            filterTypes={filterTypes}
            suggestTagValues={suggestTagValues}
            suggestTagKeys={suggestTagKeys}
          />
        )}
        <TagSection
          query={effectiveQuery}
          onChange={onChange}
          onRunQuery={onRunQuery}
          suggestTagValues={suggestTagValues}
          suggestTagKeys={suggestTagKeys}
          tsdbVersion={tsdbVersion}
        />
        <RateSection query={effectiveQuery} onChange={onChange} onRunQuery={onRunQuery} tsdbVersion={tsdbVersion} />
      </Stack>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      display: 'flex',
    }),
    toggleButton: css({
      marginLeft: theme.spacing(0.5),
    }),
  };
}

export const testIds = {
  editor: 'opentsdb-editor',
};
