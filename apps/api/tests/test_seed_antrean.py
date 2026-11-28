from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.seed_antrean import remove_scenario, seed_scenario
from app.services.queue import active_schedule

# Selasa 20/10/2026 09.00 WIB (outlet buka 08.00-17.00).
NOW = datetime(2026, 10, 20, 2, 0, tzinfo=UTC)


def test_scenario_shows_weight_and_deadline_ordering(db: Session) -> None:
    seed_scenario(db, NOW)
    entries = [
        e for e in active_schedule(db, NOW) if e.order.customer.phone_wa.startswith("6281299088")
    ]
    names = [e.order.customer.name for e in entries]
    # Budi (40 kg, melebihi kapasitas 4 mesin) di atas Rina (4 kg) walau janji Rina lebih awal.
    assert names == [
        "Budi Santoso",
        "Rina Marpaung",
        "Tono Sihombing",
        "Sari Lubis",
        "Dewi Purba",
        "Joko Tarigan",
        "Lina Ginting",
    ]
    budi, rina = entries[0], entries[1]
    assert budi.order.promised_ready_at > rina.order.promised_ready_at
    assert (budi.processing_hours, budi.slack_hours) == (6.0, 0.5)
    assert (rina.processing_hours, rina.slack_hours) == (3.0, 1.0)
    assert all(e.order.received_at <= NOW for e in entries)


def test_scenario_can_be_reseeded_and_removed(db: Session) -> None:
    seed_scenario(db, NOW)
    seed_scenario(db, NOW)
    assert remove_scenario(db) == 7
    assert remove_scenario(db) == 0
