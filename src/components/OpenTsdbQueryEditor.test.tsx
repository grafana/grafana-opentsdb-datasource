import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import type OpenTsDatasource from '../datasource';
import { type OpenTsdbQuery } from '../types';

import { OpenTsdbQueryEditor, type OpenTsdbQueryEditorProps, testIds } from './OpenTsdbQueryEditor';

const setup = (propOverrides?: Object) => {
  const getAggregators = jest.fn().mockResolvedValue([]);
  const getFilterTypes = jest.fn().mockResolvedValue([]);

  const datasourceMock: unknown = {
    getAggregators,
    getFilterTypes,
    tsdbVersion: 1,
  };

  const datasource: OpenTsDatasource = datasourceMock as OpenTsDatasource;
  const onRunQuery = jest.fn();
  const onChange = jest.fn();
  const query: OpenTsdbQuery = { metric: '', refId: 'A' };
  const props: OpenTsdbQueryEditorProps = {
    datasource: datasource,
    onRunQuery: onRunQuery,
    onChange: onChange,
    query,
  };

  Object.assign(props, propOverrides);

  return { ...render(<OpenTsdbQueryEditor {...props} />), onChange, onRunQuery };
};
describe('OpenTsdbQueryEditor', () => {
  it('should render editor', () => {
    setup();
    expect(screen.getByTestId(testIds.editor)).toBeInTheDocument();
  });

  it('applies default aggregator and downsampling fields via onChange when missing', async () => {
    const { onChange } = setup();
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          refId: 'A',
          metric: '',
          aggregator: 'sum',
          downsampleAggregator: 'avg',
          downsampleFillPolicy: 'none',
        })
      );
    });
  });
});
