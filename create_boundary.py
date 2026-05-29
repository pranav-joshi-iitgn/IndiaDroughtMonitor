import geopandas as gpd
import pandas as pd
import matplotlib.pyplot as plt

# 1. Load the India GeoJSON boundary file
print("Loading India boundaries...")
gdf = gpd.read_file("india-soi.geojson")

# 2. Extract the MultiPolygon geometry from the first row
multipolygon = gdf.geometry.iloc[0]

# 3. Find the largest individual polygon by area (isolates the mainland)
mainland_polygon = max(multipolygon.geoms, key=lambda poly: poly.area)

# 4. Extract the exterior boundary coordinates
lng_lat_coords = list(mainland_polygon.exterior.coords)

# 5. Create a DataFrame and write it to a CSV file
# Reordering columns to standard (lat, lng) format for your web application
df = pd.DataFrame(lng_lat_coords, columns=["lng", "lat"])
df = df[["lat", "lng"]] 

df.to_csv("india_mainland_boundary.csv", index=False)
print(f"Successfully saved {len(df)} points to 'india_mainland_boundary.csv'")

# 6. Generate a verification plot using matplotlib
# Longitude serves as the X-axis and Latitude as the Y-axis
plt.plot(df["lng"], df["lat"], color="black", linewidth=1.5)

plt.title("Mainland India Boundary Verification", fontsize=14, fontweight="bold")
plt.xlabel("Longitude (°E)")
plt.ylabel("Latitude (°N)")

# Crucial: Ensures a 1:1 aspect ratio so India's geometry is not stretched or distorted
plt.axis("equal")  
plt.grid(True, linestyle="--", alpha=0.5)
plt.tight_layout()

# Save the plot out as an image file to check correctness
plt.savefig("india_boundary_verification.png", dpi=300)
print("Verification plot saved to 'india_boundary_verification.png'")