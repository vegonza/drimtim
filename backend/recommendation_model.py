from __future__ import annotations

import argparse
import csv
import math
import os
import re
from dataclasses import dataclass
from datetime import datetime, time
from pathlib import Path


DATASET_DIR = Path(os.environ.get("DATASETS_DIR", Path(__file__).resolve().parent / "datasets"))
LOCATION_FILE = DATASET_DIR / "desfibriladores_localizacion.csv"

POINT_RE = re.compile(r"POINT \((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)")
TIME_RANGE_RE = re.compile(
    r"(\d{1,2})(?::|\.)(\d{2})\s*(?:-|a|A|hasta)\s*(\d{1,2})(?::|\.)(\d{2})"
)

EARTH_RADIUS_M = 6_371_000
ROUTE_DETOUR_FACTOR = 1.25
RUN_SPEED_MPS = 2.2
SURVIVAL_DECAY_PER_MINUTE = 0.92

DISTANCE_WEIGHT = 0.55
RELIABILITY_WEIGHT = 0.30
BACKUP_WEIGHT = 0.15
MAX_PRIMARY_CANDIDATES = 60
MAX_BACKUP_CANDIDATES = 120


@dataclass(frozen=True)
class Defibrillator:
    aed_id: str
    description: str
    address: str
    schedule: str
    ownership: str
    is_24h: bool
    reliability_pct: float
    lon: float
    lat: float


@dataclass(frozen=True)
class Recommendation:
    aed_id: str
    description: str
    address: str
    distance_m: int
    retrieval_minutes: float
    reliability_pct: float
    is_open: bool | None
    distance_score: float
    reliability_score: float
    availability_score: float
    backup_aed_id: str
    backup_distance_m: int | None
    backup_score: float
    recommendation_score: float


def parse_point(value: str) -> tuple[float, float] | None:
    match = POINT_RE.fullmatch(value or "")
    if not match:
        return None

    lon = float(match.group(1))
    lat = float(match.group(2))
    if not (-5.0 < lon < -3.0 and 36.0 < lat < 37.0):
        return None
    return lon, lat


def parse_float(value: str, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def load_defibrillators(path: Path = LOCATION_FILE) -> list[Defibrillator]:
    with path.open(encoding="utf-8-sig", newline="") as file:
        rows = list(csv.DictReader(file))

    defibrillators: list[Defibrillator] = []
    for row in rows:
        point = parse_point(row.get("wkb_geometry", ""))
        if point is None:
            continue

        lon, lat = point
        defibrillators.append(
            Defibrillator(
                aed_id=row.get("nombre", ""),
                description=row.get("descripcion", ""),
                address=row.get("direccion", ""),
                schedule=row.get("horarios", ""),
                ownership=row.get("titularidad", ""),
                is_24h=(row.get("VEINTICUATROHORAS", "").strip().lower() == "si"),
                reliability_pct=parse_float(row.get("fiabilidad_pct", ""), 80.0),
                lon=lon,
                lat=lat,
            )
        )

    return defibrillators


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    value = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(value))


def route_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return haversine_m(lat1, lon1, lat2, lon2) * ROUTE_DETOUR_FACTOR


def time_in_range(current: time, start: time, end: time) -> bool:
    if start <= end:
        return start <= current <= end
    return current >= start or current <= end


def applies_today(schedule: str, moment: datetime) -> bool:
    text = schedule.lower()
    weekday = moment.weekday()

    if not schedule.strip():
        return False
    if "l-m-x-j-v-s-d" in text or "l a d" in text or "lunes a domingo" in text:
        return True
    if "l-v" in text or "l a v" in text or "lunes a viernes" in text:
        return weekday <= 4
    if "s-d" in text or "sabado" in text or "sábado" in text or "domingo" in text:
        return weekday >= 5

    return True


def schedule_is_open(schedule: str, moment: datetime) -> bool | None:
    if not applies_today(schedule, moment):
        return False

    ranges = []
    for match in TIME_RANGE_RE.finditer(schedule):
        start_hour, start_minute, end_hour, end_minute = map(int, match.groups())
        if start_hour > 23 or end_hour > 23 or start_minute > 59 or end_minute > 59:
            continue
        ranges.append((time(start_hour, start_minute), time(end_hour, end_minute)))

    if not ranges:
        return None

    current = moment.time()
    return any(time_in_range(current, start, end) for start, end in ranges)


def availability_factor(defibrillator: Defibrillator, moment: datetime | None) -> float:
    if defibrillator.is_24h:
        return 1.0

    if moment is None:
        return 1.0

    open_now = schedule_is_open(defibrillator.schedule, moment)
    if open_now is True:
        return 1.0
    if open_now is False:
        return 0.05

    if defibrillator.ownership.upper() == "EMT":
        return 0.75
    if defibrillator.schedule.strip():
        return 0.70
    return 0.50


def is_available_candidate(defibrillator: Defibrillator, moment: datetime | None) -> bool:
    if defibrillator.is_24h or moment is None:
        return True

    open_now = schedule_is_open(defibrillator.schedule, moment)
    return open_now is not False


def access_delay_minutes(defibrillator: Defibrillator, availability: float) -> float:
    if availability <= 0.10:
        return 4.0
    if defibrillator.is_24h:
        return 0.3
    if defibrillator.ownership.upper() == "EMT":
        return 1.2
    return 0.8


def retrieval_minutes(
    origin_lat: float,
    origin_lon: float,
    defibrillator: Defibrillator,
    availability: float,
) -> float:
    distance = route_distance_m(origin_lat, origin_lon, defibrillator.lat, defibrillator.lon)
    # A rescuer usually has to go from the patient to the AED and come back.
    return (2 * distance / RUN_SPEED_MPS / 60) + access_delay_minutes(defibrillator, availability)


def time_weight(minutes: float) -> float:
    return SURVIVAL_DECAY_PER_MINUTE ** minutes


def best_backup_value(
    origin_lat: float,
    origin_lon: float,
    primary: Defibrillator,
    defibrillators: list[Defibrillator],
    moment: datetime | None,
) -> tuple[str, int | None, float]:
    best_id = ""
    best_distance = None
    best_value = 0.0

    patient_to_primary = route_distance_m(origin_lat, origin_lon, primary.lat, primary.lon)

    for backup in defibrillators:
        if backup.aed_id == primary.aed_id:
            continue

        backup_availability = availability_factor(backup, moment)
        backup_reliability = backup.reliability_pct / 100
        primary_to_backup = route_distance_m(primary.lat, primary.lon, backup.lat, backup.lon)
        backup_to_patient = route_distance_m(backup.lat, backup.lon, origin_lat, origin_lon)

        fallback_minutes = (
            (patient_to_primary + primary_to_backup + backup_to_patient) / RUN_SPEED_MPS / 60
            + access_delay_minutes(primary, 1.0)
            + access_delay_minutes(backup, backup_availability)
        )
        value = backup_reliability * backup_availability * time_weight(fallback_minutes)

        if value > best_value:
            best_id = backup.aed_id
            best_distance = round(primary_to_backup)
            best_value = value

    return best_id, best_distance, best_value


def recommendation_score(
    distance_score: float,
    reliability_score: float,
    availability_score: float,
    backup_score: float,
) -> float:
    # Availability acts as a gate: a closed AED should almost never outrank an
    # open one, even if it is closer.
    weighted_score = (
        DISTANCE_WEIGHT * distance_score
        + RELIABILITY_WEIGHT * reliability_score
        + BACKUP_WEIGHT * backup_score
    )
    return availability_score * weighted_score


def recommend_defibrillators(
    origin_lat: float,
    origin_lon: float,
    moment: datetime | None = None,
    limit: int = 5,
    defibrillators: list[Defibrillator] | None = None,
) -> list[Recommendation]:
    defibrillators = defibrillators or load_defibrillators()
    recommendations: list[Recommendation] = []

    available_candidates = [
        (
            defibrillator,
            route_distance_m(origin_lat, origin_lon, defibrillator.lat, defibrillator.lon),
        )
        for defibrillator in defibrillators
        if is_available_candidate(defibrillator, moment)
    ]
    available_candidates.sort(key=lambda item: item[1])

    primary_candidates = available_candidates[:MAX_PRIMARY_CANDIDATES]
    backup_candidates = [
        defibrillator
        for defibrillator, _distance in available_candidates[:MAX_BACKUP_CANDIDATES]
    ]

    for defibrillator, distance in primary_candidates:

        open_now = True if defibrillator.is_24h else (
            schedule_is_open(defibrillator.schedule, moment) if moment else None
        )
        availability = availability_factor(defibrillator, moment)
        reliability = defibrillator.reliability_pct / 100
        minutes = retrieval_minutes(origin_lat, origin_lon, defibrillator, availability)
        distance_score = time_weight(minutes)
        backup_id, backup_distance, backup_value = best_backup_value(
            origin_lat,
            origin_lon,
            defibrillator,
            backup_candidates,
            moment,
        )

        final_score = recommendation_score(
            distance_score=distance_score,
            reliability_score=reliability,
            availability_score=availability,
            backup_score=backup_value,
        )

        recommendations.append(
            Recommendation(
                aed_id=defibrillator.aed_id,
                description=defibrillator.description,
                address=defibrillator.address,
                distance_m=round(distance),
                retrieval_minutes=round(minutes, 2),
                reliability_pct=round(defibrillator.reliability_pct, 1),
                is_open=open_now,
                distance_score=round(distance_score, 4),
                reliability_score=round(reliability, 4),
                availability_score=round(availability, 4),
                backup_aed_id=backup_id,
                backup_distance_m=backup_distance,
                backup_score=round(backup_value, 4),
                recommendation_score=round(final_score * 100, 2),
            )
        )

    return sorted(recommendations, key=lambda item: item.recommendation_score, reverse=True)[:limit]


def parse_moment(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)


def main() -> None:
    parser = argparse.ArgumentParser(description="Recommend the best AED for a location.")
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--at", type=str, default=None, help="ISO datetime, e.g. 2026-05-18T12:30")
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()

    recommendations = recommend_defibrillators(
        origin_lat=args.lat,
        origin_lon=args.lon,
        moment=parse_moment(args.at),
        limit=args.limit,
    )

    for index, item in enumerate(recommendations, start=1):
        print(
            f"{index}. {item.aed_id} score={item.recommendation_score} "
            f"dist={item.distance_m}m time={item.retrieval_minutes}min "
            f"fiabilidad={item.reliability_pct}% abierto={item.is_open} "
            f"backup={item.backup_aed_id or '-'}"
        )
        print(f"   {item.description} - {item.address}")


if __name__ == "__main__":
    main()
