export type RoleName = 'admin' | 'agent' | 'franchisee' | 'delivery';

export interface User {
  id: number;
  username: string;
  full_name: string;
  email?: string | null;
  contact_number?: string | null;
  role: RoleName;
  must_change_password: boolean;
  is_test?: boolean;
  franchisee?: {
    id: number;
    store_name: string;
    address: string;
    lat: number;
    lng: number;
    store_code?: string | null;
    is_open?: boolean;
    application_id?: number | null;
    application_no?: string | null;
    application_status?: string;
    freezer_no?: string;
    can_order_replenishment?: boolean;
  } | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type StockStatusLabel = 'In Stock' | 'Low Stock' | 'No Stock';

export interface ActiveRestockSummary {
  request_id: number;
  request_number: string;
  status: string;
  priority: string;
  expected_arrival_date: string | null;
  approved_qty: number;
}

export interface Product {
  id: number;
  category_id: number;
  category_name?: string;
  sku: string;
  name: string;
  flavor: string;
  size: string;
  price: number;
  low_stock_threshold: number;
  target_quantity?: number;
  safety_stock?: number;
  max_reservation_qty?: number | null;
  image_url: string | null;
  is_active: number;
  stock_qty?: number;
  physical_stock?: number;
  reserved_stock?: number;
  available_stock?: number;
  reorder_point?: number;
  stock_status?: StockStatusLabel;
  recommendation_label?: string | null;
  active_restock?: ActiveRestockSummary | null;
  franchisee_availability?: {
    blocked: boolean;
    message: string;
  };
}

export interface Warehouse {
  id: number;
  name: string;
  address: string;
  contact_person: string;
  contact_number: string;
  lat: number;
  lng: number;
  capacity_limit?: number;
  is_active: number;
}
