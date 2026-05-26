document.addEventListener("DOMContentLoaded", init);

const C_raster = document.getElementById("C_raster");
const c_raster = C_raster.getContext("2d");
const C_vector = document.getElementById("C_vector");
const c_vector = C_vector.getContext("2d");

const state = {
    gridCDI: null,       // Matrix holding the climate data values
    gridDistrict: null,  // Matching matrix holding District ID integers
    districtMeta: null,  // JSON metadata map (ID -> Name/State)
    
    totalRows: 0, totalCols: 0,
    dataStep: 0.25,
    minVal: 0, maxVal: 1,
    
    base: { lat_W: 68.0, lat_E: 97.5, long_N: 37.0, long_S: 7.0 },
    lat_W: 68.0, lat_E: 97.5, long_N: 37.0, long_S: 7.0,

    margin: { top: 20, right: 20, bottom: 20, left: 20 },
    plotWidth: 0, plotHeight: 0,

    isSelecting: false,
    startSelectX: 0, startSelectY: 0,
    currentSelectX: 0, currentSelectY: 0,

    hoverCoords: null,
    selectedDistrictId: null 
};

async function runQuery(query) {
    try { return await alasql.promise(query); } 
    catch (error) { console.error("SQL Error:", error); return []; }
}

function getOfficialCDIColor(val, minVal, maxVal) {
    const norm = (val - minVal) / (maxVal - minVal || 1);
    if (norm < 0.12) return [115, 0, 0];
    if (norm < 0.25) return [230, 0, 0];
    if (norm < 0.40) return [255, 170, 0];
    if (norm < 0.55) return [255, 255, 0];
    if (norm < 0.75) return [170, 255, 170];
    return [56, 168, 0];
}

// Cleans up database text anomalies (e.g., "GUJAR>T" -> "GUJARAT")
function cleanGISString(str) {
    if (!str) return "Unknown";
    return str.replace(/>/g, 'A').trim();
}

/**
 * Renders the primary CDI map and borders on a single canvas pass
 */
function renderStaticMap() {
    if (!state.gridCDI) return;

    c_raster.fillStyle = "#ffffff";
    c_raster.fillRect(0, 0, C_raster.width, C_raster.height);

    const degWidth = state.lat_E - state.lat_W;
    const degHeight = state.long_N - state.long_S;

    const baseDegWidth = state.base.lat_E - state.base.lat_W;
    const zoomRatio = baseDegWidth / degWidth; 
    let interpolationFactor = Math.min(Math.max(2, Math.round(2 * zoomRatio)), 8); 

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

            // Direct index array checks
            const dID = state.gridDistrict[r][col] || 0;
            const rightID = state.gridDistrict[r][Math.min(col + 1, state.totalCols - 1)] || 0;
            const bottomID = state.gridDistrict[Math.min(r + 1, state.totalRows - 1)][col] || 0;

            for (let ir = 0; ir < interpolationFactor; ir++) {
                const rWeight = ir / interpolationFactor;
                const currentLat = state.base.long_N - ((r + rWeight) * state.dataStep);
                if (currentLat > state.long_N || currentLat < state.long_S) continue;

                for (let ic = 0; ic < interpolationFactor; ic++) {
                    const cWeight = ic / interpolationFactor;
                    const currentLng = state.base.lat_W + ((col + cWeight) * state.dataStep);
                    if (currentLng < state.lat_W || currentLng > state.lat_E) continue;

                    // Interpolate Climate Value
                    const topInterp = validV00 * (1 - cWeight) + validV01 * cWeight;
                    const bottomInterp = validV10 * (1 - cWeight) + validV11 * cWeight;
                    const interpolatedValue = topInterp * (1 - rWeight) + bottomInterp * rWeight;

                    const px = state.margin.left + ((currentLng - state.lat_W) / degWidth) * state.plotWidth;
                    const py = state.margin.top + ((state.long_N - currentLat) / degHeight) * state.plotHeight;

                    // Draw selection highlighting overlay color fills
                    if (state.selectedDistrictId && dID === state.selectedDistrictId) {
                        c_raster.fillStyle = "rgba(0, 223, 255, 0.70)";
                        c_raster.fillRect(px, py, blockWidthPx + 0.3, blockHeightPx + 0.3);
                        continue;
                    }

                    // Otherwise fill default weather canvas
                    const [rgbR, rgbG, rgbB] = getOfficialCDIColor(interpolatedValue, state.minVal, state.maxVal);
                    c_raster.fillStyle = `rgb(${rgbR},${rgbG},${rgbB})`;
                    c_raster.fillRect(px, py, blockWidthPx + 0.3, blockHeightPx + 0.3);

                    // CELLULAR EDGE DETECTION DETECTOR
                    if (dID !== 0) {
                        if (dID !== rightID || dID !== bottomID) {
                            c_raster.fillStyle = "#111111"; // Charcoal line
                            if (dID !== rightID) c_raster.fillRect(px + blockWidthPx, py, 1.2, blockHeightPx + 0.3);
                            if (dID !== bottomID) c_raster.fillRect(px, py + blockHeightPx, blockWidthPx + 0.3, 1.2);
                        }
                    }
                }
            }
        }
    }
}

/**
 * UI OVERLAYS SHEET: Renders tooltips and bounding boxes at 60 FPS
 */
function renderDynamicHUD() {
    c_vector.clearRect(0, 0, C_vector.width, C_vector.height);

    if (state.hoverCoords) {
        c_vector.save();
        c_vector.fillStyle = "rgba(20, 20, 20, 0.95)";
        c_vector.fillRect(state.margin.left + 15, state.margin.top + 15, 290, 95);
        c_vector.strokeStyle = "#444";
        c_vector.strokeRect(state.margin.left + 15, state.margin.top + 15, 290, 95);
        
        c_vector.fillStyle = "#ffffff";
        c_vector.font = "bold 12px monospace";
        c_vector.fillText(`LAT : ${state.hoverCoords.lat.toFixed(4)}°N`, state.margin.left + 30, state.margin.top + 35);
        c_vector.fillText(`LNG : ${state.hoverCoords.lng.toFixed(4)}°E`, state.margin.left + 30, state.margin.top + 50);
        c_vector.fillText(`VAL : ${state.hoverCoords.val !== null ? state.hoverCoords.val.toFixed(3) : "NaN"}`, state.margin.left + 30, state.margin.top + 65);
        
        if (state.hoverCoords.districtName) {
            c_vector.fillStyle = "#00ffcc";
            c_vector.fillText(`DIST: ${cleanGISString(state.hoverCoords.districtName)}`, state.margin.left + 30, state.margin.top + 80);
            c_vector.fillStyle = "#ffff00";
            c_vector.fillText(`STAT: ${cleanGISString(state.hoverCoords.stateName)}`, state.margin.left + 30, state.margin.top + 95);
        }
        c_vector.restore();
    }

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

async function init() {
    C_raster.width = C_vector.width = 840; 
    C_raster.height = C_vector.height = 840;
    state.plotWidth = C_vector.width - state.margin.left - state.margin.right;
    state.plotHeight = C_vector.height - state.margin.top - state.margin.bottom;

    state.totalRows = Math.round((state.base.long_N - state.base.long_S) / state.dataStep) + 1;
    state.totalCols = Math.round((state.base.lat_E - state.base.lat_W) / state.dataStep) + 1;
    
    state.gridCDI = Array(state.totalRows).fill(null).map(() => Array(state.totalCols).fill(null));
    state.gridDistrict = Array(state.totalRows).fill(null).map(() => Array(state.totalCols).fill(0));

    // 1. Fetch weather metrics
    const queryCDI = `
        SELECT CAST([0] AS FLOAT) AS lat, CAST([1] AS FLOAT) AS lng, CAST([2] AS FLOAT) AS val 
        FROM csv('./data/Current_CDI.txt', {headers:false, separator: ' '}) 
        WHERE [0] != 'NaN' AND [1] != 'NaN' AND [2] != 'NaN'
    `;
    const dataCDI = await runQuery(queryCDI);
    dataCDI.forEach(p => {
        const r = Math.round((state.base.long_N - p.lat) / state.dataStep);
        const c = Math.round((p.lng - state.base.lat_W) / state.dataStep);
        if (r >= 0 && r < state.totalRows && c >= 0 && c < state.totalCols) state.gridCDI[r][c] = p.val;
    });
    state.minVal = Math.min(...dataCDI.map(d => d.val));
    state.maxVal = Math.max(...dataCDI.map(d => d.val));

    // 2. Fetch layout boundary metrics matching configuration bounds
    const queryLookup = `
        SELECT CAST([0] AS FLOAT) AS lat, CAST([1] AS FLOAT) AS lng, CAST([2] AS INT) AS id 
        FROM csv('district_lookup.txt', {headers:false, separator: ' '})
    `;
    const dataLookup = await runQuery(queryLookup);
    dataLookup.forEach(p => {
        const r = Math.round((state.base.long_N - p.lat) / state.dataStep);
        const c = Math.round((p.lng - state.base.lat_W) / state.dataStep);
        if (r >= 0 && r < state.totalRows && c >= 0 && c < state.totalCols) state.gridDistrict[r][c] = p.id;
    });

    // 3. Load text structural files map description items
    try {
        const metaRes = await fetch('district_metadata.json');
        state.districtMeta = await metaRes.json();
    } catch(e) { console.error("Metadata JSON failed to load", e); }

    renderStaticMap();
    renderDynamicHUD();

    C_vector.addEventListener("contextmenu", e => e.preventDefault());
    
    C_vector.addEventListener("mousedown", (e) => {
        const rect = C_vector.getBoundingClientRect();
        const x = e.clientX - rect.left - state.margin.left;
        const y = e.clientY - rect.top - state.margin.top;

        if (e.button === 0) { 
            if (x >= 0 && x <= state.plotWidth && y >= 0 && y <= state.plotHeight) {
                const currentDegW = state.lat_E - state.lat_W;
                const currentDegH = state.long_N - state.long_S;
                const currentLng = state.lat_W + (x / state.plotWidth) * currentDegW;
                const currentLat = state.long_N - (y / state.plotHeight) * currentDegH;

                const r = Math.round((state.base.long_N - currentLat) / state.dataStep);
                const c = Math.round((currentLng - state.base.lat_W) / state.dataStep);

                const clampedR = Math.min(Math.max(0, r), state.totalRows - 1);
                const clampedC = Math.min(Math.max(0, c), state.totalCols - 1);

                const clickedID = state.gridDistrict[clampedR]?.[clampedC] || 0;

                if (clickedID > 0) {
                    state.selectedDistrictId = (state.selectedDistrictId === clickedID) ? null : clickedID;
                    renderStaticMap(); 
                } else {
                    state.isSelecting = true;
                    state.startSelectX = e.clientX - rect.left; state.startSelectY = e.clientY - rect.top;
                    state.currentSelectX = state.startSelectX; state.currentSelectY = state.startSelectY;
                }
                renderDynamicHUD();
            }
        } else if (e.button === 2) { 
            state.lat_W = state.base.lat_W; state.lat_E = state.base.lat_E;
            state.long_N = state.base.long_N; state.long_S = state.base.long_S;
            state.selectedDistrictId = null;
            renderStaticMap();
            renderDynamicHUD();
        }
    });

    window.addEventListener("mousemove", (e) => {
        const rect = C_vector.getBoundingClientRect();
        const x = e.clientX - rect.left - state.margin.left;
        const y = e.clientY - rect.top - state.margin.top;

        if (x >= 0 && x <= state.plotWidth && y >= 0 && y <= state.plotHeight) {
            const currentDegW = state.lat_E - state.lat_W;
            const currentDegH = state.long_N - state.long_S;
            const currentLng = state.lat_W + (x / state.plotWidth) * currentDegW;
            const currentLat = state.long_N - (y / state.plotHeight) * currentDegH;

            const r = Math.round((state.base.long_N - currentLat) / state.dataStep);
            const c = Math.round((currentLng - state.base.lat_W) / state.dataStep);

            const clampedR = Math.min(Math.max(0, r), state.totalRows - 1);
            const clampedC = Math.min(Math.max(0, c), state.totalCols - 1);

            const dID = state.gridDistrict[clampedR]?.[clampedC] || 0;
            const val = state.gridCDI[clampedR]?.[clampedC] ?? null;

            state.hoverCoords = { lat: currentLat, lng: currentLng, val: val, districtName: null, stateName: null };

            if (dID > 0 && state.districtMeta?.[dID]) {
                state.hoverCoords.districtName = state.districtMeta[dID].name;
                state.hoverCoords.stateName = state.districtMeta[dID].state;
            }
        } else { state.hoverCoords = null; }

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

    C_vector.addEventListener("mouseleave", () => { state.hoverCoords = null; renderDynamicHUD(); });
}