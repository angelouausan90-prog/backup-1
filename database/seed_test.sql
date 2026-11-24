-- OPTIONAL SEED ACCOUNTS FOR LOCAL EVALUATION (AICE Cotabato-JCDL Corporation)
-- No warehouses, products, or orders are seeded here so first-run Warehouse Setup lock can be verified as Admin.
USE aice_franchise_system;

-- Accounts below keep existing login usernames and have is_test = 1 (skips forced first-login password change)
INSERT IGNORE INTO users (role_id, username, password_hash, full_name, email, contact_number, is_active, must_change_password, is_test)
VALUES
  (1, 'admin_test', '$2a$10$w8S7r0Q9xM8q8p5z1Y7x6uO9N3L4K5J6H7G8F9D0S1A2Q3W4E5R6T', 'Ricardo Morales', 'admin_test@aicehub.local', '09171111111', 1, 0, 1),
  (2, 'agent_test', '$2a$10$w8S7r0Q9xM8q8p5z1Y7x6uO9N3L4K5J6H7G8F9D0S1A2Q3W4E5R6T', 'Maria Santos', 'agent_test@aicehub.local', '09172222222', 1, 0, 1),
  (3, 'franchisee_test', '$2a$10$w8S7r0Q9xM8q8p5z1Y7x6uO9N3L4K5J6H7G8F9D0S1A2Q3W4E5R6T', 'Juan Dela Cruz', 'franchisee_test@aicehub.local', '09173333333', 1, 0, 1),
  (3, 'franchisee_pending_test', '$2a$10$w8S7r0Q9xM8q8p5z1Y7x6uO9N3L4K5J6H7G8F9D0S1A2Q3W4E5R6T', 'Pedro Reyes', 'pending_test@aicehub.local', '09174444444', 1, 0, 1),
  (4, 'delivery_test', '$2a$10$w8S7r0Q9xM8q8p5z1Y7x6uO9N3L4K5J6H7G8F9D0S1A2Q3W4E5R6T', 'Carlo Mendoza', 'delivery_test@aicehub.local', '09175555555', 1, 0, 1);

INSERT IGNORE INTO agents (user_id, created_by)
SELECT u.id, (SELECT id FROM users WHERE username = 'admin_test' LIMIT 1)
FROM users u WHERE u.username = 'agent_test';

-- Approved franchisee recruited by Maria Santos
INSERT IGNORE INTO franchisees (user_id, agent_id, owner_name, store_name, address, contact_number, lat, lng, store_code, is_open, status, approved_by, approved_at)
SELECT
  u.id,
  a.id,
  'Juan Dela Cruz',
  'AICE Notre Dame Avenue Corner Store',
  '124 Notre Dame Ave, Brgy. Poblacion VI, Cotabato City, Maguindanao del Norte',
  '09173333333',
  7.2215000,
  124.2482000,
  'notredame-a8f3k9m2',
  1,
  'Approved',
  (SELECT id FROM users WHERE username = 'admin_test' LIMIT 1),
  NOW()
FROM users u
JOIN agents a ON a.user_id = (SELECT id FROM users WHERE username = 'agent_test' LIMIT 1)
WHERE u.username = 'franchisee_test';

-- Pending franchisee recruited by Maria Santos
INSERT IGNORE INTO franchisees (user_id, agent_id, owner_name, store_name, address, contact_number, lat, lng, store_code, is_open, status)
SELECT
  u.id,
  a.id,
  'Pedro Reyes',
  'AICE Awang Supermart',
  '88 Sinsuat Ave, Brgy. Awang, Datu Odin Sinsuat, Maguindanao del Norte',
  '09174444444',
  7.1812000,
  124.2294000,
  'awang-p4x7n2q8',
  1,
  'Pending'
FROM users u
JOIN agents a ON a.user_id = (SELECT id FROM users WHERE username = 'agent_test' LIMIT 1)
WHERE u.username = 'franchisee_pending_test';

-- Digitized NEW FRANCHISEE FORM (AICE Cotabato-JCDL Corporation) records across statuses
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
  'AICE Notre Dame Avenue Corner Store', '124 Notre Dame Ave', 'Poblacion VI', 'Cotabato City', 'Maguindanao del Norte',
  '124 Notre Dame Ave, Brgy. Poblacion VI, Cotabato City, Maguindanao del Norte',
  'Across Notre Dame University Main Gate, beside pharmacy', 'fb.com/juandelacruz.aice', 'franchisee_test@aicehub.local',
  'High foot traffic university corner store.', 7.2215000, 124.2482000, 'FZ-COT-2026-0088', 'notredame-a8f3k9m2', 1, 'Active',
  (SELECT id FROM users WHERE username = 'admin_test' LIMIT 1), NOW(),
  (SELECT id FROM users WHERE username = 'delivery_test' LIMIT 1), NOW(),
  CURDATE(), NOW(), NOW(),
  'Lorna Mae Dizon', 'Arnel P. Gutierrez', 'Ricardo Morales'
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
  'AICE Awang Supermart', '88 Sinsuat Ave', 'Awang', 'Datu Odin Sinsuat', 'Maguindanao del Norte',
  '88 Sinsuat Ave, Brgy. Awang, Datu Odin Sinsuat, Maguindanao del Norte',
  'Near Awang Airport Junction along Sinsuat National Highway', 'fb.com/pedroreyes.awang', 'pending_test@aicehub.local',
  'New applicant awaiting Admin verification and freezer allocation.', 7.1812000, 124.2294000, '', 'awang-p4x7n2q8', 1, 'Pending Admin Review'
FROM franchisees f
JOIN users u ON u.id = f.user_id
WHERE u.username = 'franchisee_pending_test';

