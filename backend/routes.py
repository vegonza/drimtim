from datetime import time

from fastapi import APIRouter, Query

from data import DF, haversine, is_available_at, row_to_dict

router = APIRouter(prefix="/api")


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
            props["distance_m"] = round(haversine(lat, lon, row["lat"], row["lon"]), 1)
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [row["lon"], row["lat"]]},
            "properties": props,
        })

    if include_distance:
        features.sort(key=lambda f: f["properties"]["distance_m"])

    return {"type": "FeatureCollection", "features": features}
