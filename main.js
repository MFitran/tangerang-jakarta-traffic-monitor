window.envConfig = {
    SUPABASE_URL: "https://wwapndvliynmdeejtryz.supabase.co",
    SUPABASE_KEY: "sb_publishable_h2mFkHzvYdG9YJxh83FrRQ_w2KkTCtb"
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
        zoomControl: false,
        attributionControl: false
    }).setView([-6.1950, 106.7200], 12); 

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(map);

    const trafficVectorGroup = L.layerGroup().addTo(map);

    async function fetchAndRenderTraffic() {
        try {
            const client = window.getSupabaseClient();
            if (!client) throw new Error("Supabase authenticated initialization matrix failed.");

            // 1. Fetch all coordinate records
            const { data: coords, error: coordsError } = await client
                .from('jakarta_traffic_coords')
                .select('id, road_name, coordinate, recent_log_id');

            if (coordsError) {
                console.error("Error fetching coordinates:", coordsError);
                return;
            }

            const panel = document.getElementById('traffic-nodes-container');

            if (!coords || coords.length === 0) {
                panel.innerHTML = '<div class="loading-state">Zero dataset entries extracted.</div>';
                trafficVectorGroup.clearLayers();
                return;
            }

            // 2. Extract recent_log_ids (filtering out any nulls/undefined values)
            const recentLogIds = coords
                .map(c => c.recent_log_id)
                .filter(id => id !== null && id !== undefined);

            let logs = [];
            if (recentLogIds.length > 0) {
                // 3. Fetch only the 10 recent logs matching these IDs
                const { data: logsData, error: logsError } = await client
                    .from('jakarta_traffic_logs')
                    .select('id, road_id, current_speed, free_flow_speed, congestion_percentage, status, fetched_at')
                    .in('id', recentLogIds);

                if (logsError) {
                    console.error("Error fetching logs:", logsError);
                    return;
                }
                logs = logsData || [];
            }

            // Index logs by their primary key ID
            const logsMap = new Map(logs.map(l => [String(l.id), l]));

            // Map and join logs with coordinates
            const records = coords.map(coord => {
                const log = coord.recent_log_id ? logsMap.get(String(coord.recent_log_id)) : null;

                return {
                    id: coord.id,
                    road_name: coord.road_name,
                    coordinate: coord.coordinate,
                    jakarta_traffic_logs: log
                };
            });

            panel.innerHTML = '';
            trafficVectorGroup.clearLayers();

            if (!records || records.length === 0) {
                panel.innerHTML = '<div class="loading-state">Zero dataset entries extracted.</div>';
                return;
            }

            // Sort sequentially (01 to 10) for UI side-panel alignment
            records.sort((x, y) => x.road_name.localeCompare(y.road_name));
            
            let latestFetchedAt = null;

            // 🚀 LOOP ENTRIES TO GENERATE LANDMARK TELEMETRY BUBBLES
            records.forEach(coordNode => {
                const log = coordNode.jakarta_traffic_logs;

                const current_speed = log?.current_speed ?? 0;
                const free_flow_speed = log?.free_flow_speed ?? 0;
                const congestion_percentage = log?.congestion_percentage ?? 0;
                
                const statusMap = {
                    1: "Lancar Jaya",
                    2: "Padat Merayap",
                    3: "Macet Total"
                };
                const status = statusMap[log?.status] ?? 'Lancar Jaya';
                const fetched_at = log?.fetched_at;

                if (fetched_at) {
                    const nodeDate = new Date(fetched_at);
                    if (!latestFetchedAt || nodeDate > latestFetchedAt) {
                        latestFetchedAt = nodeDate;
                    }
                }

                let hexCode = '#00C851'; // Lancar Jaya (Green)
                let alphaBg = 'rgba(0, 200, 81, 0.04)';
                
                if (status === 'Macet Total') {
                    hexCode = '#D93025'; // Macet Total (Red)
                    alphaBg = 'rgba(217, 48, 37, 0.1)';
                } else if (status === 'Padat Merayap') {
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
                        <h4 style="font-size: 14px; font-weight: 600; color: #E0E0E0;">${coordNode.road_name}</h4>
                        <p style="font-size: 12px; color: #777; margin-top: 3px;">Velocity: <strong style="color: #FFF;">${current_speed} km/h</strong></p>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-size: 12px; font-weight: 700; color: ${hexCode}; text-transform: uppercase;">${status}</span>
                        <p style="font-size: 11px; color: #555; margin-top: 3px;">Index: ${congestion_percentage}%</p>
                    </div>
                `;
                panel.appendChild(element);

                // 🗺️ Render Telemetry Bubble from Point Coordinates
                if (coordNode.coordinate && Array.isArray(coordNode.coordinate) && coordNode.coordinate.length === 2) {
                    const targetPoint = coordNode.coordinate;
                    
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
                            <strong style="display: block; font-size: 13px; margin-bottom: 4px;">${coordNode.road_name}</strong>
                            Status: <span style="font-weight: bold; color: ${hexCode};">${status}</span><br>
                            Speed: <strong>${current_speed} km/h</strong>
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

            const clock = latestFetchedAt ? latestFetchedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
            document.getElementById('last-update-tag').innerText = `UPDATED AT ${clock} WIB`;

        } catch (problem) {
            console.error("Pipeline render execution error: ", problem);
        }
    }

    // Initial load
    fetchAndRenderTraffic();

    // Subscribe to realtime changes once
    const client = window.getSupabaseClient();
    if (client) {
        client
            .channel('jakarta_traffic_realtime_channel')
            .on('postgres_changes', 
                { event: '*', schema: 'public', table: 'jakarta_traffic_coords' }, 
                payload => {
                    console.log('Coordinates change received!', payload);
                    fetchAndRenderTraffic();
                }
            )
            .on('postgres_changes', 
                { event: '*', schema: 'public', table: 'jakarta_traffic_logs' }, 
                payload => {
                    console.log('Traffic logs change received!', payload);
                    fetchAndRenderTraffic();
                }
            )
            .subscribe();
    }
});
