# THE FUN MAP - Global Monitoring System

An interactive global monitoring application combining satellite imagery, active fire detection, and conflict event data for comprehensive situational awareness. Styled with an original 2001 Xbox aesthetic.

## Features

### Data Layers
- **Sentinel-2 Optical Imagery** — True Color RGB, False Color (vegetation), NDVI, NDWI visualizations with side-by-side comparison mode
- **Sentinel-1 SAR Imagery** — VV, VH, VV/VH ratio polarizations with comparison mode and dB threshold-based change detection
- **NASA FIRMS Active Fires** — VIIRS S-NPP, VIIRS NOAA-20, MODIS near real-time fire detections colored by confidence, FRP, or brightness
- **Conflict Events** — UCDP GED (no API key required) and ACLED data with event type and fatality filtering

### Tools & Features
- **Date Filtering** — Global date range filter applied across all data layers
- **Sentinel Comparison** — Side-by-side synced maps for comparing two dates with different visualizations
- **SAR Change Detection** — Sentinel-1 change detection with adjustable dB threshold (red = increase, blue = decrease)
- **User Pins & Notes** — Place, edit, drag, and categorize pins with notes; export/import as JSON
- **Location Search** — Geocoding via Nominatim or direct coordinate input
- **Measurement Tool** — Distance and area measurement on the map
- **Multiple Base Maps** — Dark, Satellite, Street, and Terrain base layers

### Zoom-Dependent Layers
Sentinel-2 and Sentinel-1 layers only appear when zoomed in to level 10+ (configurable in Settings) to manage processing load.

## Setup

### 1. Open the App
Simply open `index.html` in a modern web browser. No build step or server required.

### 2. Configure API Keys
Click the **Settings** (gear icon) in the top-right to enter your API credentials:

#### Copernicus Data Space (Sentinel-2 & Sentinel-1)
1. Register at [dataspace.copernicus.eu](https://dataspace.copernicus.eu)
2. Go to your User Settings Dashboard
3. Create OAuth2 client credentials
4. Enter the Client ID and Client Secret in Settings

#### NASA FIRMS (Active Fires)
1. Register for a free MAP Key at [firms.modaps.eosdis.nasa.gov/api/map_key/](https://firms.modaps.eosdis.nasa.gov/api/map_key/)
2. Enter the key in Settings

#### ACLED (Conflict Data — Optional)
1. Register at [acleddata.com/access/](https://acleddata.com/access/)
2. Enter your API key and registered email in Settings
3. Note: UCDP data works without any API key

### 3. Enable Layers
Toggle data layers on/off in the sidebar. Adjust visualization options, filters, and settings for each layer.

## Data Sources

| Source | Provider | Auth Required |
|--------|----------|---------------|
| Sentinel-2 L2A | Copernicus Data Space Ecosystem | Yes (OAuth2) |
| Sentinel-1 GRD | Copernicus Data Space Ecosystem | Yes (OAuth2) |
| Active Fires | NASA FIRMS (VIIRS/MODIS) | Yes (free MAP key) |
| Conflict Events | UCDP GED (Uppsala University) | No |
| Conflict Events | ACLED | Yes (free registration) |
| Base Maps | OpenStreetMap / ESRI / CartoDB / OpenTopoMap | No |
| Geocoding | OpenStreetMap Nominatim | No |

## User Pins

- **Right-click** the map or click **+ PIN** to place a pin
- Pins support title, notes, category, and custom colors
- Drag pins to reposition them
- Toggle pin visibility in the sidebar
- Export/import pins as JSON for backup or sharing

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Esc` | Close open panels/modals |

## Browser Support
Modern browsers with ES6+ support (Chrome, Firefox, Edge, Safari).

## Technologies
- [Leaflet](https://leafletjs.com/) — Interactive mapping
- [Copernicus Sentinel Hub Process API](https://documentation.dataspace.copernicus.eu/) — Satellite imagery
- [NASA FIRMS API](https://firms.modaps.eosdis.nasa.gov/api/) — Fire data
- [UCDP API](https://ucdp.uu.se/apidocs/) — Conflict data
- [Nominatim](https://nominatim.openstreetmap.org/) — Geocoding

## License
For educational and research purposes. Satellite data is provided under Copernicus open access terms. Conflict data is subject to respective provider terms.
