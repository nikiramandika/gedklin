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
    DRY_CLEAN = "DRY_CLEAN"


class Process(StrEnum):
    """Proses pengerjaan item katalog, dipakai untuk fitur ML dan janji waktu."""

    C = "C"
    CK = "CK"
    CKL = "CKL"
    CKS = "CKS"
    S = "S"  # setrika saja
    SATUAN = "SATUAN"  # cuci-setrika manual tanpa mesin
    DRY_CLEAN = "DRY_CLEAN"


class CatalogUnit(StrEnum):
    KILOAN_7KG = "KILOAN_7KG"  # harga 7 kg pertama + tambahan per kg untuk sisa berat
    KG = "KG"  # per kg, bisa ada minimal
    PCS = "PCS"  # per potong
    LOAD = "LOAD"  # per load item khusus + tambahan per pcs


class OrderStatus(StrEnum):
    RECEIVED = "RECEIVED"
    PROCESSING = "PROCESSING"
    READY = "READY"
    PICKED_UP = "PICKED_UP"
    # Di luar alur utama: hanya dari RECEIVED/PROCESSING, dengan alasan.
    CANCELLED = "CANCELLED"


class PaymentMethod(StrEnum):
    """Pencatatan pembayaran di konter, bukan pembayaran online."""

    CASH = "CASH"
    QRIS = "QRIS"
    TRANSFER = "TRANSFER"


class NotificationType(StrEnum):
    RECEIPT = "RECEIPT"  # nota digital saat pesanan dibuat
    READY = "READY"
    DELAY = "DELAY"


class NotificationStatus(StrEnum):
    PENDING = "PENDING"
    SENT = "SENT"
    FAILED = "FAILED"


ACTIVE_STATUSES = (OrderStatus.RECEIVED, OrderStatus.PROCESSING)
