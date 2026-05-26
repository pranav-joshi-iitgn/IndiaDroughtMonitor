import geopandas as gpd

print("--- SHAPEFILE DIAGNOSTICS ---")
gdf = gpd.read_file("DISTRICT_BOUNDARY_WGS1984.shp")

print(f"Total features found: {len(gdf)}")
print(f"Current CRS: {gdf.crs}")

# Print out the bounding box coordinates of the entire layer
bounds = gdf.total_bounds
print(f"Shapefile Bounding Box: MinX={bounds[0]:.2f}, MinY={bounds[1]:.2f}, MaxX={bounds[2]:.2f}, MaxY={bounds[3]:.2f}")

print("\n--- FIRST 3 ROWS SAMPLE ---")
print(gdf[['DISTRICT', 'geometry']].head(3) if 'DISTRICT' in gdf.columns else gdf.head(3))