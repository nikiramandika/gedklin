from enum import StrEnum


class Role(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    CASHIER = "cashier"


class ServiceType(StrEnum):
    CK = "CK"
    CKS = "CKS"


class OrderStatus(StrEnum):
    RECEIVED = "RECEIVED"
    WASHING = "WASHING"
    DRYING = "DRYING"
    IRONING = "IRONING"
    READY = "READY"
    PICKED_UP = "PICKED_UP"


class NotificationType(StrEnum):
    READY = "READY"
    DELAY = "DELAY"


class NotificationStatus(StrEnum):
    PENDING = "PENDING"
    SENT = "SENT"
    FAILED = "FAILED"


ACTIVE_STATUSES = (
    OrderStatus.RECEIVED,
    OrderStatus.WASHING,
    OrderStatus.DRYING,
    OrderStatus.IRONING,
)
