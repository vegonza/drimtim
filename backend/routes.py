from datetime import time

from fastapi import APIRouter, Query

from data import DF, haversine, is_available_at, row_to_dict

router = APIRouter(prefix="/api")


@router.get("/geojson")
def geojson(
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    disponible_24h: bool | None = None,
    titularidad: str | None = None,
    hour: int = Query(None, ge=0, le=23),
    minute: int = Query(0, ge=0, le=59),
):
    check_time = time(hour, minute) if hour is not None else None
    filtered = DF
    if disponible_24h is not None:
        filtered = filtered[filtered["disponible_24h"] == disponible_24h]
    if titularidad:
        filtered = filtered[filtered["titularidad"].str.upper() == titularidad.upper()]
    if check_time:
        filtered = filtered[filtered.apply(lambda r: is_available_at(r, check_time), axis=1)]

    include_distance = lat is not None and lon is not None

    features = []
    for _, row in filtered.iterrows():
        props = row_to_dict(row)
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
