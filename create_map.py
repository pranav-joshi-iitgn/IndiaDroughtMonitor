import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import json
import pandas as pd
from shapely.geometry import Point
from matplotlib.colors import ListedColormap

# ============================================================
# 1. Load India boundaries
# ============================================================

print("Loading India boundaries...")

try:
    # gdf = gpd.read_file("india_states.json")
    gdf = gpd.read_file("states.geojson")
except Exception as e:
    print(f"Failed to load map data: {e}")
    exit()

gdf["geometry"] = gdf["geometry"].make_valid()

# Keep valid geometries only
gdf = gdf[gdf.geometry.notnull()]
gdf = gdf[gdf.is_valid]

# ------------------------------------------------------------
# IMPORTANT:
# 0 = outside India
# 1 = state boundary
# 2+ = state IDs
# ------------------------------------------------------------

gdf["state_id"] = range(2, len(gdf) + 2)

print(f"Loaded {len(gdf)} states.")

# ============================================================
# 2. Define raster grid
# ============================================================

# STEP = 0.125
STEP = 0.0625  # Lowered from 0.125 to double the resolution density

min_lng, max_lng = 68.0, 98.0
min_lat, max_lat = 6.0, 38.0

lng_axis = np.arange(min_lng, max_lng, STEP)
lat_axis = np.arange(min_lat, max_lat, STEP)

print(f"Grid size: {len(lat_axis)} x {len(lng_axis)}")

# Raster bitmap
grid = np.zeros((len(lat_axis), len(lng_axis)), dtype=np.int16)

# ============================================================
# 3. Generate grid points
# ============================================================

print("Generating grid points...")

point_records = []
geometries = []
index_lookup = {}

for i, lat in enumerate(lat_axis):

    if i % 10 == 0:
        print(f"Row {i+1}/{len(lat_axis)}")

    for j, lng in enumerate(lng_axis):

        point_records.append((lat, lng))
        geometries.append(Point(lng, lat))

        index_lookup[(lat, lng)] = (i, j)

# ============================================================
# 4. Create point GeoDataFrame
# ============================================================

points_gdf = gpd.GeoDataFrame(
    point_records,
    columns=["lat", "lng"],
    geometry=geometries,
    crs=gdf.crs
)

# ============================================================
# 5. Fill states using spatial join
# ============================================================

print("Rasterizing states...")

joined = gpd.sjoin(
    points_gdf,
    gdf[["state_id", "geometry"]],
    predicate="within",
    how="left"
)

joined["state_id"] = joined["state_id"].fillna(0).astype(int)

# Fill raster
for _, row in joined.iterrows():

    lat = row["lat"]
    lng = row["lng"]
    state_id = row["state_id"]

    i, j = index_lookup[(lat, lng)]

    grid[i, j] = state_id

# ============================================================
# 6. Rasterize boundaries
# ============================================================

print("Rasterizing boundaries...")

# Boundary thickness in degrees
# Smaller = thinner lines
# BOUNDARY_THRESHOLD = STEP * 0.55
BOUNDARY_THRESHOLD = STEP * 0.45  # Reduced from 0.55 for sharper boundary tracking

for _, state in gdf.iterrows():

    boundary = state.geometry.boundary

    # Fast bounding-box prefilter
    minx, miny, maxx, maxy = boundary.bounds

    for i, lat in enumerate(lat_axis):

        if lat < miny - STEP or lat > maxy + STEP:
            continue

        for j, lng in enumerate(lng_axis):

            if lng < minx - STEP or lng > maxx + STEP:
                continue

            point = Point(lng, lat)

            # Distance to state boundary
            if boundary.distance(point) < BOUNDARY_THRESHOLD:

                # Mark boundary
                grid[i, j] = 1

# ============================================================
# 7. Save CSV
# ============================================================

print("Saving CSV...")

rows = []

for i, lat in enumerate(lat_axis):
    for j, lng in enumerate(lng_axis):

        rows.append((
            lat,
            lng,
            int(grid[i, j])
        ))

df = pd.DataFrame(
    rows,
    columns=["lat", "lng", "value"]
)

df.to_csv("states_with_boundaries.csv", index=False)

print("Saved: states_with_boundaries.csv")

# ============================================================
# 7.5. Extract and Save Vector Boundaries as Sequences (JSON)
# ============================================================

print("Extracting vector boundaries for JSON path serialization...")

all_paths = []

for _, row in gdf.iterrows():
    geom = row.geometry
    
    # Handle both standard Polygon and complex MultiPolygon shapes cleanly
    polys = [geom] if geom.geom_type == 'Polygon' else geom.geoms
    
    for poly in polys:
        # Extract the continuous exterior coordinate ring
        coords = list(poly.exterior.coords)
        
        # Build an explicit lat/lng sequence path array for the JS runtime
        path = [{"lat": lat, "lng": lng} for lng, lat in coords]
        # all_paths.append(path)
        all_paths.append({
            "state_id": int(row["state_id"]),
            "name": str(row["ST_NM"]),
            "coordinates": path
        })

# Write out the structural coordinates sequence to its own file
with open("state_vector_boundaries.json", "w") as f:
    json.dump(all_paths, f)

print(f"Saved: state_vector_boundaries.json ({len(all_paths)} paths extracted)")

# ============================================================
# 7.6. Verify Extracted Vector Sequences (Validation Plot)
# ============================================================

print("Generating vector sequence validation plot...")

# Set up a clean plot area mirroring geographic orientation
fig, ax = plt.subplots(figsize=(10, 11))

# Loop over the raw sequence dictionary objects exactly as formatted for the JSON file
for path_idx, path in enumerate(all_paths):
    # Unpack the coordinate objects into sequential arrays
    lngs = [point["lng"] for point in path]
    lats = [point["lat"] for point in path]
    
    # Plot each isolated sequence path with an independent color
    # This immediately catches if any lines cross cross-country or stretch incorrectly
    ax.plot(lngs, lats, linewidth=1.2, alpha=0.85)

ax.set_title(
    f"Vector Sequences Verification Map\n(Successfully Verified {len(all_paths)} Paths)", 
    fontsize=13, 
    fontweight="bold"
)
ax.set_xlabel("Longitude")
ax.set_ylabel("Latitude")
ax.grid(True, linestyle="--", alpha=0.5)
ax.set_aspect('equal') # Absolute critical constraint to prevent aspect-stretching

print("Displaying vector path verification map window...")
plt.show()

# ============================================================
# 8. Display raster map
# ============================================================

print("Displaying map...")

# ------------------------------------------------------------
# Build color table
# ------------------------------------------------------------

max_state_id = grid.max()

colors = []

# 0 -> outside India
colors.append("#000000")

# 1 -> boundary
colors.append("#FFFFFF")

# Generate enough unique colors for ALL states
state_colors = plt.cm.tab20(
    np.linspace(0, 1, max_state_id)
)

for c in state_colors:
    colors.append(c)

cmap = ListedColormap(colors)

# ------------------------------------------------------------
# Plot
# ------------------------------------------------------------

plt.figure(figsize=(10, 11))

plt.imshow(
    grid,
    cmap=cmap,
    extent=[min_lng, max_lng, min_lat, max_lat],
    interpolation="nearest",
    origin="lower",
    vmin=0,
    vmax=len(colors) - 1,
)

plt.title(
    "India Raster Grid with Boundaries",
    fontsize=14,
    fontweight="bold"
)

plt.xlabel("Longitude")
plt.ylabel("Latitude")

plt.grid(True, linestyle=":", alpha=0.4)

plt.tight_layout()

plt.show()

