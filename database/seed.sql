-- AICE Franchisee Hub — Production Seed (Only Roles + 1 Admin Account)
USE aice_franchise_system;

INSERT IGNORE INTO roles (id, name) VALUES
  (1, 'admin'),
  (2, 'agent'),
  (3, 'franchisee'),
  (4, 'delivery');

-- Default Admin Account (Username: admin, Password: Admin@1234)
INSERT IGNORE INTO users (role_id, username, password_hash, full_name, email, contact_number, is_active, must_change_password, is_test)
VALUES (1, 'admin', '$2a$10$w8S7r0Q9xM8q8p5z1Y7x6uO9N3L4K5J6H7G8F9D0S1A2Q3W4E5R6T', 'System Administrator', 'admin@aicehub.local', '09170000001', 1, 0, 0);
