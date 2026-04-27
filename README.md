# OpenTSDB data source for Grafana

> **Note**: This core plugin was extracted from the
> [grafana/grafana](https://github.com/grafana/grafana) repository and is now
> developed and released from this repository.

## Overview

[OpenTSDB](http://opentsdb.net/) is a distributed, scalable time series
database written on top of HBase. The OpenTSDB data source plugin lets Grafana
query and visualize metrics stored in any OpenTSDB-compatible backend.

This repository hosts the standalone OpenTSDB plugin built from `pkg/main.go`
and the frontend in `src/`, distributed through the Grafana plugin catalog.

## Requirements

- Grafana 12.3.0 or later (see `dependencies.grafanaDependency` in
  [`src/plugin.json`](./src/plugin.json)).

## Getting started

For Grafana versions where OpenTSDB is still bundled as a core data source, no
installation is required.

For detailed setup instructions, see the
[OpenTSDB data source documentation](https://grafana.com/docs/grafana/latest/datasources/opentsdb/).

## Issues

Please report bugs and feature requests at
[grafana/grafana-opentsdb-datasource/issues](https://github.com/grafana/grafana-opentsdb-datasource/issues/new).

## Contributing

Follow the
[Grafana plugin development guide](https://grafana.com/developers/plugin-tools/)
for local development. Run `mage -v` to build the backend and `npm run dev`
(or `npm run build`) for the frontend.

## License

This plugin is licensed under the [AGPL-3.0](LICENSE).
