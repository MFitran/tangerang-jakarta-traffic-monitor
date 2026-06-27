import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' 
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // FALLBACK CHAIN: Look for the key in headers, then parameters, then local env
    const tomtomKey = req.headers.get('x-tomtom-key') || 
                      new URL(req.url).searchParams.get('tomtom_key') || 
                      Deno.env.get('TOMTOM_TRAFFIC_API') || 
                      ''

    const TARGET_ROADS: Record<string, string> = {
      "01. Tangerang / Kebon Nanas Entry (KM 18)": "-6.220000,106.652500",
      "02. Alam Sutera / Kunciran (KM 15)": "-6.218100,106.665200",
      "03. KM 13-14 Rest Area Corridor": "-6.213850,106.681100",
      "04. Green Lake / Karang Tengah Barat (KM 11)": "-6.204800,106.702800",
      "05. Kembangan / JORR Interchange (KM 8)": "-6.191500,106.731600",
      "06. Kebon Jeruk / RCTI Flyover (KM 4)": "-6.189900,106.768500",
      "07. Tanjung Duren / CP-TA Trench (KM 1)": "-6.185400,106.782800",
      "08. Tomang Interchange Main Merge (KM 0)": "-6.179800,106.795600",
      "09. S Parman Corridor (Podomoro Area)": "-6.184200,106.796800",
      "10. Slipi Jaya Interchange (Gatot Subroto)": "-6.191500,106.797400"
    }

    const baseUrl = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/15/json"
    const currentBatch: any[] = []
    const timestamp = new Date().toISOString()

    if (!tomtomKey) {
      console.error("⚠️ Missing TomTom API Key Credentials");
    }

    for (const [roadName, coordStr] of Object.entries(TARGET_ROADS)) {
      const cleanCoords = coordStr.replace(/[^0-9.,-]/g, '')
      const params = new URLSearchParams({
        key: tomtomKey,
        point: cleanCoords,
        unit: 'KMPH',
        thickness: '3'
      })

      try {
        const response = await fetch(`${baseUrl}?${params.toString()}`)
        if (response.ok) {
          const payload = await response.json()
          const flow = payload.flowSegmentData || {}
          const currentSpeed = flow.currentSpeed || 0
          const freeFlowSpeed = flow.freeFlowSpeed || 0

          const [latStr, lonStr] = cleanCoords.split(',')
          const coordinateArray = [parseFloat(latStr), parseFloat(lonStr)]

          let congestionPct = 0.0
          if (freeFlowSpeed > 0) {
            congestionPct = Math.max(0.0, Math.min(100.0, (1 - (currentSpeed / freeFlowSpeed)) * 100))
          }

          let status = "Lancar Jaya"
          if (congestionPct >= 60) {
            status = "Macet Total"
          } else if (congestionPct >= 30) {
            status = "Padat Merayap"
          }

          const dataPayload = {
            road_name: roadName,
            current_speed: currentSpeed,
            free_flow_speed: freeFlowSpeed,
            congestion_percentage: Math.round(congestionPct * 100) / 100,
            status: status,
            coordinate: coordinateArray,
            fetched_at: timestamp
          }

          currentBatch.push(dataPayload)
          await supabase.from("jakarta_traffic_logs").insert(dataPayload)
        }
      } catch (roadErr) {
        console.error(`Error processing road ${roadName}:`, roadErr)
      }
    }

    if (currentBatch.length > 0) {
      try {
        const jsonString = JSON.stringify(currentBatch, null, 2)
        const fileBytes = new TextEncoder().encode(jsonString)
        await supabase.storage.from("jakarta-traffic-data").remove(["latest_traffic.json"])
        await supabase.storage.from("jakarta-traffic-data").upload("latest_traffic.json", fileBytes, {
          contentType: "application/json",
          upsert: true
        })
      } catch (bucketErr) {
        console.error(`Bucket Error:`, bucketErr)
      }
    }

    return new Response(JSON.stringify({ success: true, processed: currentBatch.length }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    })
  }
})