import os
import json
import requests
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
TOMTOM_KEY = os.getenv("TOMTOM_TRAFFIC_API")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

TARGET_ROADS = {
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

BASE_URL = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/15/json"

def fetch_and_route_traffic():
    print("🚀 Ingestion Engine Online. Safe point-coordinate storage active...")
    
    current_batch = []
    timestamp = datetime.utcnow().isoformat() + "Z"
    
    for road_name, coord_str in TARGET_ROADS.items():
        print(f"📡 Gathering metrics for {road_name}...")
        
        # 🧼 ULTRA SANITIZER: Hanya menyisakan angka, titik, koma, dan minus.
        clean_coords = "".join([c for c in coord_str if c.isdigit() or c in ['.', ',', '-']])
        
        params = {"key": TOMTOM_KEY, "point": clean_coords, "unit": "KMPH", "thickness": 3}
        
        try:
            response = requests.get(BASE_URL, params=params)
            if response.status_code == 200:
                payload = response.json()
                flow = payload.get("flowSegmentData", {})
                
                current_speed = flow.get("currentSpeed", 0)
                free_flow_speed = flow.get("freeFlowSpeed", 0)
                
                lat, lon = clean_coords.split(',')
                coordinate_array = [float(lat), float(lon)]
                
                if free_flow_speed > 0:
                    congestion_pct = max(0.0, min(100.0, (1 - (current_speed / free_flow_speed)) * 100))
                else:
                    congestion_pct = 0.0
                    
                if congestion_pct >= 60: status = "Macet Total"
                elif congestion_pct >= 30: status = "Padat Merayap"
                else: status = "Lancar Jaya"
                
                data_payload = {
                    "road_name": road_name,
                    "current_speed": current_speed,
                    "free_flow_speed": free_flow_speed,
                    "congestion_percentage": round(congestion_pct, 2),
                    "status": status,
                    "coordinate": coordinate_array,
                    "fetched_at": timestamp
                }
                
                current_batch.append(data_payload)
                supabase.table("jakarta_traffic_logs").insert(data_payload).execute()
                
            else:
                print(f"   ❌ TomTom API Error {response.status_code}")
                # 🔍 DIAGNOSTIC LOGS: Mencetak respon alasan penolakan asli dari server TomTom
                try:
                    print(f"      📝 Detail Error: {response.json()}")
                except Exception:
                    print(f"      📝 Detail Error: {response.text}")
        except Exception as e:
            print(f"   ❌ Exception: {e}")

    if current_batch:
        print("\n📦 Syncing point snapshot file inside 'jakarta-traffic-data' bucket...")
        try:
            json_bytes = json.dumps(current_batch, indent=2).encode('utf-8')
            
            try:
                supabase.storage.from_("jakarta-traffic-data").remove(["latest_traffic.json"])
            except Exception:
                pass 
            
            supabase.storage.from_("jakarta-traffic-data").upload(
                path="latest_traffic.json",
                file=json_bytes,
                file_options={"content-type": "application/json"}
            )
            print("   💾 Success! Lightweight snapshot overwritten successfully.")
        except Exception as bucket_err:
            print(f"   ❌ Storage Bucket Upload Error: {bucket_err}")

    print("\n🏁 Ingestion pass complete.")

if __name__ == "__main__":
    fetch_and_route_traffic()