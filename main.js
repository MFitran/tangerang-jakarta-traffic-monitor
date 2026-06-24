window.envConfig = {
    SUPABASE_URL: "https://wwapndvliynmdeejtryz.supabase.co",
    SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3YXBuZHZsaXlubWRlZWp0cnl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNDk0NDgsImV4cCI6MjA5NjYyNTQ0OH0.ec9X_hPU-YoflTCJkTwKJzXygW3qC3dYYWUFQkiiQrM"
};

window.getSupabaseClient = function() {
    if (window.supabaseClient) return window.supabaseClient;
    if (!window.supabase || !window.envConfig?.SUPABASE_URL || !window.envConfig?.SUPABASE_KEY) {
        return null;
    }
    window.supabaseClient = window.supabase.createClient(window.envConfig.SUPABASE_URL, window.envConfig.SUPABASE_KEY);
    return window.supabaseClient;
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Map Canvas centered over the core highway corridor
    const map = L.map('traffic-map', {
        zoomControl: true,
        attributionControl: false
    }).setView([-6.1950, 106.7200], 12); 

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(map);

    const trafficVectorGroup = L.layerGroup().addTo(map);

    async function streamLiveTrafficMatrix() {
        try {
            const client = window.getSupabaseClient();
            if (!client) throw new Error("Supabase authenticated initialization matrix failed.");

            // Download snapshot payload directly from your storage bucket
            const { data, error } = await client
                .storage
                .from('jakarta-traffic-data')
                .download('latest_traffic.json');

            if (error) {
                if (error.statusCode === "404" || error.message.includes("not found")) {
                    console.warn("Telemetry file not found in bucket. Awaiting initial Python run...");
                    document.getElementById('traffic-nodes-container').innerHTML = 
                        '<div class="loading-state" style="color: #F9AB00; padding: 20px; text-align: center;">Awaiting initial script execution...</div>';
                    return;
                }
                throw error;
            }

            const textContent = await data.text();
            const records = JSON.parse(textContent);

            const panel = document.getElementById('traffic-nodes-container');
            panel.innerHTML = '';
            trafficVectorGroup.clearLayers();

            if (!records || records.length === 0) {
                panel.innerHTML = '<div class="loading-state">Zero dataset entries extracted.</div>';
                return;
            }

            // Sort sequentially (01 to 10) for UI side-panel alignment
            records.sort((x, y) => x.road_name.localeCompare(y.road_name));
            
            const lastUpdate = records[0].fetched_at;
            const clock = lastUpdate ? new Date(lastUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';
            document.getElementById('last-update-tag').innerText = `UPDATED AT ${clock} WIB`;

            // 🚀 LOOP ENTRIES TO GENERATE LANDMARK TELEMETRY BUBBLES
            records.forEach(node => {
                let hexCode = '#00C851'; // Lancar Jaya (Green)
                let alphaBg = 'rgba(0, 200, 81, 0.04)';
                
                if (node.status === 'Macet Total') {
                    hexCode = '#D93025'; // Macet Total (Red)
                    alphaBg = 'rgba(217, 48, 37, 0.1)';
                } else if (node.status === 'Padat Merayap') {
                    hexCode = '#F9AB00'; // Padat Merayap (Amber)
                    alphaBg = 'rgba(249, 171, 0, 0.08)';
                }

                // 📊 Generate Left Terminal Panel Card
                const element = document.createElement('div');
                element.style.cssText = `
                    background: ${alphaBg}; border: 1px solid ${hexCode}25;
                    border-left: 4px solid ${hexCode}; padding: 14px 18px;
                    border-radius: 8px; display: flex; justify-content: space-between; align-items: center;
                `;
                element.innerHTML = `
                    <div>
                        <h4 style="font-size: 14px; font-weight: 600; color: #E0E0E0;">${node.road_name}</h4>
                        <p style="font-size: 12px; color: #777; margin-top: 3px;">Velocity: <strong style="color: #FFF;">${node.current_speed} km/h</strong></p>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-size: 12px; font-weight: 700; color: ${hexCode}; text-transform: uppercase;">${node.status}</span>
                        <p style="font-size: 11px; color: #555; margin-top: 3px;">Index: ${node.congestion_percentage}%</p>
                    </div>
                `;
                panel.appendChild(element);

                // 🗺️ Render Telemetry Bubble from Point Coordinates
                if (node.coordinate && Array.isArray(node.coordinate) && node.coordinate.length === 2) {
                    const targetPoint = node.coordinate;
                    
                    // Configurable coverage area size in meters (e.g., 500m reach)
                    const operationalRadius = 500; 

                    // Outer Reachable Area Buffer
                    const areaBubble = L.circle(targetPoint, {
                        radius: operationalRadius,
                        color: hexCode,
                        fillColor: hexCode,
                        fillOpacity: 0.12,
                        weight: 1.5,
                        dashArray: '4, 6'
                    });

                    // Core Internal Center Anchor Dot
                    const centerDot = L.circleMarker(targetPoint, {
                        radius: 5,
                        fillColor: '#FFFFFF', 
                        color: hexCode,
                        weight: 2,
                        fillOpacity: 1
                    });

                    const popupContent = `
                        <div style="font-size: 12px; color: #FFF; font-family: 'Inter', sans-serif;">
                            <strong style="display: block; font-size: 13px; margin-bottom: 4px;">${node.road_name}</strong>
                            Status: <span style="font-weight: bold; color: ${hexCode};">${node.status}</span><br>
                            Speed: <strong>${node.current_speed} km/h</strong>
                        </div>
                    `;

                    areaBubble.bindPopup(popupContent);
                    centerDot.bindPopup(popupContent);

                    // Hover interactions
                    areaBubble.on('mouseover', function () { this.setStyle({ fillOpacity: 0.25, weight: 2.5 }); });
                    areaBubble.on('mouseout', function () { this.setStyle({ fillOpacity: 0.12, weight: 1.5 }); });

                    trafficVectorGroup.addLayer(areaBubble);
                    trafficVectorGroup.addLayer(centerDot);
                }
            });

        } catch (problem) {
            console.error("Pipeline render execution error: ", problem);
        }
    }

    streamLiveTrafficMatrix();
    setInterval(streamLiveTrafficMatrix, 300000);
});