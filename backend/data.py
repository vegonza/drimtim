import os
import re
from datetime import time
from math import radians, sin, cos, sqrt, atan2

import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "datasets")

SPEED_MS = 6 * 1000 / 3600  # 6 km/h → 1.67 m/s (brisk walk, accessible to everyone)
MAX_ROUND_TRIP_S = 180  # 3 minutes total (go + return with AED)


def _parse_geometry(geom: str) -> tuple[float, float] | None:
    m = re.search(r"POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)", str(geom))
    if not m:
        return None
    return float(m.group(2)), float(m.group(1))


def haversine(lat1, lon1, lat2, lon2) -> float:
    R = 6_371_000
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


def _parse_time_ranges(horario: str) -> list[tuple[time, time]]:
    """Extract (start, end) time pairs from a schedule string."""
    ranges = []
    # Match patterns like "06:00...02:00", "8 a 20", "08:00-22:00", "7.00 A 18.00"
    # Strategy: find all HH:MM or bare-hour tokens, then pair them up using
    # connectors (a, -, –, hasta) between them
    pattern = re.compile(
        r"(\d{1,2})(?:[.:h](\d{2}))?"
        r"\s*(?:h\.?\s*)?(?:de la \w+)?\s*"
        r"(?:a|-+|–|hasta)\s*"
        r"(\d{1,2})(?:[.:h](\d{2}))?",
        re.IGNORECASE,
    )
    for m in pattern.finditer(horario):
        sh, sm, eh, em = m.groups()
        try:
            start_h = int(sh)
            end_h = int(eh)
            if start_h > 23 or end_h > 23:
                continue
            start = time(start_h, int(sm) if sm else 0)
            end = time(end_h, int(em) if em else 0)
            ranges.append((start, end))
        except ValueError:
            continue
    return ranges


def is_available_at(row, check_time: time) -> bool:
    if row["disponible_24h"]:
        return True
    horario = str(row.get("horarios", ""))
    if not horario or horario in ("", "-", "nan"):
        return False
    h = horario.strip().upper()
    if "24" in h and ("H" in h or "HORA" in h):
        return True
    if "ININTERRUMPIDO" in h:
        return True

    ranges = _parse_time_ranges(horario)
    if not ranges:
        return False

    for start, end in ranges:
        if start <= end:
            if start <= check_time <= end:
                return True
        else:
            # Crosses midnight (e.g. 06:00 a 02:00)
            if check_time >= start or check_time <= end:
                return True
    return False


def load_locations() -> pd.DataFrame:
    df = pd.read_csv(os.path.join(DATA_DIR, "desfibriladores_localizacion.csv"))
    coords = df["wkb_geometry"].apply(_parse_geometry)
    df = df[coords.notna()].copy()
    coords = coords.dropna()
    df["lat"] = coords.apply(lambda c: c[0])
    df["lon"] = coords.apply(lambda c: c[1])
    df["disponible_24h"] = df["VEINTICUATROHORAS"].str.strip().str.lower() == "si"
    df["acceso_pmr"] = df["accesopmr"].str.strip().str.lower() == "si"
    return df


def _s(value) -> str:
    """Return a clean string, mapping NaN/None/'nan' to ''."""
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    s = str(value)
    if s.lower() == "nan":
        return ""
    return s


def row_to_dict(row) -> dict:
    fiabilidad = row.get("fiabilidad_pct")
    return {
        "id": _s(row.get("nombre")),
        "descripcion": _s(row.get("descripcion")),
        "direccion": _s(row.get("direccion")),
        "lat": row["lat"],
        "lon": row["lon"],
        "disponible_24h": bool(row["disponible_24h"]),
        "titularidad": _s(row.get("titularidad")),
        "horarios": _s(row.get("horarios")),
        "acceso_pmr": bool(row["acceso_pmr"]),
        "telefono": str(int(row["tlfcontacto"]))
        if pd.notna(row.get("tlfcontacto")) and str(row.get("tlfcontacto")) != "nan"
        else "",
        "fiabilidad_pct": int(fiabilidad) if pd.notna(fiabilidad) else None,
    }


DF = load_locations()
