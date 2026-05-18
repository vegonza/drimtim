import math
import os
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Latidos API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=7200,
)

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
]


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in meters between two lat/lon points."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _element_coords(el: dict[str, Any]) -> tuple[float, float] | None:
    if "lat" in el and "lon" in el:
        return float(el["lat"]), float(el["lon"])
    center = el.get("center")
    if center and "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    return None


def _format_address(tags: dict[str, str]) -> str | None:
    parts = []
    street = tags.get("addr:street")
    number = tags.get("addr:housenumber")
    if street:
        parts.append(f"{street} {number}".strip() if number else street)
    city = tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village")
    if city:
        parts.append(city)
    if parts:
        return ", ".join(parts)
    return tags.get("description") or tags.get("location") or None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/defibrillators")
async def defibrillators(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius: int = Query(5000, ge=100, le=20000),
    limit: int = Query(5, ge=1, le=20),
) -> dict[str, Any]:
    """Return the closest AED/defibrillators around a lat/lng.

    Uses OSM Overpass API. Distance is straight-line (haversine) in meters.
    """
    query = f"""
    [out:json][timeout:20];
    (
      node["emergency"="defibrillator"](around:{radius},{lat},{lng});
      way["emergency"="defibrillator"](around:{radius},{lat},{lng});
    );
    out center tags 50;
    """.strip()

    last_error: Exception | None = None
    data: dict[str, Any] | None = None
    async with httpx.AsyncClient(timeout=25.0) as client:
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                resp = await client.post(
                    endpoint,
                    data={"data": query},
                    headers={"User-Agent": "Latidos/1.0 (emergency app)"},
                )
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as exc:
                last_error = exc
                continue

    if data is None:
        raise HTTPException(
            status_code=502,
            detail=f"No se pudo consultar OSM Overpass: {last_error}",
        )

    results = []
    for el in data.get("elements", []):
        coords = _element_coords(el)
        if not coords:
            continue
        elat, elng = coords
        tags = el.get("tags", {}) or {}
        results.append(
            {
                "id": f"{el.get('type')}/{el.get('id')}",
                "lat": elat,
                "lng": elng,
                "distance_m": haversine_m(lat, lng, elat, elng),
                "name": tags.get("name") or tags.get("operator"),
                "address": _format_address(tags),
                "indoor": tags.get("indoor") == "yes",
                "access": tags.get("access"),
                "opening_hours": tags.get("opening_hours"),
                "tags": tags,
            }
        )

    results.sort(key=lambda r: r["distance_m"])
    return {
        "origin": {"lat": lat, "lng": lng},
        "radius_m": radius,
        "count": len(results),
        "results": results[:limit],
    }
