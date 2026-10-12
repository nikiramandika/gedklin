from enum import StrEnum


class Role(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    CASHIER = "cashier"


class CatalogGroup(StrEnum):
    KILOAN = "KILOAN"
    SETRIKA = "SETRIKA"
    KHUSUS = "KHUSUS"
    SATUAN = "SATUAN"


class Process(StrEnum):
    """Proses pengerjaan item katalog, dipakai untuk fitur ML dan janji waktu."""

    C = "C"
    CK = "CK"
    CKL = "CKL"
    CKS = "CKS"
    S = "S"
    SATUAN = "SATUAN"


class CatalogUnit(StrEnum):
    LOAD_7KG = "LOAD_7KG"  # per load kiloan + tambahan per kg
    KG = "KG"  # per kg, bisa ada minimal
    PCS = "PCS"  # per potong
    LOAD = "LOAD"  # per load item khusus + tambahan per pcs


class OrderStatus(StrEnum):
    RECEIVED = "RECEIVED"
    PROCESSING = "PROCESSING"
    READY = "READY"
    PICKED_UP = "PICKED_UP"


class NotificationType(StrEnum):
    READY = "READY"
    DELAY = "DELAY"


class NotificationStatus(StrEnum):
    PENDING = "PENDING"
    SENT = "SENT"
    FAILED = "FAILED"


ACTIVE_STATUSES = (OrderStatus.RECEIVED, OrderStatus.PROCESSING)
