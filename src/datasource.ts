import {
  map as _map,
  clone,
  cloneDeep,
  each,
  every,
  findIndex,
  has,
  includes,
  isArray,
  isEmpty,
  toPairs
} from 'lodash';
import { from, lastValueFrom, merge, Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';

import {
  type AnnotationEvent,
  type DataFrame,
  type DataQueryRequest,
  type DataQueryResponse,
  type ScopedVars,
  toDataFrame
} from '@grafana/data';
import {
  DataSourceWithBackend,
  type FetchResponse,
  getBackendSrv,
  getTemplateSrv,
  type TemplateSrv
} from '@grafana/runtime';

import { AnnotationEditor } from './components/AnnotationEditor';
import { prepareAnnotation } from './migrations';
import { type OpenTsdbFilter, type OpenTsdbOptions, type OpenTsdbQuery } from './types';

export default class OpenTsDatasource extends DataSourceWithBackend<OpenTsdbQuery, OpenTsdbOptions> {
  url: string;
  name: string;
  withCredentials: boolean;
  basicAuth: string;
  tsdbVersion: number;
  tsdbResolution: number;
  lookupLimit: number;
  tagKeys: Record<string | number, string[]>;

  aggregatorsPromise: Promise<string[]> | null;
  filterTypesPromise: Promise<string[]> | null;

  constructor(
    instanceSettings: any,
    private readonly templateSrv: TemplateSrv = getTemplateSrv()
  ) {
    super(instanceSettings);
    this.url = instanceSettings.url;
    this.name = instanceSettings.name;
    this.withCredentials = instanceSettings.withCredentials;
    this.basicAuth = instanceSettings.basicAuth;
    instanceSettings.jsonData = instanceSettings.jsonData || {};
    this.tsdbVersion = instanceSettings.jsonData.tsdbVersion || 1;
    this.tsdbResolution = instanceSettings.jsonData.tsdbResolution || 1;
    this.lookupLimit = instanceSettings.jsonData.lookupLimit || 1000;
    this.tagKeys = {};

    this.aggregatorsPromise = null;
    this.filterTypesPromise = null;
    this.annotations = {
      QueryEditor: AnnotationEditor,
      prepareAnnotation,
    };
  }

  query(options: DataQueryRequest<OpenTsdbQuery>): Observable<DataQueryResponse> {
    if (options.targets.some((target: OpenTsdbQuery) => target.fromAnnotations)) {
      const streams: Array<Observable<DataQueryResponse>> = [];

      for (const annotation of options.targets) {
        if (annotation.target) {
          streams.push(
            new Observable((subscriber) => {
              this.annotationEvent(options, annotation)
                .then((events) => subscriber.next({ data: [toDataFrame(events)] }))
                .catch((ex) => {
                  return subscriber.next({ data: [toDataFrame([])] });
                })
                .finally(() => subscriber.complete());
            })
          );
        }
      }

      return merge(...streams);
    }

    const hasValidTargets = options.targets.some((target) => target.metric && !target.hide);
    if (!hasValidTargets) {
      return of({ data: [] });
    }

    return super.query(options).pipe(
      map((response) => {
        this._saveTagKeysFromFrames(response.data);
        return response;
      })
    );
  }

  applyTemplateVariables(query: OpenTsdbQuery, scopedVars: ScopedVars): OpenTsdbQuery {
    return this.interpolateVariablesInQuery(query, scopedVars);
  }

  annotationEvent(options: DataQueryRequest, annotation: OpenTsdbQuery): Promise<AnnotationEvent[]> {
    const query: OpenTsdbQuery = {
      refId: annotation.refId ?? 'Anno',
      metric: annotation.target,
      aggregator: 'sum',
      fromAnnotations: true,
      isGlobal: annotation.isGlobal,
      disableDownsampling: true,
    };

    const queryRequest: DataQueryRequest<OpenTsdbQuery> = {
      ...options,
      targets: [query],
    };

    return lastValueFrom(
      super.query(queryRequest).pipe(
        map((response) => {
          const eventList: AnnotationEvent[] = [];

          for (const frame of response.data) {
            const annotationObject = annotation.isGlobal
              ? frame.meta?.custom?.globalAnnotations
              : frame.meta?.custom?.annotations;

            if (annotationObject && isArray(annotationObject)) {
              annotationObject.forEach((ann) => {
                const event: AnnotationEvent = {
                  text: ann.description,
                  time: Math.floor(ann.startTime) * 1000,
                  annotation: annotation,
                };

                eventList.push(event);
              });
            }
          }

          return eventList;
        })
      )
    );
  }

  targetContainsTemplate(target: OpenTsdbQuery) {
    if (target.filters && target.filters.length > 0) {
      for (let i = 0; i < target.filters.length; i++) {
        if (this.templateSrv.containsTemplate(target.filters[i].filter)) {
          return true;
        }
      }
    }

    if (target.tags && Object.keys(target.tags).length > 0) {
      for (const tagKey in target.tags) {
        if (this.templateSrv.containsTemplate(target.tags[tagKey])) {
          return true;
        }
      }
    }

    return false;
  }

  performTimeSeriesQuery(queries: any[], start: number | null, end: number | null): Observable<FetchResponse> {
    let msResolution = false;
    if (this.tsdbResolution === 2) {
      msResolution = true;
    }
    const reqBody: any = {
      start: start,
      queries: queries,
      msResolution: msResolution,
      globalAnnotations: true,
    };
    if (this.tsdbVersion === 3) {
      reqBody.showQuery = true;
    }

    // Relative queries (e.g. last hour) don't include an end time
    if (end) {
      reqBody.end = end;
    }

    const options = {
      method: 'POST',
      url: this.url + '/api/query',
      data: reqBody,
    };

    this._addCredentialOptions(options);
    return getBackendSrv().fetch(options);
  }

  suggestTagKeys(query: OpenTsdbQuery) {
    const metric = query.metric ?? '';
    return Promise.resolve(this.tagKeys[metric] || []);
  }

  _saveTagKeys(metricData: { tags: {}; aggregateTags: any; metric: string | number }) {
    const tagKeys = Object.keys(metricData.tags);
    each(metricData.aggregateTags, (tag) => {
      tagKeys.push(tag);
    });

    this.tagKeys[metricData.metric] = tagKeys;
  }

  _saveTagKeysFromFrames(frames: DataFrame[]) {
    for (const frame of frames) {
      const tagKeys = frame.meta?.custom?.tagKeys;
      if (frame.name && tagKeys) {
        this.tagKeys[frame.name] = tagKeys;
      }
    }
  }

  _performSuggestQuery(query: string, type: string) {
    return from(this.getResource('api/suggest', { type, q: query, max: this.lookupLimit }));
  }

  _performMetricKeyValueLookup(metric: string, keys: string) {
    if (!metric || !keys) {
      return of([]);
    }

    return from(this.getResource('api/search/lookup', { type: 'keyvalue', metric, keys }));
  }

  _performMetricKeyLookup(metric: string) {
    if (!metric) {
      return of([]);
    }

    return from(this.getResource('api/search/lookup', { type: 'key', metric }));
  }

  _get(
    relativeUrl: string,
    params?: { type?: string; q?: string; max?: number; m?: string; limit?: number }
  ): Observable<FetchResponse> {
    const options = {
      method: 'GET',
      url: this.url + relativeUrl,
      params: params,
    };

    this._addCredentialOptions(options);

    return getBackendSrv().fetch(options);
  }

  _addCredentialOptions(options: Record<string, unknown>) {
    if (this.basicAuth || this.withCredentials) {
      options.withCredentials = true;
    }
    if (this.basicAuth) {
      options.headers = { Authorization: this.basicAuth };
    }
  }

  metricFindQuery(query: string) {
    if (!query) {
      return Promise.resolve([]);
    }

    let interpolated;
    try {
      interpolated = this.templateSrv.replace(query, {}, 'distributed');
    } catch (err) {
      return Promise.reject(err);
    }

    const responseTransform = (result: any) => {
      return _map(result, (value) => {
        return { text: value };
      });
    };

    const metricsRegex = /metrics\((.*)\)/;
    const tagNamesRegex = /tag_names\((.*)\)/;
    const tagValuesRegex = /tag_values\((.*?),\s?(.*)\)/;
    const tagNamesSuggestRegex = /suggest_tagk\((.*)\)/;
    const tagValuesSuggestRegex = /suggest_tagv\((.*)\)/;

    const metricsQuery = interpolated.match(metricsRegex);
    if (metricsQuery) {
      return lastValueFrom(this._performSuggestQuery(metricsQuery[1], 'metrics').pipe(map(responseTransform)));
    }

    const tagNamesQuery = interpolated.match(tagNamesRegex);
    if (tagNamesQuery) {
      return lastValueFrom(this._performMetricKeyLookup(tagNamesQuery[1]).pipe(map(responseTransform)));
    }

    const tagValuesQuery = interpolated.match(tagValuesRegex);
    if (tagValuesQuery) {
      return lastValueFrom(
        this._performMetricKeyValueLookup(tagValuesQuery[1], tagValuesQuery[2]).pipe(map(responseTransform))
      );
    }

    const tagNamesSuggestQuery = interpolated.match(tagNamesSuggestRegex);
    if (tagNamesSuggestQuery) {
      return lastValueFrom(this._performSuggestQuery(tagNamesSuggestQuery[1], 'tagk').pipe(map(responseTransform)));
    }

    const tagValuesSuggestQuery = interpolated.match(tagValuesSuggestRegex);
    if (tagValuesSuggestQuery) {
      return lastValueFrom(this._performSuggestQuery(tagValuesSuggestQuery[1], 'tagv').pipe(map(responseTransform)));
    }

    return Promise.resolve([]);
  }

  async testDatasource() {
    return await super.testDatasource();
  }

  getAggregators() {
    if (this.aggregatorsPromise) {
      return this.aggregatorsPromise;
    }

    this.aggregatorsPromise = this.getResource('api/aggregators');
    return this.aggregatorsPromise;
  }

  getFilterTypes() {
    if (this.filterTypesPromise) {
      return this.filterTypesPromise;
    }

    this.filterTypesPromise = this.getResource('api/config/filters');
    return this.filterTypesPromise;
  }

  transformMetricData(
    md: { dps: any },
    groupByTags: Record<string, boolean>,
    target: OpenTsdbQuery,
    options: DataQueryRequest<OpenTsdbQuery>,
    tsdbResolution: number
  ) {
    const metricLabel = this.createMetricLabel(md, target, groupByTags, options);
    const dps: any[] = [];

    // TSDB returns datapoints has a hash of ts => value.
    // Can't use pairs(invert()) because it stringifies keys/values
    each(md.dps, (v, k: number) => {
      if (tsdbResolution === 2) {
        dps.push([v, k * 1]);
      } else {
        dps.push([v, k * 1000]);
      }
    });

    return { target: metricLabel, datapoints: dps };
  }

  createMetricLabel(
    md: { dps?: any; tags?: any; metric?: any },
    target: OpenTsdbQuery,
    groupByTags: Record<string, boolean>,
    options: DataQueryRequest<OpenTsdbQuery>
  ) {
    if (target.alias) {
      const scopedVars = clone(options.scopedVars || {});
      each(md.tags, (value, key) => {
        scopedVars['tag_' + key] = { value: value };
      });
      return this.templateSrv.replace(target.alias, scopedVars);
    }

    let label = md.metric;
    const tagData: any[] = [];

    if (!isEmpty(md.tags)) {
      each(toPairs(md.tags), (tag) => {
        if (has(groupByTags, tag[0])) {
          tagData.push(tag[0] + '=' + tag[1]);
        }
      });
    }

    if (!isEmpty(tagData)) {
      label += '{' + tagData.join(', ') + '}';
    }

    return label;
  }

  convertTargetToQuery(target: OpenTsdbQuery, options: DataQueryRequest<OpenTsdbQuery>, tsdbVersion: number) {
    if (!target.metric || target.hide) {
      return null;
    }

    const query = this.interpolateVariablesInQuery(target, options.scopedVars);

    if (target.shouldComputeRate) {
      query.rate = true;
      query.rateOptions = {
        counter: !!target.isCounter,
      };

      if (target.counterMax && target.counterMax.length) {
        query.rateOptions.counterMax = parseInt(target.counterMax, 10);
      }

      if (target.counterResetValue && target.counterResetValue.length) {
        query.rateOptions.resetValue = parseInt(target.counterResetValue, 10);
      }

      if (tsdbVersion >= 2) {
        query.rateOptions.dropResets =
          !query.rateOptions.counterMax && (!query.rateOptions.ResetValue || query.rateOptions.ResetValue === 0);
      }
    }

    if (!target.disableDownsampling) {
      let interval = this.templateSrv.replace(target.downsampleInterval || options.interval);

      if (interval.match(/\.[0-9]+s/)) {
        interval = parseFloat(interval) * 1000 + 'ms';
      }

      query.downsample = interval + '-' + target.downsampleAggregator;

      if (target.downsampleFillPolicy && target.downsampleFillPolicy !== 'none') {
        query.downsample += '-' + target.downsampleFillPolicy;
      }
    }

    if (target.explicitTags) {
      query.explicitTags = true;
    }

    return query;
  }

  interpolateVariablesInFilters(query: OpenTsdbQuery, scopedVars: ScopedVars) {
    query.filters = query.filters?.map((filter: OpenTsdbFilter): OpenTsdbFilter => {
      filter.tagk = this.templateSrv.replace(filter.tagk, scopedVars, 'pipe');

      filter.filter = this.templateSrv.replace(filter.filter, scopedVars, 'pipe');

      return filter;
    });
  }

  getVariables(): string[] {
    return this.templateSrv.getVariables().map((v) => `$${v.name}`);
  }

  mapMetricsToTargets(metrics: any, options: DataQueryRequest<OpenTsdbQuery>, tsdbVersion: number) {
    let interpolatedTagValue, arrTagV;
    return _map(metrics, (metricData) => {
      if (tsdbVersion === 3) {
        return metricData.query.index;
      } else {
        return findIndex(options.targets, (target) => {
          if (target.filters && target.filters.length > 0) {
            return target.metric === metricData.metric;
          } else {
            return (
              target.metric === metricData.metric &&
              every(target.tags, (tagV, tagK) => {
                interpolatedTagValue = this.templateSrv.replace(tagV, options.scopedVars, 'pipe');
                arrTagV = interpolatedTagValue.split('|');
                return includes(arrTagV, metricData.tags[tagK]) || interpolatedTagValue === '*';
              })
            );
          }
        });
      }
    });
  }

  interpolateVariablesInQueries(queries: OpenTsdbQuery[], scopedVars: ScopedVars): OpenTsdbQuery[] {
    if (!queries.length) {
      return queries;
    }

    return queries.map((query) => this.interpolateVariablesInQuery(query, scopedVars));
  }

  interpolateVariablesInQuery(target: OpenTsdbQuery, scopedVars: ScopedVars): any {
    const query = cloneDeep(target);

    query.metric = this.templateSrv.replace(target.metric, scopedVars, 'pipe');

    query.aggregator = 'avg';
    if (target.aggregator) {
      query.aggregator = this.templateSrv.replace(target.aggregator);
    }

    if (query.filters && query.filters.length > 0) {
      this.interpolateVariablesInFilters(query, scopedVars);
    } else {
      if (query.tags) {
        for (const tagKey in query.tags) {
          query.tags[tagKey] = this.templateSrv.replace(query.tags[tagKey], scopedVars, 'pipe');
        }
      }
    }

    if (target.downsampleInterval) {
      query.downsampleInterval = this.templateSrv.replace(target.downsampleInterval, scopedVars);
    }

    if (target.alias) {
      query.alias = this.templateSrv.replace(target.alias, scopedVars);
    }

    if (target.downsampleAggregator) {
      query.downsampleAggregator = this.templateSrv.replace(target.downsampleAggregator, scopedVars);
    }

    if (target.downsampleFillPolicy) {
      query.downsampleFillPolicy = this.templateSrv.replace(target.downsampleFillPolicy, scopedVars);
    }

    if (target.counterMax) {
      query.counterMax = this.templateSrv.replace(target.counterMax, scopedVars);
    }

    if (target.counterResetValue) {
      query.counterResetValue = this.templateSrv.replace(target.counterResetValue, scopedVars);
    }

    return query;
  }
}
