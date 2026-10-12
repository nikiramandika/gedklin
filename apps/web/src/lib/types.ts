export type Role = "owner" | "admin" | "cashier";
export type OrderStatus = "RECEIVED" | "PROCESSING" | "READY" | "PICKED_UP";
export type CatalogGroup = "KILOAN" | "SETRIKA" | "KHUSUS" | "SATUAN";
export type Process = "C" | "CK" | "CKL" | "CKS" | "S" | "SATUAN";
export type CatalogUnit = "LOAD_7KG" | "KG" | "PCS" | "LOAD";

export interface User {
  id: number;
  name: string;
  username: string;
  role: Role;
  is_active: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface Customer {
  id: number;
  name: string;
  phone_wa: string;
}

export interface CatalogItem {
  code: string;
  name: string;
  group: CatalogGroup;
  process: Process;
  unit: CatalogUnit;
  price: number;
  extra_price: number | null;
  min_qty: number | null;
  kg_per_load: number | null;
  pcs_per_load: number | null;
  max_extra: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface AppSettings {
  express_multiplier: number;
  default_promise_hours: number;
  default_staff_on_duty: number;
  default_washers_available: number;
  default_dryers_available: number;
  default_open_time: string;
  default_close_time: string;
}

export interface ServicePromise {
  process: Process;
  regular_hours: number | null;
  express_hours: number | null;
  min_regular_hours: number | null;
}

export interface OrderItemInput {
  catalog_code: string;
  weight_kg?: number | null;
  qty_pcs?: number | null;
}

export interface OrderItem {
  catalog_code: string;
  name: string;
  group: CatalogGroup;
  process: Process;
  weight_kg: number | null;
  qty_pcs: number | null;
  loads: number | null;
  extra_kg: number | null;
  extra_pcs: number | null;
  subtotal: number;
}

export interface Quote {
  is_express: boolean;
  express_multiplier: number;
  items: OrderItem[];
  total: number;
}

export interface StatusHistory {
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_at: string;
}

export interface Order {
  id: number;
  tracking_code: string;
  customer: Customer;
  is_express: boolean;
  items: OrderItem[];
  price_total: number;
  status: OrderStatus;
  received_at: string;
  promised_ready_at: string | null;
  predicted_ready_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  delay_notif_count: number;
  ready_notif_sent: boolean;
  needs_followup: boolean;
  next_status: OrderStatus | null;
  queue_position: number | null;
}

export interface OrderDetail extends Order {
  history: StatusHistory[];
}

export interface Receipt {
  order: Order;
  tracking_url: string;
  whatsapp_link: string;
  message: string;
}

export interface TrackingItem {
  name: string;
  weight_kg: number | null;
  qty_pcs: number | null;
}

export interface Tracking {
  tracking_code: string;
  is_express: boolean;
  items: TrackingItem[];
  status: OrderStatus;
  received_at: string;
  promised_ready_at: string | null;
  predicted_ready_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  history: StatusHistory[];
}

export interface DailyOperation {
  date: string;
  is_open: boolean;
  staff_on_duty: number;
  washers_available: number;
  dryers_available: number;
  open_time: string;
  close_time: string;
  machine_issue_note: string | null;
}

export interface Dashboard {
  today_orders: number;
  today_revenue: number;
  today_kg: number;
  active_orders: number;
  active_loads: number;
  ready_not_picked: number;
  needs_followup: number;
  eta_mae_hours_7d: number | null;
  eta_within_tolerance_pct_7d: number | null;
  promise_mae_hours_7d: number | null;
  eta_samples_7d: number;
  eta_tolerance_hours: number;
  model_version: string;
  last_7_days: { date: string; orders: number; revenue: number }[];
  status_counts: Record<string, number>;
}
