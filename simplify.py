import geopandas as gpd
import numpy as np
from shapely.geometry import Point
from scipy.spatial import cKDTree
import json
import time

start_time = time.time()

print("1. Loading Shapefile...")
gdf = gpd.read_file("DISTRICT_BOUNDARY_WGS1984.shp")
gdf['district_idx'] = range(1, len(gdf) + 1)

# Extract metric geometric boundaries directly from the file
bounds = gdf.total_bounds
sh_minx, sh_miny, sh_maxx, sh_maxy = bounds[0], bounds[1], bounds[2], bounds[3]

print(f"Shapefile internal metric boundaries:\n X: {sh_minx:.2f} to {sh_maxx:.2f}\n Y: {sh_miny:.2f} to {sh_maxy:.2f}")

# Map names and attributes to metadata
metadata_mapping = {}
for _, row in gdf.iterrows():
    dist_name = row.get('District', row.get('DISTRICT', 'Unknown'))
    state_name = row.get('STATE', row.get('state', 'Unknown'))
    metadata_mapping[int(row['district_idx'])] = {
        "name": str(dist_name),
        "state": str(state_name)
    }

with open("district_metadata.json", "w") as f:
    json.dump(metadata_mapping, f)

# Compute the geometric center (centroids) of every district polygon in metric space
print("Building fast spatial centroid matrix...")
centroids = np.array([[geom.centroid.x, geom.centroid.y] for geom in gdf.geometry])
# Create a KDTree map for near-instant geometric point lookups
tree = cKDTree(centroids)

# Define target degree framework mapping matching the CDI file parameters
lat_start, lat_end = 37.0, 7.0   
lng_start, lng_end = 68.0, 97.5  
step = 0.25

lats = np.arange(lat_start, lat_end - (step / 2), -step)
lngs = np.arange(lng_start, lng_end + (step / 2), step)

print("\n2. Transforming matrices and mapping land cells...")
match_count = 0
total_count = 0

with open("district_lookup.txt", "w") as f:
    for lat in lats:
        for lng in lngs:
            total_count += 1
            
            # Linear Interpolation: Safely project the degree point into the shapefile's metric grid space
            # Maps longitude (68.0 to 97.5) to metric X
            metric_x = sh_minx + ((lng - 68.0) / (97.5 - 68.0)) * (sh_maxx - sh_minx)
            # Maps latitude (7.0 to 37.0) to metric Y
            metric_y = sh_miny + ((lat - 7.0) / (37.0 - 7.0)) * (sh_maxy - sh_miny)
            
            # Establish basic containment check boundaries 
            # (Rough filter: Only look up inside India's general geographic box space)
            if 7.5 <= lat <= 36.0 and 68.5 <= lng <= 97.0:
                # Instantly query the KDTree to find the closest district centroid index position
                distance, nearest_idx = tree.query([metric_x, metric_y])
                
                # Assign unique ID mapping match code
                district_id = int(gdf.iloc[nearest_idx]['district_idx'])
                match_count += 1
            else:
                district_id = 0
                
            f.write(f"{lat:.2f} {lng:.2f} {district_id}\n")

end_time = time.time()
print(f"\nSuccess! Processed {total_count} cells in {end_time - start_time:.2f} seconds.")
print(f"Successfully mapped {match_count} land cells directly to district metrics.")