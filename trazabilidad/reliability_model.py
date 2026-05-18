from __future__ import annotations

import argparse
import csv
import math
import os
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable


DATASET_DIR = Path(os.environ.get("DATASETS_DIR", Path(__file__).resolve().parents[1] / "backend" / "datasets"))

LOCATION_FILE = "desfibriladores_localizacion.csv"
INCIDENTS_FILE = "139_view_report_uc12_incidents_log.csv"
OPERATIONAL_FILE = "140_view_report_uc12_operational_defibrillators.csv"
RESOLUTION_FILE = "141_view_report_uc12_tech_issue_resolution_time.csv"

# The public Malaga dataset identifies AEDs as DEA_*, while Centesimal uses
# building names and AF1 device ids. This audited bridge links rows that are
# clearly the same Centesimal AED in both sources.
LOCATION_TO_CENTESIMAL_BUILDING = {
    "DEA_080": "C.S.S. Carretera de Cádiz",
    "DEA_804": "C.E.I.P. Fuente Alegre",
    "DEA_805": "Incubadoras empresas-Promalaga Píndola",
    "DEA_806": "Incubadoras empresas-Promalaga Citylab",
    "DEA_807": "Incubadoras empresas-Promalaga Cruz de Humilladero",
    "DEA_808": "Incubadoras empresas-Promalaga Álamos",
    "DEA_809": "Centro de Formación e Incubación PTA",
    "DEA_810": "Habitec",
    "DEA_811": "Centro de empresas IS5",
    "DEA_812": "Hotel Atarazanas",
    "DEA_813": "Mercado Carranque",
    "DEA_814": "C.E.I.P. Hans Christian Andersen",
    "DEA_815": "C.E.I.P. Benito Pérez Galdós",
    "DEA_816": "C.E.I.P. María Zambrano",
    "DEA_817": "C.E.I.P. Miraflores de los Ángeles",
    "DEA_818": "C.E.I.P. Manuel de Falla",
    "DEA_819": "C.E.I.P. Clara Campoamor",
    "DEA_820": "C.E.I.P. Julio Caro Baroja",
    "DEA_821": "Centro de control de Accesos Aparcamiento y Vigilancia - PTA",
    "DEA_822": "Parroquia Santa María Estrella de los Mares",
    "DEA_823": "Estación de Autobuses de Muelle Heredia",
    "DEA_824": "C.E.I.P. Vicente Aleixandre",
    "DEA_826": "C.E.I.P. Luis de Góngora",
    "DEA_827": "C.E.I.P. Ricardo de León",
    "DEA_828": "Parque Central LIMASA",
    "DEA_829": "Hospital Noble",
}

INCIDENT_SEVERITY = {
    "offline": 1.00,
    "battery": 0.90,
    "fault": 0.75,
}


@dataclass
class Telemetry:
    building: str
    device_name: str = ""
    total_incidents: int = 0
    weighted_recent_incidents: float = 0.0
    incidents_last_30d: int = 0
    incidents_last_14d: int = 0
    offline_incidents: int = 0
    battery_incidents: int = 0
    fault_incidents: int = 0
    last_incident_days: int | None = None
    latest_operational: int | None = None
    avg_resolution_hours: float | None = None


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def parse_date(value: str) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass
    return None


def normalize_key(value: str) -> str:
    value = value or ""
    value = value.lower().replace("\xa0", " ")
    value = "".join(
        char
        for char in unicodedata.normalize("NFD", value)
        if unicodedata.category(char) != "Mn"
    )
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(value.split())


def to_int(value: str) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def to_float(value: str) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-value))


def logit(probability: float) -> float:
    return math.log(probability / (1.0 - probability))


def clamp(value: float, lower: float = 0.01, upper: float = 0.99) -> float:
    return max(lower, min(upper, value))


def risk_level(probability: float) -> str:
    if probability >= 0.85:
        return "alta"
    if probability >= 0.70:
        return "media"
    return "baja"


def build_telemetry(datasets_dir: Path) -> dict[str, Telemetry]:
    incidents = read_csv(datasets_dir / INCIDENTS_FILE)
    operational = read_csv(datasets_dir / OPERATIONAL_FILE)
    resolution = read_csv(datasets_dir / RESOLUTION_FILE)

    all_dates = [
        date
        for row in incidents + operational + resolution
        if (date := parse_date(row.get("Fecha", ""))) is not None
    ]
    reference_date = max(all_dates) if all_dates else datetime.now()

    telemetry: dict[str, Telemetry] = {}

    def item_for(building: str) -> Telemetry:
        key = normalize_key(building)
        if key not in telemetry:
            telemetry[key] = Telemetry(building=building)
        return telemetry[key]

    for row in incidents:
        building = row.get("Edificio", "")
        item = item_for(building)
        count = to_int(row.get("num_incidencias", "0"))
        incident_type = normalize_key(row.get("Tipo incidencia", ""))
        date = parse_date(row.get("Fecha", ""))
        days_since = (reference_date - date).days if date else 365
        severity = INCIDENT_SEVERITY.get(incident_type, 0.60)
        recency_weight = math.exp(-max(days_since, 0) / 30.0)

        item.device_name = row.get("deviceName") or item.device_name
        item.total_incidents += count
        item.weighted_recent_incidents += count * severity * recency_weight

        if days_since <= 30:
            item.incidents_last_30d += count
        if days_since <= 14:
            item.incidents_last_14d += count
        if incident_type == "offline":
            item.offline_incidents += count
        elif incident_type == "battery":
            item.battery_incidents += count
        elif incident_type == "fault":
            item.fault_incidents += count

        if item.last_incident_days is None or days_since < item.last_incident_days:
            item.last_incident_days = days_since

    latest_operational_date_by_building: dict[str, datetime] = {}
    for row in operational:
        building = row.get("Edificio", "")
        key = normalize_key(building)
        date = parse_date(row.get("Fecha", ""))
        if date is None:
            continue
        if key not in latest_operational_date_by_building or date > latest_operational_date_by_building[key]:
            latest_operational_date_by_building[key] = date

    for row in operational:
        building = row.get("Edificio", "")
        key = normalize_key(building)
        date = parse_date(row.get("Fecha", ""))
        if date != latest_operational_date_by_building.get(key):
            continue
        item = item_for(building)
        item.device_name = row.get("deviceName") or item.device_name
        item.latest_operational = to_int(row.get("num_desfibriladores_operativos", "0"))

    resolution_values: dict[str, list[float]] = defaultdict(list)
    for row in resolution:
        value = to_float(row.get("tiempo_medio_resolucion_h", ""))
        if value is not None:
            resolution_values[normalize_key(row.get("Edificio", ""))].append(value)

    for key, values in resolution_values.items():
        if key in telemetry and values:
            telemetry[key].avg_resolution_hours = sum(values) / len(values)

    return telemetry


def technical_probability(item: Telemetry | None) -> tuple[float, str]:
    if item is None:
        return 0.93, "sin_telemetria_centesimal"

    base_probability = 0.96 if item.latest_operational and item.latest_operational > 0 else 0.91
    risk = 0.0

    risk += 0.62 * math.log1p(item.weighted_recent_incidents)
    risk += 0.18 * math.log1p(item.total_incidents / 10.0)

    if item.incidents_last_14d:
        risk += 0.55
    elif item.incidents_last_30d:
        risk += 0.30

    if item.offline_incidents:
        risk += min(0.60, 0.05 * item.offline_incidents)
    if item.battery_incidents:
        risk += min(0.55, 0.08 * item.battery_incidents)
    if item.fault_incidents:
        risk += min(0.45, 0.04 * item.fault_incidents)

    if item.latest_operational == 0:
        risk += 1.10

    probability = sigmoid(logit(base_probability) - risk)
    return clamp(probability), "telemetria_centesimal"


def score_defibrillators(datasets_dir: Path = DATASET_DIR) -> list[dict[str, str]]:
    locations = read_csv(datasets_dir / LOCATION_FILE)
    telemetry = build_telemetry(datasets_dir)

    rows: list[dict[str, str]] = []
    for location in locations:
        aed_id = location.get("nombre", "")
        building = LOCATION_TO_CENTESIMAL_BUILDING.get(aed_id, "")
        telemetry_item = telemetry.get(normalize_key(building)) if building else None

        tech_probability, telemetry_status = technical_probability(telemetry_item)
        reliability_probability = tech_probability

        rows.append(
            {
                "aed_id": aed_id,
                "descripcion": location.get("descripcion", ""),
                "direccion": location.get("direccion", ""),
                "titularidad": location.get("titularidad", ""),
                "centesimal_building": building,
                "centesimal_device": telemetry_item.device_name if telemetry_item else "",
                "technical_probability": f"{tech_probability:.4f}",
                "reliability_probability": f"{reliability_probability:.4f}",
                "reliability_score": str(round(reliability_probability * 100)),
                "reliability_level": risk_level(reliability_probability),
                "data_confidence": telemetry_status,
                "total_incidents": str(telemetry_item.total_incidents if telemetry_item else 0),
                "incidents_last_30d": str(telemetry_item.incidents_last_30d if telemetry_item else 0),
                "incidents_last_14d": str(telemetry_item.incidents_last_14d if telemetry_item else 0),
                "offline_incidents": str(telemetry_item.offline_incidents if telemetry_item else 0),
                "battery_incidents": str(telemetry_item.battery_incidents if telemetry_item else 0),
                "fault_incidents": str(telemetry_item.fault_incidents if telemetry_item else 0),
                "last_incident_days": ""
                if telemetry_item is None or telemetry_item.last_incident_days is None
                else str(telemetry_item.last_incident_days),
                "latest_operational": ""
                if telemetry_item is None or telemetry_item.latest_operational is None
                else str(telemetry_item.latest_operational),
                "avg_resolution_hours": ""
                if telemetry_item is None or telemetry_item.avg_resolution_hours is None
                else f"{telemetry_item.avg_resolution_hours:.2f}",
            }
        )

    return rows


def write_scores(rows: Iterable[dict[str, str]], output_path: Path) -> None:
    rows = list(rows)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        output_path.write_text("", encoding="utf-8")
        return

    with output_path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0].keys()), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def enrich_location_file(datasets_dir: Path, scored_rows: Iterable[dict[str, str]]) -> None:
    location_path = datasets_dir / LOCATION_FILE
    scores = {
        row["aed_id"]: row["reliability_score"]
        for row in scored_rows
        if row.get("aed_id")
    }

    with location_path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    if "fiabilidad_pct" not in fieldnames:
        fieldnames.append("fiabilidad_pct")

    missing_ids = []
    for row in rows:
        aed_id = row.get("nombre", "")
        score = scores.get(aed_id)
        if score is None:
            missing_ids.append(aed_id)
            score = ""
        row["fiabilidad_pct"] = score

    if missing_ids:
        raise ValueError(f"Missing reliability scores for {len(missing_ids)} AEDs")

    with location_path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def print_summary(rows: list[dict[str, str]]) -> None:
    levels = Counter(row["reliability_level"] for row in rows)
    confidence = Counter(row["data_confidence"] for row in rows)
    print(f"Scored AEDs: {len(rows)}")
    print(f"Reliability levels: {dict(levels)}")
    print(f"Data confidence: {dict(confidence)}")
    print("Lowest reliability AEDs:")
    for row in sorted(rows, key=lambda item: float(item["reliability_probability"]))[:10]:
        print(
            f"  {row['aed_id']}: {row['reliability_probability']} "
            f"({row['reliability_level']}) - {row['descripcion'][:80]}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Score AED reliability for Latidos.")
    parser.add_argument("--datasets-dir", type=Path, default=DATASET_DIR)
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="CSV output path.",
    )
    parser.add_argument(
        "--enrich-location",
        action="store_true",
        help="Append/update fiabilidad_pct in desfibriladores_localizacion.csv.",
    )
    args = parser.parse_args()

    rows = score_defibrillators(args.datasets_dir)
    if args.output:
        write_scores(rows, args.output)
        print(f"Wrote: {args.output}")
    if args.enrich_location:
        enrich_location_file(args.datasets_dir, rows)
        print(f"Updated: {args.datasets_dir / LOCATION_FILE}")
    print_summary(rows)


if __name__ == "__main__":
    main()
