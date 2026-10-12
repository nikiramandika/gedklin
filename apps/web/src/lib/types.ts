export type Role = "owner" | "admin" | "cashier";
export type ServiceType = "CK" | "CKS";
export type OrderStatus =
  | "RECEIVED"
  | "WASHING"
  | "DRYING"
  | "IRONING"
  | "READY"
  | "PICKED_UP";

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

export interface Service {
  code: ServiceType;
  name: string;
  price_per_kg_regular: string;
  price_per_kg_express: string;
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
  service_type: ServiceType;
  is_express: boolean;
  weight_kg: number;
  price_total: string;
  status: OrderStatus;
  received_at: string;
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

export interface Tracking {
  tracking_code: string;
  service_type: ServiceType;
  is_express: boolean;
  weight_kg: number;
  status: OrderStatus;
  received_at: string;
  predicted_ready_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  history: StatusHistory[];
}

export interface DailyOperation {
  date: string;
  staff_on_duty: number;
  open_time: string;
  close_time: string;
  machine_issue_note: string | null;
}

export interface Dashboard {
  today_orders: number;
  today_revenue: string;
  today_kg: number;
  active_orders: number;
  active_kg: number;
  ready_not_picked: number;
  needs_followup: number;
  eta_mae_minutes_7d: number | null;
  eta_samples_7d: number;
  model_version: string;
  last_7_days: { date: string; orders: number; revenue: string }[];
  status_counts: Record<string, number>;
}
