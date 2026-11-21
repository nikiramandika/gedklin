from enum import StrEnum


class Role(StrEnum):
    OWNER = "owner"
    CASHIER = "cashier"
    # Staff mengerjakan cucian di belakang: hanya melihat antrean dan mengubah status proses.
    STAFF = "staff"


class CatalogGroup(StrEnum):
    KILOAN = "KILOAN"
    SETRIKA = "SETRIKA"
    KHUSUS = "KHUSUS"
    SATUAN = "SATUAN"
    DRY_CLEAN = "DRY_CLEAN"


class Process(StrEnum):
    """Proses pengerjaan item katalog, dipakai untuk fitur ML dan janji waktu."""

    C = "C"
    CK = "CK"
    CKL = "CKL"
    CKS = "CKS"
    S = "S"
    SATUAN = "SATUAN"
    DRY_CLEAN = "DRY_CLEAN"


class CatalogUnit(StrEnum):
    KILOAN_7KG = "KILOAN_7KG"
    KG = "KG"
    PCS = "PCS"
    LOAD = "LOAD"


class OrderStatus(StrEnum):
    RECEIVED = "RECEIVED"
    PROCESSING = "PROCESSING"
    READY = "READY"
    PICKED_UP = "PICKED_UP"
    CANCELLED = "CANCELLED"


class PaymentMethod(StrEnum):
    """Pencatatan pembayaran di konter, bukan pembayaran online."""

    CASH = "CASH"
    QRIS = "QRIS"
    TRANSFER = "TRANSFER"


class NotificationType(StrEnum):
    RECEIPT = "RECEIPT"
    READY = "READY"
    DELAY = "DELAY"


class NotificationStatus(StrEnum):
    PENDING = "PENDING"
    SENT = "SENT"
    FAILED = "FAILED"


ACTIVE_STATUSES = (OrderStatus.RECEIVED, OrderStatus.PROCESSING)
