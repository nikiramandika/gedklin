export type Role = "owner" | "cashier" | "staff";
export type OrderStatus = "RECEIVED" | "PROCESSING" | "READY" | "PICKED_UP" | "CANCELLED";
export type PaymentMethod = "CASH" | "QRIS" | "TRANSFER";
export type CatalogGroup = "KILOAN" | "SETRIKA" | "KHUSUS" | "SATUAN" | "DRY_CLEAN";
export type Process = "C" | "CK" | "CKL" | "CKS" | "S" | "SATUAN" | "DRY_CLEAN";
export type CatalogUnit = "KILOAN_7KG" | "KG" | "PCS" | "LOAD";

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
  has_whatsapp: boolean;
}

export interface CatalogItem {
  code: string;
  name: string;
  group: CatalogGroup;
  process: Process;
  unit: CatalogUnit;
  price: number | null;
  extra_price: number | null;
  base_kg: number | null;
  min_qty: number | null;
  kg_per_load: number | null;
  pcs_per_load: number | null;
  max_extra: number | null;
  /** Lama kerja (menit) per satuan harga. null = dihitung dari muatan mesin di Pengaturan. */
  work_minutes: number | null;
  /** Janji siap ke pelanggan dalam jam. null = janji default di Pengaturan. */
  promise_hours: number | null;
  express_promise_hours: number | null;
  express_eligible: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface AppSettings {
  express_multiplier: number;
  machine_capacity_kg: number;
  default_promise_hours: number;
  default_staff_on_duty: number;
  default_washers_available: number;
  default_dryers_available: number;
  default_open_time: string;
  default_close_time: string;
  /** Hari tutup rutin: 0 = Senin ... 6 = Minggu. */
  closed_weekdays: number[];
  outlet_name: string;
  outlet_address: string;
  outlet_phone: string;
  /** Lama kerja untuk penjadwalan antrean (menit). */
  wash_minutes_per_load: number;
  dry_minutes_per_load: number;
  iron_minutes_per_kg: number;
  iron_minutes_per_pcs: number;
}

export interface Outlet {
  name: string;
  address: string;
  phone: string;
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
  machine_loads: number | null;
  extra_kg: number | null;
  extra_pcs: number | null;
  is_express: boolean;
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
  changed_by_name?: string | null;
}

export interface Order {
  id: number;
  tracking_code: string;
  customer: Customer;
  is_express: boolean;
  items: OrderItem[];
  price_total: number;
  created_by_name: string | null;
  notes: string | null;
  rack_location: string | null;
  is_paid: boolean;
  payment_method: PaymentMethod | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  status: OrderStatus;
  received_at: string;
  promised_ready_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  ready_notif_sent: boolean;
  needs_followup: boolean;
  next_status: OrderStatus | null;
  queue_position: number | null;
  /** Hanya terisi di antrean: taksiran lama pengerjaan dan sisa waktu sampai janji (jam kerja). */
  processing_hours: number | null;
  slack_hours: number | null;
  /** Paling lambat mulai dikerjakan agar selesai tepat janji (janji dikurangi lama kerja). */
  latest_start_at: string | null;
}

export interface OrderDetail extends Order {
  history: StatusHistory[];
}

export interface Receipt {
  order: Order;
  outlet: Outlet;
  tracking_url: string;
  whatsapp_link: string;
  message: string;
}

/** Pesanan di layar Antrean Cucian (role staff): tanpa harga, pembayaran, dan nomor HP. */
export interface WorkItem {
  name: string;
  process: Process;
  weight_kg: number | null;
  qty_pcs: number | null;
  machine_loads: number | null;
}

export interface WorkOrder {
  id: number;
  tracking_code: string;
  customer_name: string;
  is_express: boolean;
  items: WorkItem[];
  notes: string | null;
  rack_location: string | null;
  status: OrderStatus;
  received_at: string;
  promised_ready_at: string | null;
  queue_position: number;
  next_status: OrderStatus | null;
  /** Taksiran lama pengerjaan dan sisa waktu sampai janji, dalam jam kerja. */
  processing_hours: number;
  slack_hours: number | null;
  /** Paling lambat mulai dikerjakan agar selesai tepat janji (janji dikurangi lama kerja). */
  latest_start_at: string | null;
}

export interface TrackingItem {
  name: string;
  weight_kg: number | null;
  qty_pcs: number | null;
}

export interface Tracking {
  tracking_code: string;
  customer_name: string;
  whatsapp_updates: boolean;
  is_express: boolean;
  items: TrackingItem[];
  price_total: number;
  is_paid: boolean;
  outlet: Outlet;
  outlet_today: { is_open: boolean; open_time: string; close_time: string };
  status: OrderStatus;
  received_at: string;
  promised_ready_at: string | null;
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
  done_7d: number;
  late_vs_promise_7d: number;
  on_time_pct_7d: number | null;
  avg_late_hours_7d: number | null;
  overdue_active: number;
  last_7_days: { date: string; orders: number; revenue: number }[];
  status_counts: Record<string, number>;
}

export interface OrderNotification {
  id: number;
  type: "RECEIPT" | "READY" | "DELAY";
  status: "PENDING" | "SENT" | "FAILED";
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

export type ActivityEntity =
  | "order"
  | "customer"
  | "catalog"
  | "user"
  | "settings"
  | "operation"
  | "report"
  | "auth";

export interface ActivityLog {
  id: number;
  user_id: number | null;
  user_name: string | null;
  action: string;
  entity_type: ActivityEntity;
  entity_id: string | null;
  summary: string;
  changes: Record<string, [unknown, unknown]> | null;
  created_at: string;
}

export interface CustomerSummary {
  id: number;
  name: string;
  phone_wa: string;
  has_whatsapp: boolean;
  created_at: string;
  order_count: number;
  total_spent: number;
  unpaid_total: number;
  last_order_at: string | null;
}

export interface CustomerDetail extends CustomerSummary {
  orders: Order[];
}

export interface ReportRow {
  key: string;
  label: string;
  orders: number;
  revenue: number;
  weight_kg: number;
  qty_pcs: number;
}

export interface Report {
  start: string;
  end: string;
  orders: number;
  revenue: number;
  weight_kg: number;
  avg_order_value: number;
  paid_total: number;
  unpaid_total: number;
  unpaid_orders: number;
  cancelled_orders: number;
  express_orders: number;
  by_day: { date: string; orders: number; revenue: number }[];
  by_service: ReportRow[];
  by_cashier: ReportRow[];
  by_payment: ReportRow[];
}

export type AiProvider = "gemini" | "openrouter";

export interface AiSettings {
  provider: AiProvider;
  model: string;
  has_key: boolean;
  key_hint: string | null;
  providers: { id: AiProvider; label: string; default_model: string }[];
}

export interface AiAnalysis {
  id: number;
  period_start: string;
  period_end: string;
  question: string | null;
  text: string;
  provider: AiProvider;
  model: string;
  created_by_name: string | null;
  created_at: string;
}
