-- TEST ACCOUNTS ONLY (Easy to delete before final capstone defense)
-- No warehouses, products, or orders are seeded here so first-run Warehouse Setup lock can be tested as Admin.
USE aice_franchise_system;

-- All test accounts share password: Test@1234 and have is_test = 1 (skips forced first-login password change)
INSERT IGNORE INTO users (role_id, username, password_hash, full_name, email, contact_number, is_active, must_change_password, is_test)
VALUES
  (1, 'admin_test', '$2a$10$w8S7r0Q9xM8q8p5z1Y7x6uO9N3L4K5J6H7G8F9D0S1A2Q3W4E5R6T', 'Test Admin', 'admin_test@aicehub.local', '09171111111', 1, 0, 1),
  (2, 'agent_test', '$2a$10$w8S7r0Q9xM8q8p5z1Y7x6uO9N3L4K5J6H7G8F9D0S1A2Q3W4E5R6T', 'Maria Santos (Test Agent)', 'agent_test@aicehub.local', '09172222222', 1, 0, 1),
  (3, 'franchisee_test', '$2a$10$w8S7r0Q9xM8q8p5z1Y7x6uO9N3L4K5J6H7G8F9D0S1A2Q3W4E5R6T', 'Juan Dela Cruz', 'franchisee_test@aicehub.local', '09173333333', 1, 0, 1),
  (3, 'franchisee_pending_test', '$2a$10$w8S7r0Q9xM8q8p5z1Y7x6uO9N3L4K5J6H7G8F9D0S1A2Q3W4E5R6T', 'Pedro Reyes', 'pending_test@aicehub.local', '09174444444', 1, 0, 1),
  (4, 'delivery_test', '$2a$10$w8S7r0Q9xM8q8p5z1Y7x6uO9N3L4K5J6H7G8F9D0S1A2Q3W4E5R6T', 'Carlo Mendoza (Test Rider)', 'delivery_test@aicehub.local', '09175555555', 1, 0, 1),
  (5, 'customer_test', '$2a$10$w8S7r0Q9xM8q8p5z1Y7x6uO9N3L4K5J6H7G8F9D0S1A2Q3W4E5R6T', 'Angela Villanueva (Customer)', 'customer_test@aicehub.local', '09178888888', 1, 0, 1);

INSERT IGNORE INTO agents (user_id, created_by)
SELECT u.id, (SELECT id FROM users WHERE username = 'admin_test' LIMIT 1)
FROM users u WHERE u.username = 'agent_test';

-- Approved test franchisee recruited by agent_test
INSERT IGNORE INTO franchisees (user_id, agent_id, owner_name, store_name, address, contact_number, lat, lng, store_code, is_open, status, approved_by, approved_at)
SELECT
  u.id,
  a.id,
  'Juan Dela Cruz',
  'AICE Sampaloc Corner Store',
  '124 Espana Blvd, Sampaloc, Manila',
  '09173333333',
  14.6042000,
  120.9921000,
  'sampaloc-a8f3k9m2',
  1,
  'Approved',
  (SELECT id FROM users WHERE username = 'admin_test' LIMIT 1),
  NOW()
FROM users u
JOIN agents a ON a.user_id = (SELECT id FROM users WHERE username = 'agent_test' LIMIT 1)
WHERE u.username = 'franchisee_test';

-- Pending test franchisee recruited by agent_test (to test Admin approval/rejection flow)
INSERT IGNORE INTO franchisees (user_id, agent_id, owner_name, store_name, address, contact_number, lat, lng, store_code, is_open, status)
SELECT
  u.id,
  a.id,
  'Pedro Reyes',
  'AICE Cubao Ice Cream Mart',
  '88 Aurora Blvd, Cubao, Quezon City',
  '09174444444',
  14.6191000,
  121.0537000,
  'cubao-p4x7n2q8',
  1,
  'Pending'
FROM users u
JOIN agents a ON a.user_id = (SELECT id FROM users WHERE username = 'agent_test' LIMIT 1)
WHERE u.username = 'franchisee_pending_test';

-- Sample digitized NEW FRANCHISEE FORM (AICE Cotabato-JCDL Corporation) records across statuses
INSERT IGNORE INTO franchisee_applications (
  application_no, franchisee_id, user_id, agent_id, date_applied,
  first_name, middle_name, last_name, complete_name, contact_number,
  store_name, street, barangay, city_municipality, province, full_address,
  landmark, facebook_account, email, remarks, lat, lng, freezer_no, store_code, is_open, status,
  approved_by, approved_at, assigned_delivery_user_id, assigned_at,
  date_delivered, delivered_at, activated_at,
  cashier_name, collector_name, noted_by_name
)
SELECT
  'FR-2026-0001', f.id, f.user_id, f.agent_id, CURDATE(),
  'Juan', 'M.', 'Dela Cruz', 'Juan M. Dela Cruz', '09173333333',
  'AICE Sampaloc Corner Store', '124 Espana Blvd', 'Barangay 456', 'Sampaloc, Manila', 'Metro Manila',
  '124 Espana Blvd, Barangay 456, Sampaloc, Manila, Metro Manila',
  'Across UST Gate 2 beside 7-Eleven', 'fb.com/juandelacruz.aice', 'franchisee_test@aicehub.local',
  'High foot traffic university corner store.', 14.6042000, 120.9921000, 'FZ-COT-2026-0088', 'sampaloc-a8f3k9m2', 1, 'Active',
  (SELECT id FROM users WHERE username = 'admin_test' LIMIT 1), NOW(),
  (SELECT id FROM users WHERE username = 'delivery_test' LIMIT 1), NOW(),
  CURDATE(), NOW(), NOW(),
  'Lorna Bautista (Cashier)', 'Rodelio Datumanong (Collector)', 'Test Admin'
FROM franchisees f
JOIN users u ON u.id = f.user_id
WHERE u.username = 'franchisee_test';

INSERT IGNORE INTO franchisee_applications (
  application_no, franchisee_id, user_id, agent_id, date_applied,
  first_name, middle_name, last_name, complete_name, contact_number,
  store_name, street, barangay, city_municipality, province, full_address,
  landmark, facebook_account, email, remarks, lat, lng, freezer_no, store_code, is_open, status
)
SELECT
  'FR-2026-0002', f.id, f.user_id, f.agent_id, CURDATE(),
  'Pedro', 'S.', 'Reyes', 'Pedro S. Reyes', '09174444444',
  'AICE Cubao Ice Cream Mart', '88 Aurora Blvd', 'Barangay Socorro', 'Cubao, Quezon City', 'Metro Manila',
  '88 Aurora Blvd, Barangay Socorro, Cubao, Quezon City, Metro Manila',
  'Near Cubao LRT-2 Station', 'fb.com/pedroreyes.cubao', 'pending_test@aicehub.local',
  'New applicant awaiting Admin verification and freezer allocation.', 14.6191000, 121.0537000, '', 'cubao-p4x7n2q8', 1, 'Pending Admin Review'
FROM franchisees f
JOIN users u ON u.id = f.user_id
WHERE u.username = 'franchisee_pending_test';

-- Store QR Codes for Active and Pending stores
INSERT IGNORE INTO store_qr_codes (store_id, store_code)
SELECT f.id, 'sampaloc-a8f3k9m2'
FROM franchisees f JOIN users u ON u.id = f.user_id WHERE u.username = 'franchisee_test';

INSERT IGNORE INTO store_qr_codes (store_id, store_code)
SELECT f.id, 'cubao-p4x7n2q8'
FROM franchisees f JOIN users u ON u.id = f.user_id WHERE u.username = 'franchisee_pending_test';


