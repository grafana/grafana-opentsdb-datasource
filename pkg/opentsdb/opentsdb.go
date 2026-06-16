package opentsdb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
)

// Ensure DataSource implements backend interfaces (compile-time checks)
var _ backend.CheckHealthHandler = (*DataSource)(nil)
var _ backend.CallResourceHandler = (*DataSource)(nil)
var _ backend.QueryDataHandler = (*DataSource)(nil)

type DataSource struct {
	info *datasourceInfo
}

func NewDatasource(ctx context.Context, settings backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	opts, err := settings.HTTPClientOptions(ctx)
	if err != nil {
		return nil, err
	}

	client, err := httpclient.New(opts)
	if err != nil {
		return nil, err
	}

	jsonData := JSONData{}
	if err := json.Unmarshal(settings.JSONData, &jsonData); err != nil {
		return nil, backend.DownstreamErrorf("error reading settings: %w", err)
	}

	return &DataSource{
		info: &datasourceInfo{
			HTTPClient:     client,
			URL:            settings.URL,
			TSDBVersion:    jsonData.TSDBVersion,
			TSDBResolution: jsonData.TSDBResolution,
			LookupLimit:    jsonData.LookupLimit,
		},
	}, nil
}

type datasourceInfo struct {
	HTTPClient     *http.Client
	URL            string
	TSDBVersion    float32
	TSDBResolution int32
	LookupLimit    int32
}

type DsAccess string

type JSONData struct {
	TSDBVersion    float32 `json:"tsdbVersion"`
	TSDBResolution int32   `json:"tsdbResolution"`
	LookupLimit    int32   `json:"lookupLimit"`
}

type QueryModel struct {
	Metric               string                 `json:"metric"`
	Aggregator           string                 `json:"aggregator"`
	DownsampleInterval   string                 `json:"downsampleInterval"`
	DownsampleAggregator string                 `json:"downsampleAggregator"`
	DownsampleFillPolicy string                 `json:"downsampleFillPolicy"`
	DisableDownsampling  bool                   `json:"disableDownsampling"`
	Filters              []any                  `json:"filters"`
	Tags                 map[string]interface{} `json:"tags"`
	ShouldComputeRate    bool                   `json:"shouldComputeRate"`
	IsCounter            bool                   `json:"isCounter"`
	CounterMax           string                 `json:"counterMax"`
	CounterResetValue    string                 `json:"counterResetValue"`
	ExplicitTags         bool                   `json:"explicitTags"`
}

func (ds *DataSource) CheckHealth(ctx context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	logger := backend.Logger.FromContext(ctx)

	dsInfo := ds.info

	u, err := url.Parse(dsInfo.URL)
	if err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: err.Error(),
		}, nil
	}

	u.Path = path.Join(u.Path, "api/suggest")
	query := u.Query()
	query.Set("q", "cpu")
	query.Set("type", "metrics")
	u.RawQuery = query.Encode()

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: err.Error(),
		}, nil
	}

	res, err := dsInfo.HTTPClient.Do(httpReq)
	if err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: err.Error(),
		}, nil
	}

	defer func() {
		if err := res.Body.Close(); err != nil {
			logger.Warn("Failed to close response body", "error", err)
		}
	}()

	if res.StatusCode != 200 {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: fmt.Sprintf("OpenTSDB suggest endpoint returned status %d", res.StatusCode),
		}, nil
	}

	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: "Data source is working",
	}, nil
}

func (ds *DataSource) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/suggest", ds.HandleSuggestQuery)
	mux.HandleFunc("/api/aggregators", ds.HandleAggregatorsQuery)
	mux.HandleFunc("/api/config/filters", ds.HandleFiltersQuery)
	mux.HandleFunc("/api/search/lookup", ds.HandleLookupQuery)

	handler := httpadapter.New(mux)
	return handler.CallResource(ctx, req, sender)
}

func (ds *DataSource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	logger := backend.Logger.FromContext(ctx)
	result := backend.NewQueryDataResponse()

	dsInfo := ds.info

	for _, query := range req.Queries {
		metric, err := BuildMetric(query)
		if err != nil {
			result.Responses[query.RefID] = backend.ErrorResponseWithErrorSource(backend.PluginError(err))
			continue
		}

		tsdbQuery := OpenTsdbQuery{
			Start: query.TimeRange.From.Unix(),
			End:   query.TimeRange.To.Unix(),
			Queries: []map[string]any{
				metric,
			},
		}

		httpReq, err := CreateRequest(ctx, logger, dsInfo, tsdbQuery)
		if err != nil {
			result.Responses[query.RefID] = backend.ErrorResponseWithErrorSource(err)
			continue
		}

		httpRes, err := dsInfo.HTTPClient.Do(httpReq)
		if err != nil {
			if backend.IsDownstreamHTTPError(err) {
				err = backend.DownstreamError(err)
			}
			var urlErr *url.Error
			if errors.As(err, &urlErr) && urlErr.Err != nil && strings.HasPrefix(urlErr.Err.Error(), "unsupported protocol scheme") {
				err = backend.DownstreamError(err)
			}
			result.Responses[query.RefID] = backend.ErrorResponseWithErrorSource(err)
			continue
		}

		defer func() {
			if cerr := httpRes.Body.Close(); cerr != nil {
				logger.Warn("Failed to close response body", "error", cerr)
			}
		}()

		queryRes, err := ParseResponse(logger, httpRes, query.RefID, dsInfo.TSDBVersion)
		if err != nil {
			result.Responses[query.RefID] = backend.ErrorResponseWithErrorSource(backend.DownstreamError(err))
			continue
		}

		result.Responses[query.RefID] = queryRes.Responses[query.RefID]
	}

	return result, nil
}
