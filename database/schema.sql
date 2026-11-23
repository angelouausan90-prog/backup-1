-- AICE Franchisee Hub — MySQL Database Schema (XAMPP / Windows compatible)
CREATE DATABASE IF NOT EXISTS aice_franchise_system
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE aice_franchise_system;

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(30) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_id INT NOT NULL,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(120) NULL,
  contact_number VARCHAR(40) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  is_test TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS warehouses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  address VARCHAR(255) NOT NULL,
  contact_person VARCHAR(120) NOT NULL,
  contact_number VARCHAR(40) NOT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_warehouses_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS agents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_agents_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_agents_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS franchisees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  agent_id INT NOT NULL,
  owner_name VARCHAR(120) NOT NULL,
  store_name VARCHAR(150) NOT NULL,
  address VARCHAR(255) NOT NULL,
  contact_number VARCHAR(40) NOT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
  rejection_reason TEXT NULL,
  approved_by INT NULL,
  approved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_franchisees_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_franchisees_agent FOREIGN KEY (agent_id) REFERENCES agents(id),
  CONSTRAINT fk_franchisees_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT NOT NULL,
  sku VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  flavor VARCHAR(100) NOT NULL,
  size VARCHAR(60) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  low_stock_threshold INT NOT NULL DEFAULT 20,
  image_url VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  warehouse_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_warehouse_product (warehouse_id, product_id),
  CONSTRAINT fk_inventory_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
  CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(40) NOT NULL UNIQUE,
  franchisee_id INT NOT NULL,
  warehouse_id INT NOT NULL,
  status ENUM(
    'Placed',
    'Confirmed',
    'Preparing',
    'Assigned to Delivery',
    'Out for Delivery',
    'Near / Arrived',
    'Delivered',
    'Cancelled',
    'Rejected'
  ) NOT NULL DEFAULT 'Placed',
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  requested_delivery_datetime DATETIME NULL,
  notes TEXT NULL,
  stock_deducted TINYINT(1) NOT NULL DEFAULT 0,
  cancel_reason TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_franchisee FOREIGN KEY (franchisee_id) REFERENCES franchisees(id),
  CONSTRAINT fk_orders_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  warehouse_id INT NOT NULL,
  product_id INT NOT NULL,
  movement_type ENUM('STOCK_IN', 'ADJUSTMENT', 'ORDER_DEDUCT', 'ORDER_RESTORE') NOT NULL,
  quantity_change INT NOT NULL,
  previous_qty INT NOT NULL,
  new_qty INT NOT NULL,
  reference_order_id INT NULL,
  notes VARCHAR(255) NULL,
  performed_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sm_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_sm_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_sm_order FOREIGN KEY (reference_order_id) REFERENCES orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_sm_user FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_oi_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  status VARCHAR(40) NOT NULL,
  notes VARCHAR(255) NULL,
  changed_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_osh_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_osh_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS deliveries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL UNIQUE,
  delivery_staff_id INT NOT NULL,
  status ENUM('Assigned', 'Picked Up', 'Out for Delivery', 'Near / Arrived', 'Delivered') NOT NULL DEFAULT 'Assigned',
  accepted_at TIMESTAMP NULL,
  picked_up_at TIMESTAMP NULL,
  out_for_delivery_at TIMESTAMP NULL,
  arrived_at TIMESTAMP NULL,
  delivered_at TIMESTAMP NULL,
  proof_note TEXT NULL,
  proof_image_url VARCHAR(255) NULL,
  near_notified TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_deliveries_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_deliveries_staff FOREIGN KEY (delivery_staff_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS delivery_locations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  delivery_id INT NOT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dl_delivery_time (delivery_id, recorded_at),
  CONSTRAINT fk_dl_delivery FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS commissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_id INT NOT NULL,
  recruits_count INT NOT NULL DEFAULT 0,
  amount DECIMAL(12,2) NOT NULL,
  period_label VARCHAR(80) NOT NULL,
  status ENUM('Pending', 'Paid') NOT NULL DEFAULT 'Pending',
  notes VARCHAR(255) NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_comm_agent FOREIGN KEY (agent_id) REFERENCES agents(id),
  CONSTRAINT fk_comm_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'info',
  related_id INT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_user_read (user_id, is_read),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS activity_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id INT NULL,
  details TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_logs_created (created_at),
  CONSTRAINT fk_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Digitized "NEW FRANCHISEE FORM" (AICE Cotabato-JCDL Corporation)
CREATE TABLE IF NOT EXISTS franchisee_applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  application_no VARCHAR(40) NOT NULL UNIQUE,
  franchisee_id INT NOT NULL UNIQUE,
  user_id INT NOT NULL UNIQUE,
  agent_id INT NOT NULL,
  date_applied DATE NOT NULL,
  first_name VARCHAR(80) NOT NULL,
  middle_name VARCHAR(80) NOT NULL DEFAULT '',
  last_name VARCHAR(80) NOT NULL,
  complete_name VARCHAR(180) NOT NULL,
  contact_number VARCHAR(40) NOT NULL,
  store_name VARCHAR(150) NOT NULL,
  street VARCHAR(150) NOT NULL,
  barangay VARCHAR(120) NOT NULL,
  city_municipality VARCHAR(120) NOT NULL,
  province VARCHAR(120) NOT NULL,
  full_address VARCHAR(350) NOT NULL,
  landmark VARCHAR(255) NOT NULL DEFAULT '',
  facebook_account VARCHAR(180) NOT NULL DEFAULT '',
  email VARCHAR(120) NOT NULL,
  remarks TEXT NOT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  store_photo_url VARCHAR(255) NULL,
  freezer_no VARCHAR(80) NOT NULL DEFAULT '',
  status ENUM(
    'Pending Admin Review',
    'Approved',
    'Rejected',
    'For Delivery',
    'Delivered',
    'Active'
  ) NOT NULL DEFAULT 'Pending Admin Review',
  rejection_reason TEXT NULL,
  approved_by INT NULL,
  approved_at TIMESTAMP NULL,
  assigned_delivery_user_id INT NULL,
  assigned_at TIMESTAMP NULL,
  date_delivered DATE NULL,
  delivered_at TIMESTAMP NULL,
  activated_at TIMESTAMP NULL,
  cashier_name VARCHAR(120) NOT NULL DEFAULT '',
  collector_name VARCHAR(120) NOT NULL DEFAULT '',
  noted_by_name VARCHAR(120) NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_fapp_franchisee FOREIGN KEY (franchisee_id) REFERENCES franchisees(id) ON DELETE CASCADE,
  CONSTRAINT fk_fapp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_fapp_agent FOREIGN KEY (agent_id) REFERENCES agents(id),
  CONSTRAINT fk_fapp_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_fapp_delivery FOREIGN KEY (assigned_delivery_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS franchisee_equipment (
  id INT AUTO_INCREMENT PRIMARY KEY,
  application_id INT NOT NULL,
  item_name VARCHAR(80) NOT NULL,
  item_condition ENUM('NEW', 'OLD', 'NOT_ISSUED') NOT NULL DEFAULT 'NOT_ISSUED',
  quantity INT NOT NULL DEFAULT 0,
  freezer_no VARCHAR(80) NOT NULL DEFAULT '',
  updated_by INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_app_equipment_item (application_id, item_name),
  CONSTRAINT fk_feq_application FOREIGN KEY (application_id) REFERENCES franchisee_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_feq_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS franchisee_signatures (
  id INT AUTO_INCREMENT PRIMARY KEY,
  application_id INT NOT NULL,
  role ENUM('customer', 'sales_agent', 'delivery_team', 'driver', 'collector', 'noted_by') NOT NULL,
  printed_name VARCHAR(120) NOT NULL DEFAULT '',
  signature_image LONGTEXT NULL,
  signed_by_user_id INT NULL,
  signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_app_signature_role (application_id, role),
  CONSTRAINT fk_fsig_application FOREIGN KEY (application_id) REFERENCES franchisee_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_fsig_user FOREIGN KEY (signed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ===== QR CODE ORDERING FOR CUSTOMERS (Per Franchisee Store) =====
CREATE TABLE IF NOT EXISTS store_qr_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  store_id INT NOT NULL UNIQUE,
  store_code VARCHAR(40) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sqc_store FOREIGN KEY (store_id) REFERENCES franchisees(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS store_inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  store_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_store_product (store_id, product_id),
  CONSTRAINT fk_si_store FOREIGN KEY (store_id) REFERENCES franchisees(id) ON DELETE CASCADE,
  CONSTRAINT fk_si_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(40) NOT NULL UNIQUE,
  store_id INT NOT NULL,
  customer_user_id INT NULL,
  customer_name VARCHAR(150) NOT NULL,
  contact_no VARCHAR(40) NOT NULL,
  address VARCHAR(350) NOT NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  notes TEXT NULL,
  payment_method VARCHAR(60) NOT NULL DEFAULT 'Cash on Delivery',
  status ENUM(
    'Placed',
    'Accepted by store',
    'Preparing',
    'Out for Delivery',
    'Delivered',
    'Cancelled'
  ) NOT NULL DEFAULT 'Placed',
  rejection_reason TEXT NULL,
  delivery_staff_id INT NULL,
  stock_deducted TINYINT(1) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  accepted_at TIMESTAMP NULL,
  preparing_at TIMESTAMP NULL,
  out_for_delivery_at TIMESTAMP NULL,
  delivered_at TIMESTAMP NULL,
  cancelled_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_co_store FOREIGN KEY (store_id) REFERENCES franchisees(id) ON DELETE CASCADE,
  CONSTRAINT fk_co_customer FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_co_rider FOREIGN KEY (delivery_staff_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_coi_order FOREIGN KEY (order_id) REFERENCES customer_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_coi_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_order_locations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_col_order FOREIGN KEY (order_id) REFERENCES customer_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB;


