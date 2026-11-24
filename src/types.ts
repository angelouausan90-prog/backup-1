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
  image_url: string | null;
  is_active: number;
  stock_qty?: number;
}

export interface Warehouse {
  id: number;
  name: string;
  address: string;
  contact_person: string;
  contact_number: string;
  lat: number;
  lng: number;
  is_active: number;
}
