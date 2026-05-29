document.addEventListener("DOMContentLoaded", init);

// Canvas contexts
const C_raster = document.getElementById("C_raster");
const c_raster = C_raster.getContext("2d");
const C_vector = document.getElementById("C_vector");
const c_vector = C_vector.getContext("2d");

// Application Configuration and State
const state = {
    gridCDI: null,       // Matrix holding the climate data values
    totalRows: 0, 
    totalCols: 0,
    dataStep: 0.25,
    minVal: 0, 
    maxVal: 1,
    
    // Geographic Boundaries (Base Reference)
    base: { lat_W: 68.0, lat_E: 97.5, long_N: 37.0, long_S: 7.0 },
    
    // Current Viewport Boundaries (Changes on Zoom)
    lat_W: 68.0, lat_E: 97.5, long_N: 37.0, long_S: 7.0,

    // Layout dimensions
    margin: { top: 20, right: 20, bottom: 20, left: 20 },
    plotWidth: 0, 
    plotHeight: 0,

    // Drag-to-Zoom Selection Box State
    isSelecting: false,
    startSelectX: 0, startSelectY: 0,
    currentSelectX: 0, currentSelectY: 0,

    hoverCoords: null,

    gridState: null,
    stateStep: 0.0625,
    stateRows: 0,
    stateCols: 0,
};

/**
 * Executes an AlaSQL query to parse target database files safely
 */
async function runQuery(query) {
    try { 
        return await alasql.promise(query); 
    } catch (error) { 
        console.error("SQL Error:", error); 
        return []; 
    }
}

/**
 * Translates a normalized CDI value into its corresponding official standard RGB color
 */
function getOfficialCDIColor(val, minVal, maxVal) {
    const norm = (val - minVal) / (maxVal - minVal || 1);
    if (norm < 0.12) return [115, 0, 0];
    if (norm < 0.25) return [230, 0, 0];
    if (norm < 0.40) return [255, 170, 0];
    if (norm < 0.55) return [255, 255, 0];
    if (norm < 0.75) return [170, 255, 170];
    return [56, 168, 0];
}

/**
 * Handles state boundary and ID acquisition and sets matrix values
 */
async function loadStateData() {
    const queryState = `
        SELECT CAST([lat] AS FLOAT) AS lat, CAST([lng] AS FLOAT) AS lng, CAST([value] AS INT) AS val 
        FROM csv('./states_with_boundaries.csv', {headers:true, separator:','}) 
        WHERE CAST([value] AS INT) >= 1
    `;
    const dataState = await runQuery(queryState);
    
    dataState.forEach(p => {
        const r = Math.round((state.base.long_N - p.lat) / state.stateStep);
        const c = Math.round((p.lng - state.base.lat_W) / state.stateStep);
        if (r >= 0 && r < state.stateRows && c >= 0 && c < state.stateCols) {
            state.gridState[r][c] = p.val;
        }
    });
}

/**
 * Converts screen pixel coordinates into coordinate degrees (Lat/Lng)
 */
function screenToGeo(x, y) {
    const degWidth = state.lat_E - state.lat_W;
    const degHeight = state.long_N - state.long_S;
    const lng = state.lat_W + (x / state.plotWidth) * degWidth;
    const lat = state.long_N - (y / state.plotHeight) * degHeight;
    return { lat, lng };
}

/**
 * Matches real-world spatial coordinates to data matrix row/column grid indexes
 */
function geoToGridIndices(lat, lng) {
    const r = Math.round((state.base.long_N - lat) / state.dataStep);
    const c = Math.round((lng - state.base.lat_W) / state.dataStep);
    const clampedR = Math.min(Math.max(0, r), state.totalRows - 1);
    const clampedC = Math.min(Math.max(0, c), state.totalCols - 1);
    return { r: clampedR, c: clampedC };
}

/**
 * Resets map scale parameters back to default broad configuration bounds
 */
function resetZoom() {
    state.lat_W = state.base.lat_W; 
    state.lat_E = state.base.lat_E;
    state.long_N = state.base.long_N; 
    state.long_S = state.base.long_S;
    renderStaticMap();
    renderDynamicHUD();
}

/**
 * Renders the primary CDI heat map layer on the raster canvas
 */
function renderStaticMap() {
    if (!state.gridCDI) return;

    c_raster.fillStyle = "#ffffff";
    c_raster.fillRect(0, 0, C_raster.width, C_raster.height);

    const degWidth = state.lat_E - state.lat_W;
    const degHeight = state.long_N - state.long_S;

    const baseDegWidth = state.base.lat_E - state.base.lat_W;
    const zoomRatio = baseDegWidth / degWidth; 
    // const interpolationFactor = Math.min(Math.max(2, Math.round(2 * zoomRatio)), 8); 
    const interpolationFactor = Math.min(Math.max(4, Math.round(4 * zoomRatio)), 16);
    
    const stepSizeDeg = state.dataStep / interpolationFactor;
    const blockWidthPx = (stepSizeDeg / degWidth) * state.plotWidth;
    const blockHeightPx = (stepSizeDeg / degHeight) * state.plotHeight;

    for (let r = 0; r < state.totalRows - 1; r++) {
        for (let col = 0; col < state.totalCols - 1; col++) {
            
            const v00 = state.gridCDI[r][col];
            const v01 = state.gridCDI[r][col + 1] ?? v00;
            const v10 = state.gridCDI[r + 1][col] ?? v00;
            const v11 = state.gridCDI[r + 1][col + 1] ?? v01 ?? v10;

            if (v00 === null && v01 === null && v10 === null && v11 === null) continue;

            const validV00 = v00 ?? v01 ?? v10 ?? v11;
            const validV01 = v01 ?? validV00;
            const validV10 = v10 ?? validV00;
            const validV11 = v11 ?? validV01 ?? validV10;

            for (let ir = 0; ir < interpolationFactor; ir++) {
                const rWeight = ir / interpolationFactor;
                const currentLat = state.base.long_N - ((r + rWeight) * state.dataStep);
                if (currentLat > state.long_N || currentLat < state.long_S) continue;

                for (let ic = 0; ic < interpolationFactor; ic++) {
                    const cWeight = ic / interpolationFactor;
                    const currentLng = state.base.lat_W + ((col + cWeight) * state.dataStep);
                    if (currentLng < state.lat_W || currentLng > state.lat_E) continue;

                    // Bilinear Interpolation of Climate Value
                    const topInterp = validV00 * (1 - cWeight) + validV01 * cWeight;
                    const bottomInterp = validV10 * (1 - cWeight) + validV11 * cWeight;
                    const interpolatedValue = topInterp * (1 - rWeight) + bottomInterp * rWeight;

                    const px = state.margin.left + ((currentLng - state.lat_W) / degWidth) * state.plotWidth;
                    const py = state.margin.top + ((state.long_N - currentLat) / degHeight) * state.plotHeight;

                    const [rgbR, rgbG, rgbB] = getOfficialCDIColor(interpolatedValue, state.minVal, state.maxVal);
                    c_raster.fillStyle = `rgb(${rgbR},${rgbG},${rgbB})`;
                    c_raster.fillRect(px, py, blockWidthPx + 0.3, blockHeightPx + 0.3);
                }
            }
        }
    }

// Render State Boundaries directly onto c_raster
    if (!state.gridState) return;

    c_raster.fillStyle = "#000000"; // Black color for the circular points
    
    // Choose your thickness here (e.g., 1 for ultra-thin, 1.5 for slightly more visible)
    const circleRadius = 1; 

    for (let r = 0; r < state.stateRows; r++) {
        const currentLat = state.base.long_N - (r * state.stateStep);
        if (currentLat > state.long_N || currentLat < state.long_S) continue;

        for (let c = 0; c < state.stateCols; c++) {
            if (state.gridState[r][c] === 1) { // 1 indicates boundary block
                const currentLng = state.base.lat_W + (c * state.stateStep);
                if (currentLng < state.lat_W || currentLng > state.lat_E) continue;

                // Target center point coordinates for the shape
                const px = state.margin.left + ((currentLng - state.lat_W) / degWidth) * state.plotWidth;
                const py = state.margin.top + ((state.long_N - currentLat) / degHeight) * state.plotHeight;

                // Draw a circle instead of a rectangle
                c_raster.beginPath();
                c_raster.arc(px, py, circleRadius, 0, 2 * Math.PI);
                c_raster.fill();
            }
        }
    }
}

/**
 * Renders spatial context overlays (Tooltips & Zoom Box) on the vector layer
 */
function renderDynamicHUD() {
    c_vector.clearRect(0, 0, C_vector.width, C_vector.height);

    // Inside renderDynamicHUD() where tooltips are rendered:
    if (state.hoverCoords) {
        c_vector.save();
        c_vector.fillStyle = "rgba(20, 20, 20, 0.95)";
        c_vector.fillRect(state.margin.left + 15, state.margin.top + 15, 200, 80); // Height expanded to 80
        c_vector.strokeStyle = "#534d4d";
        c_vector.strokeRect(state.margin.left + 15, state.margin.top + 15, 200, 80); // Height expanded to 80
        
        c_vector.fillStyle = "#ffffff";
        c_vector.font = "bold 12px monospace";
        c_vector.fillText(`LAT : ${state.hoverCoords.lat.toFixed(4)}°N`, state.margin.left + 30, state.margin.top + 35);
        c_vector.fillText(`LNG : ${state.hoverCoords.lng.toFixed(4)}°E`, state.margin.left + 30, state.margin.top + 50);
        c_vector.fillText(`VAL : ${state.hoverCoords.val !== null ? state.hoverCoords.val.toFixed(3) : "NaN"}`, state.margin.left + 30, state.margin.top + 65);
        
        // Display the state ID only if it represents an actual area (> 1)
        const displayState = state.hoverCoords.stateId && state.hoverCoords.stateId > 1 ? state.hoverCoords.stateId : "N/A";
        c_vector.fillText(`STATE: ${displayState}`, state.margin.left + 30, state.margin.top + 80);
        
        c_vector.restore();
    }

    // Render Active Zoom Box Visualizer Canvas Boundary Window Frame
    if (state.isSelecting) {
        c_vector.save();
        c_vector.strokeStyle = "#0055ff";
        c_vector.lineWidth = 1.5;
        c_vector.setLineDash([4, 4]);
        c_vector.fillStyle = "rgba(0, 85, 255, 0.1)";
        const rectW = state.currentSelectX - state.startSelectX;
        const rectH = state.currentSelectY - state.startSelectY;
        c_vector.fillRect(state.startSelectX, state.startSelectY, rectW, rectH);
        c_vector.strokeRect(state.startSelectX, state.startSelectY, rectW, rectH);
        c_vector.restore();
    }
}

/**
 * Handles dataset CSV acquisition and sets matrix values
 */
async function loadCDIData() {
    const queryCDI = `
        SELECT CAST([0] AS FLOAT) AS lat, CAST([1] AS FLOAT) AS lng, CAST([2] AS FLOAT) AS val 
        FROM csv('./data/Current_CDI.txt', {headers:false, separator: ' '}) 
        WHERE [0] != 'NaN' AND [1] != 'NaN' AND [2] != 'NaN'
    `;
    const dataCDI = await runQuery(queryCDI);
    
    dataCDI.forEach(p => {
        const r = Math.round((state.base.long_N - p.lat) / state.dataStep);
        const c = Math.round((p.lng - state.base.lat_W) / state.dataStep);
        if (r >= 0 && r < state.totalRows && c >= 0 && c < state.totalCols) {
            state.gridCDI[r][c] = p.val;
        }
    });

    if (dataCDI.length > 0) {
        state.minVal = Math.min(...dataCDI.map(d => d.val));
        state.maxVal = Math.max(...dataCDI.map(d => d.val));
    }
}

/**
 * Binds mouse interactions to canvas operations
 */
function setupEventListeners() {
    C_vector.addEventListener("contextmenu", e => e.preventDefault());
    
    C_vector.addEventListener("mousedown", (e) => {
        const rect = C_vector.getBoundingClientRect();
        const x = e.clientX - rect.left - state.margin.left;
        const y = e.clientY - rect.top - state.margin.top;

        if (e.button === 0) { // Left-click triggers bounding box zoom initialization
            if (x >= 0 && x <= state.plotWidth && y >= 0 && y <= state.plotHeight) {
                state.isSelecting = true;
                state.startSelectX = e.clientX - rect.left; 
                state.startSelectY = e.clientY - rect.top;
                state.currentSelectX = state.startSelectX; 
                state.currentSelectY = state.startSelectY;
                renderDynamicHUD();
            }
        } else if (e.button === 2) { // Right click completely clears viewport zoom scaling
            resetZoom();
        }
    });

    window.addEventListener("mousemove", (e) => {
        const rect = C_vector.getBoundingClientRect();
        const x = e.clientX - rect.left - state.margin.left;
        const y = e.clientY - rect.top - state.margin.top;

        if (x >= 0 && x <= state.plotWidth && y >= 0 && y <= state.plotHeight) {
            const { lat, lng } = screenToGeo(x, y);
            const { r, c } = geoToGridIndices(lat, lng);
            const val = state.gridCDI[r]?.[c] ?? null;
            
            // Calculate corresponding indices for the state grid
            const sR = Math.round((state.base.long_N - lat) / state.stateStep);
            const sC = Math.round((lng - state.base.lat_W) / state.stateStep);
            const stateId = state.gridState?.[sR]?.[sC] ?? null;

            state.hoverCoords = { lat, lng, val, stateId };
        } else { 
            state.hoverCoords = null; 
        }

        if (state.isSelecting) {
            state.currentSelectX = Math.max(state.margin.left, Math.min(e.clientX - rect.left, state.margin.left + state.plotWidth));
            state.currentSelectY = Math.max(state.margin.top, Math.min(e.clientY - rect.top, state.margin.top + state.plotHeight));
        }
        renderDynamicHUD();
    });

    window.addEventListener("mouseup", () => {
        if (!state.isSelecting) return;
        state.isSelecting = false;

        const xMinPx = Math.min(state.startSelectX, state.currentSelectX) - state.margin.left;
        const xMaxPx = Math.max(state.startSelectX, state.currentSelectX) - state.margin.left;
        const yMinPx = Math.min(state.startSelectY, state.currentSelectY) - state.margin.top;
        const yMaxPx = Math.max(state.startSelectY, state.currentSelectY) - state.margin.top;

        // Perform programmatic coordinate re-clipping if drawn field meets minimum resolution 
        if ((xMaxPx - xMinPx) > 10 && (yMaxPx - yMinPx) > 10) {
            const currentDegW = state.lat_E - state.lat_W;
            const currentDegH = state.long_N - state.long_S;

            state.lat_W = state.lat_W + (xMinPx / state.plotWidth) * currentDegW;
            state.lat_E = state.lat_W + (xMaxPx / state.plotWidth) * currentDegW;
            state.long_N = state.long_N - (yMinPx / state.plotHeight) * currentDegH;
            state.long_S = state.long_N - (yMaxPx / state.plotHeight) * currentDegH;
            
            renderStaticMap();
        }
        renderDynamicHUD();
    });

    C_vector.addEventListener("mouseleave", () => { 
        state.hoverCoords = null; 
        renderDynamicHUD(); 
    });
}

/**
 * Main Orchestrator Function
 */
async function init() {
    // Canvas dimensions setup
    C_raster.width = C_vector.width = 840; 
    C_raster.height = C_vector.height = 840;
    state.plotWidth = C_vector.width - state.margin.left - state.margin.right;
    state.plotHeight = C_vector.height - state.margin.top - state.margin.bottom;

    // Calculation of grid resolution layout size parameters
    state.totalRows = Math.round((state.base.long_N - state.base.long_S) / state.dataStep) + 1;
    state.totalCols = Math.round((state.base.lat_E - state.base.lat_W) / state.dataStep) + 1;
    
    // Allocate matrix arrays
    state.gridCDI = Array(state.totalRows).fill(null).map(() => Array(state.totalCols).fill(null));

    state.stateRows = Math.round((state.base.long_N - state.base.long_S) / state.stateStep) + 1;
    state.stateCols = Math.round((state.base.lat_E - state.base.lat_W) / state.stateStep) + 1;
    state.gridState = Array(state.stateRows).fill(null).map(() => Array(state.stateCols).fill(null));

    // Execute setup components
    await loadCDIData();
    await loadStateData();
    setupEventListeners();

    // Perform initial display paint operations
    renderStaticMap();
    renderDynamicHUD();
}