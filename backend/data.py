import os
import re
from datetime import time
from math import radians, sin, cos, sqrt, atan2

import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "datasets")


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


def is_available_at(row, check_time: time) -> bool:
    if row["disponible_24h"]:
        return True
    horario = str(row.get("horarios", ""))
    if not horario or horario in ("", "-", "nan"):
        return False
    h = horario.strip().upper()
    if "24" in h and ("H" in h or "HORA" in h):
        return True
    time_ranges = re.findall(
        r"(\d{1,2})[.:h](\d{2})?\s*(?:[Aa]|[-–])\s*(\d{1,2})[.:h](\d{2})?",
        horario,
    )
    for sh, sm, eh, em in time_ranges:
        try:
            start = time(int(sh), int(sm) if sm else 0)
            end = time(int(eh), int(em) if em else 0)
            if start <= check_time <= end:
                return True
        except ValueError:
            continue
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


def row_to_dict(row) -> dict:
    return {
        "id": row.get("nombre", ""),
        "descripcion": row.get("descripcion", ""),
        "direccion": row.get("direccion", ""),
        "lat": row["lat"],
        "lon": row["lon"],
        "disponible_24h": bool(row["disponible_24h"]),
        "titularidad": row.get("titularidad", ""),
        "horarios": row.get("horarios", "") if str(row.get("horarios", "")) != "nan" else "",
        "acceso_pmr": bool(row["acceso_pmr"]),
        "telefono": str(int(row["tlfcontacto"])) if pd.notna(row.get("tlfcontacto")) and str(row.get("tlfcontacto")) != "nan" else "",
    }


DF = load_locations()
