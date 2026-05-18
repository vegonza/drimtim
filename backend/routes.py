import asyncio
import os
from datetime import time

import httpx
from fastapi import APIRouter, Query

from data import DF, MAX_ROUND_TRIP_S, SPEED_MS, haversine, is_available_at, row_to_dict
from recommendation_model import (
    DISTANCE_WEIGHT,
    RELIABILITY_WEIGHT,
    BACKUP_WEIGHT,
    SURVIVAL_DECAY_PER_MINUTE,
    access_delay_minutes,
    Defibrillator,
    load_defibrillators,
    route_distance_m,
)

ORS_KEY = os.environ.get("ORS_API_KEY", "")
ORS_MATRIX_URL = "https://api.openrouteservice.org/v2/matrix/foot-walking"
ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/foot-walking/geojson"

STREET_FACTOR = 1.3

router = APIRouter(prefix="/api")

_DEFIBRILLATOR_CACHE: dict[str, Defibrillator] = {}


def _get_defibrillator(aed_id: str) -> Defibrillator | None:
    if not _DEFIBRILLATOR_CACHE:
        for d in load_defibrillators():
            _DEFIBRILLATOR_CACHE[d.aed_id] = d
    return _DEFIBRILLATOR_CACHE.get(aed_id)


async def _ors_matrix(origin: tuple[float, float], destinations: list[tuple[float, float]]) -> list[dict] | None:
    """Get walking distances/durations from ORS matrix endpoint."""
    locations = [[origin[1], origin[0]]] + [[d[1], d[0]] for d in destinations]
    body = {
        "locations": locations,
        "sources": [0],
        "destinations": list(range(1, len(locations))),
        "metrics": ["distance", "duration"],
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                ORS_MATRIX_URL,
                json=body,
                headers={"Authorization": ORS_KEY, "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
            distances = data["distances"][0]
            durations = data["durations"][0]
            return [{"distance_m": d, "duration_s": t} for d, t in zip(distances, durations)]
    except Exception:
        return None


async def _ors_route(origin: tuple[float, float], dest: tuple[float, float]) -> dict | None:
    """Get walking route geometry from ORS directions endpoint."""
    body = {"coordinates": [[origin[1], origin[0]], [dest[1], dest[0]]]}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                ORS_DIRECTIONS_URL,
                json=body,
                headers={"Authorization": ORS_KEY, "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
            feature = data["features"][0]
            return feature["geometry"]
    except Exception:
        return None



@router.get("/geojson")
def geojson(
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    hour: int | None = Query(None, ge=0, le=23),
    minute: int = Query(0, ge=0, le=59),
):
    include_distance = lat is not None and lon is not None
    check_time = time(hour, minute) if hour is not None else None

    features = []
    for _, row in DF.iterrows():
        props = row_to_dict(row)
        if check_time is not None:
            props["available"] = is_available_at(row, check_time)
        if include_distance:
            props["distance_m"] = round(haversine(lat, lon, row["lat"], row["lon"]) * STREET_FACTOR, 1)
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [row["lon"], row["lat"]]},
                "properties": props,
            }
        )

    if include_distance:
        features.sort(key=lambda f: f["properties"]["distance_m"])

    return {"type": "FeatureCollection", "features": features}


def _compute_scores(results: list[dict], lat: float, lon: float) -> None:
    """Add recommendation_score to each result, considering reliability and backup."""
    for i, r in enumerate(results):
        dea = _get_defibrillator(r["id"])
        fiab = (r.get("fiabilidad_pct") or 80) / 100.0

        delay_min = access_delay_minutes(dea) if dea else 0.5
        retrieval_min = r["round_trip_s"] / 60.0 + delay_min
        distance_score = SURVIVAL_DECAY_PER_MINUTE ** retrieval_min

        # Best backup: another result that could be reached if this one fails
        backup_score = 0.0
        backup_id = None
        for j, other in enumerate(results):
            if j == i:
                continue
            other_fiab = (other.get("fiabilidad_pct") or 80) / 100.0
            primary_to_backup = route_distance_m(r["lat"], r["lon"], other["lat"], other["lon"])
            backup_to_patient = route_distance_m(other["lat"], other["lon"], lat, lon)
            fallback_dist = r["distance_m"] + primary_to_backup + backup_to_patient
            fallback_min = fallback_dist / SPEED_MS / 60.0 + delay_min * 2
            value = other_fiab * (SURVIVAL_DECAY_PER_MINUTE ** fallback_min)
            if value > backup_score:
                backup_score = value
                backup_id = other["id"]

        final = (
            DISTANCE_WEIGHT * distance_score
            + RELIABILITY_WEIGHT * fiab
            + BACKUP_WEIGHT * backup_score
        )
        r["distance_score"] = round(distance_score, 4)
        r["reliability_score"] = round(fiab, 4)
        r["backup_score"] = round(backup_score, 4)
        r["backup_id"] = backup_id
        r["recommendation_score"] = round(final * 100, 2)


@router.get("/nearest")
async def nearest(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    hour: int | None = Query(None, ge=0, le=23),
    minute: int = Query(0, ge=0, le=59),
    limit: int = Query(5, ge=1, le=20),
):
    check_time = time(hour, minute) if hour is not None else None
    max_one_way_m = (MAX_ROUND_TRIP_S / 2) * SPEED_MS
    pre_filter_m = max_one_way_m * 1.5

    candidates = []
    for _, row in DF.iterrows():
        straight_dist = haversine(lat, lon, row["lat"], row["lon"])
        if straight_dist > pre_filter_m:
            continue
        if check_time and not is_available_at(row, check_time):
            continue
        candidates.append((straight_dist, row))

    candidates.sort(key=lambda c: c[0])
    candidates = candidates[: limit * 3]

    if not candidates:
        return {
            "origin": {"lat": lat, "lon": lon},
            "max_round_trip_s": MAX_ROUND_TRIP_S,
            "speed_kmh": 6,
            "max_radius_m": round(max_one_way_m, 1),
            "count": 0,
            "results": [],
        }

    destinations = [(row["lat"], row["lon"]) for _, row in candidates]
    ors_results = await _ors_matrix((lat, lon), destinations)

    results = []
    for i, (straight_dist, row) in enumerate(candidates):
        if (
            ors_results
            and ors_results[i]["distance_m"] is not None
            and ors_results[i]["duration_s"] is not None
        ):
            walk_dist = ors_results[i]["distance_m"]
            walk_time = ors_results[i]["duration_s"]
        else:
            walk_dist = straight_dist * STREET_FACTOR
            walk_time = walk_dist / SPEED_MS

        round_trip_s = walk_time * 2
        if round_trip_s > MAX_ROUND_TRIP_S:
            continue

        results.append(
            {
                **row_to_dict(row),
                "distance_m": round(walk_dist, 1),
                "one_way_s": round(walk_time, 1),
                "round_trip_s": round(round_trip_s, 1),
            }
        )

    _compute_scores(results, lat, lon)
    results.sort(key=lambda r: r["recommendation_score"], reverse=True)
    results = results[:limit]

    route_tasks = [_ors_route((lat, lon), (r["lat"], r["lon"])) for r in results]
    routes = await asyncio.gather(*route_tasks)
    for r, route_geom in zip(results, routes):
        r["route"] = route_geom

    return {
        "origin": {"lat": lat, "lon": lon},
        "max_round_trip_s": MAX_ROUND_TRIP_S,
        "speed_kmh": 6,
        "max_radius_m": round(max_one_way_m, 1),
        "count": len(results),
        "results": results,
    }
