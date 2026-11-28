package schema_test

import (
	_ "embed"
	"testing"

	"github.com/grafana/dsconfig/schema"
	"github.com/grafana/grafana-opentsdb-datasource/pkg/opentsdb"
	"github.com/grafana/grafana-plugin-sdk-go/experimental/pluginschema"
	"k8s.io/kube-openapi/pkg/spec3"
)

//go:embed dsconfig.json
var configSchemaJSON []byte

// The loader reads JSONData. Grafana and the SDK read the HTTP and proxy settings.
type settings struct {
	opentsdb.JSONData
	KeepCookies              []string `json:"keepCookies"`
	Timeout                  int      `json:"timeout"`
	TLSAuth                  bool     `json:"tlsAuth"`
	TLSAuthWithCACert        bool     `json:"tlsAuthWithCACert"`
	TLSSkipVerify            bool     `json:"tlsSkipVerify"`
	ServerName               string   `json:"serverName"`
	OAuthPassThru            bool     `json:"oauthPassThru"`
	EnableSecureSocksProxy   bool     `json:"enableSecureSocksProxy"`
	SecureSocksProxyUsername string   `json:"secureSocksProxyUsername"`
	KeepAlive                int      `json:"keepAlive"`
}

//go:generate go test -run TestPlugin -generateArtifacts
func TestPlugin(t *testing.T) {
	const httpURL = "http://localhost:4242"
	const httpsURL = "https://localhost:4242"
	schema.RunPluginTests(t, schema.PluginUnderTest{
		ID:                "opentsdb",
		ConfigSchemaJSON:  configSchemaJSON,
		SettingsJSONModel: settings{},
		SecureKeys: []string{
			"basicAuthPassword", "tlsCACert", "tlsClientCert", "tlsClientKey", "secureSocksProxyPassword",
		},
		SettingsExamples: &pluginschema.SettingsExamples{Examples: map[string]*spec3.Example{
			"": example("OpenTSDB 2.3 without authentication", httpURL, nil, nil, nil),
			"basicAuth": example("Basic authentication", httpURL,
				map[string]any{"basicAuth": true, "basicAuthUser": "<USERNAME>"}, nil,
				map[string]string{"basicAuthPassword": "<PASSWORD>"}),
			"customHeader": example("Authenticate using a custom HTTP header", httpURL, nil,
				map[string]any{"httpHeaderName1": "X-Custom-Header"},
				map[string]string{"httpHeaderValue1": "<HEADER_VALUE>"}),
			"customCA": example("Verify the server with a private CA", httpsURL, nil,
				map[string]any{"tlsAuthWithCACert": true},
				map[string]string{"tlsCACert": "<CA_CERTIFICATE_PEM>"}),
			"clientTLS": example("Authenticate with a TLS client certificate", httpsURL, nil,
				map[string]any{"tlsAuth": true},
				map[string]string{"tlsClientCert": "<CLIENT_CERTIFICATE_PEM>", "tlsClientKey": "<CLIENT_KEY_PEM>"}),
			"skipTLSVerify": example("Connect to a test server without checking its TLS certificate", httpsURL, nil,
				map[string]any{"tlsSkipVerify": true}, nil),
			"secureSocksProxy": example("Connect through a self-managed secure SOCKS proxy", httpURL, nil,
				map[string]any{"enableSecureSocksProxy": true, "secureSocksProxyUsername": "<PROXY_USERNAME>"},
				map[string]string{"secureSocksProxyPassword": "<PROXY_PASSWORD>"}),
			"privateNetwork": example("Connect through a Grafana Cloud PDC private network", "http://opentsdb:4242", nil,
				map[string]any{"enableSecureSocksProxy": true, "secureSocksProxyUsername": "<PDC_NETWORK_ID>"}, nil),
			"forwardOAuth": example("Pass the user's OAuth token to the plugin only", httpsURL, nil,
				map[string]any{"oauthPassThru": true}, nil),
			"cookies": example("Pass selected cookies to the plugin only", httpsURL,
				map[string]any{"withCredentials": true}, map[string]any{"keepCookies": []string{"example_session"}}, nil),
		}},
	})
}

func example(summary, url string, rootFields, jsonFields map[string]any, secrets map[string]string) *spec3.Example {
	jsonData := map[string]any{"tsdbVersion": 3, "tsdbResolution": 1, "lookupLimit": 1000}
	for key, value := range jsonFields {
		jsonData[key] = value
	}
	spec := map[string]any{"title": "OpenTSDB", "access": "proxy", "url": url, "jsonData": jsonData}
	for key, value := range rootFields {
		spec[key] = value
	}
	resource := map[string]any{
		"apiVersion": "opentsdb.datasource.grafana.app/v0alpha1",
		"kind":       "DataSource",
		"metadata":   map[string]string{"name": "opentsdb"},
		"spec":       spec,
	}
	if len(secrets) > 0 {
		secure := make(map[string]map[string]string, len(secrets))
		for key, placeholder := range secrets {
			secure[key] = map[string]string{"create": placeholder}
		}
		resource["secure"] = secure
	}
	return &spec3.Example{ExampleProps: spec3.ExampleProps{Summary: summary, Value: resource}}
}
