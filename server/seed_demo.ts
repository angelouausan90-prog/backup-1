import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const STANDARD_EQUIPMENT_ITEMS = [
  'Freezer',
  'Lock & Key',
  'Scraper',
  'Baskets',
  'Manual',
  'Freezer Cover',
];

function buildSignatureSvgDataUrl(label: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="80" viewBox="0 0 280 80"><path d="M20 55 Q 55 18 90 50 T 165 45 T 250 38" fill="none" stroke="#1e293b" stroke-width="2.5" stroke-linecap="round"/><text x="24" y="72" font-family="monospace" font-size="11" fill="#475569">${label}</text></svg>`
  )}`;
}

/**
 * Seeds optional demo accounts, Cotabato City franchisee stores, applications,
 * and orders ONLY when SEED_DEMO_DATA=true.
 * Login usernames are preserved so existing credentials continue to work.
 */
export function seedDemoData(db: Database.Database): void {
  const demoPasswordHash = bcrypt.hashSync('Test@1234', 10);

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (
      role_id, username, password_hash, full_name, email, contact_number,
      is_active, must_change_password, is_test
    )
    VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)
  `);

  insertUser.run(
    1,
    'admin_test',
    demoPasswordHash,
    'Ricardo Morales',
    'ricardo.morales@aicecotabato.ph',
    '09171111111',
    1
  );
  insertUser.run(
    2,
    'agent_test',
    demoPasswordHash,
    'Maria Santos',
    'maria.santos@aicecotabato.ph',
    '09172222222',
    1
  );
  insertUser.run(
    3,
    'franchisee_test',
    demoPasswordHash,
    'Juan Dela Cruz',
    'juan.delacruz@aicecotabato.ph',
    '09173333333',
    1
  );
  insertUser.run(
    3,
    'franchisee_pending_test',
    demoPasswordHash,
    'Pedro Reyes',
    'pedro.reyes@aicecotabato.ph',
    '09174444444',
    1
  );
  insertUser.run(
    4,
    'delivery_test',
    demoPasswordHash,
    'Carlo Mendoza',
    'carlo.mendoza@aicecotabato.ph',
    '09175555555',
    1
  );
  insertUser.run(
    3,
    'franchisee_delivery_test',
    demoPasswordHash,
    'Siti Aminah Sinsuat',
    'siti.sinsuat@aicecotabato.ph',
    '09176666666',
    1
  );
  insertUser.run(
    3,
    'franchisee_approved_test',
    demoPasswordHash,
    'Ramonito Mangelen',
    'ramonito.mangelen@aicecotabato.ph',
    '09177777777',
    1
  );

  const adminUser = db
    .prepare("SELECT id FROM users WHERE username = 'admin_test'")
    .get() as { id: number } | undefined;
  const agentUser = db
    .prepare("SELECT id FROM users WHERE username = 'agent_test'")
    .get() as { id: number } | undefined;
  const deliveryUser = db
    .prepare("SELECT id FROM users WHERE username = 'delivery_test'")
    .get() as { id: number } | undefined;
  const frActiveUser = db
    .prepare("SELECT id FROM users WHERE username = 'franchisee_test'")
    .get() as { id: number } | undefined;
  const frPendingUser = db
    .prepare("SELECT id FROM users WHERE username = 'franchisee_pending_test'")
    .get() as { id: number } | undefined;
  const frForDeliveryUser = db
    .prepare("SELECT id FROM users WHERE username = 'franchisee_delivery_test'")
    .get() as { id: number } | undefined;
  const frApprovedUser = db
    .prepare("SELECT id FROM users WHERE username = 'franchisee_approved_test'")
    .get() as { id: number } | undefined;

  if (agentUser && adminUser) {
    db.prepare('INSERT OR IGNORE INTO agents (user_id, created_by) VALUES (?, ?)').run(
      agentUser.id,
      adminUser.id
    );
    const agentRow = db
      .prepare('SELECT id FROM agents WHERE user_id = ?')
      .get(agentUser.id) as { id: number } | undefined;

    if (agentRow && frActiveUser) {
      db.prepare(`
        INSERT OR IGNORE INTO franchisees (
          user_id, agent_id, owner_name, store_name, address, contact_number,
          lat, lng, status, approved_by, approved_at
        )
        VALUES (
          ?, ?, 'Juan Dela Cruz', 'AICE Notre Dame Avenue Corner Store',
          '124 Notre Dame Ave, Brgy. Poblacion VI, Cotabato City, Maguindanao del Norte',
          '09173333333', 7.2215000, 124.2482000, 'Approved', ?, datetime('now')
        )
      `).run(frActiveUser.id, agentRow.id, adminUser.id);
    }

    if (agentRow && frPendingUser) {
      db.prepare(`
        INSERT OR IGNORE INTO franchisees (
          user_id, agent_id, owner_name, store_name, address, contact_number,
          lat, lng, status
        )
        VALUES (
          ?, ?, 'Pedro Reyes', 'AICE Awang Supermart',
          '88 Sinsuat Ave, Brgy. Awang, Datu Odin Sinsuat, Maguindanao del Norte',
          '09174444444', 7.1812000, 124.2294000, 'Pending'
        )
      `).run(frPendingUser.id, agentRow.id);
    }

    if (agentRow && frForDeliveryUser) {
      db.prepare(`
        INSERT OR IGNORE INTO franchisees (
          user_id, agent_id, owner_name, store_name, address, contact_number,
          lat, lng, status, approved_by, approved_at
        )
        VALUES (
          ?, ?, 'Siti Aminah Sinsuat', 'AICE Cotabato Rosary Heights Mart',
          '45 Sinsuat Ave, Brgy. Rosary Heights II, Cotabato City, Maguindanao del Norte',
          '09176666666', 7.2167000, 124.2500000, 'Approved', ?, datetime('now')
        )
      `).run(frForDeliveryUser.id, agentRow.id, adminUser.id);
    }

    if (agentRow && frApprovedUser) {
      db.prepare(`
        INSERT OR IGNORE INTO franchisees (
          user_id, agent_id, owner_name, store_name, address, contact_number,
          lat, lng, status, approved_by, approved_at
        )
        VALUES (
          ?, ?, 'Ramonito Mangelen', 'AICE Sinsuat Avenue Corner',
          '102 Sinsuat Ave, Brgy. Poblacion V, Cotabato City, Maguindanao del Norte',
          '09177777777', 7.2236000, 124.2464000, 'Approved', ?, datetime('now')
        )
      `).run(frApprovedUser.id, agentRow.id, adminUser.id);
    }
  }

  ensureFranchiseeApplicationsAndCodes(db, {
    adminUserId: adminUser?.id || null,
    agentUserId: agentUser?.id || null,
    deliveryUserId: deliveryUser?.id || null,
  });
}

export function ensureFranchiseeApplicationsAndCodes(
  db: Database.Database,
  ids: {
    adminUserId: number | null;
    agentUserId: number | null;
    deliveryUserId: number | null;
  }
): void {
  const allFranchisees = db
    .prepare(
      `SELECT f.*, u.username, u.email
       FROM franchisees f
       JOIN users u ON u.id = f.user_id
       ORDER BY f.id ASC`
    )
    .all() as any[];

  for (const fr of allFranchisees) {
    const existingApp = db
      .prepare('SELECT id, status FROM franchisee_applications WHERE franchisee_id = ?')
      .get(fr.id) as { id: number; status: string } | undefined;

    if (!existingApp) {
      const appNo = `FR-2026-${String(fr.id).padStart(4, '0')}`;
      const nameParts = String(fr.owner_name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || 'Applicant';
      const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : 'Owner';
      const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';

      let appStatus = 'Pending Admin Review';
      let assignedDeliveryId: number | null = null;
      let dateDelivered: string | null = null;
      let deliveredAt: string | null = null;
      let activatedAt: string | null = null;
      let cashierName = '';
      let collectorName = '';
      let deliveryTeamName = '';
      let driverName = '';
      const customerPrinted = fr.owner_name;
      let notedByName = '';
      let freezerNo = '';
      let landmark = 'Near main intersection / commercial strip';
      const fbAccount = `fb.com/${String(fr.store_name || 'store')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')}`;
      let street = '124 Notre Dame Ave';
      let barangay = 'Poblacion VI';
      let city = 'Cotabato City';
      let province = 'Maguindanao del Norte';

      if (fr.username === 'franchisee_test') {
        appStatus = 'Active';
        assignedDeliveryId = ids.deliveryUserId;
        dateDelivered = '2026-11-18';
        deliveredAt = '2026-11-18 14:30:00';
        activatedAt = '2026-11-18 15:00:00';
        cashierName = 'Lorna Mae Dizon';
        collectorName = 'Arnel P. Gutierrez';
        deliveryTeamName = 'JCDL Cold-Chain Team Alpha';
        driverName = 'Carlo Mendoza';
        notedByName = 'Ricardo Morales';
        freezerNo = 'FZ-COT-2026-0088';
        landmark = 'Across Notre Dame University Main Gate';
      } else if (fr.username === 'franchisee_pending_test') {
        appStatus = 'Pending Admin Review';
        street = '88 Sinsuat Ave';
        barangay = 'Awang';
        city = 'Datu Odin Sinsuat';
        province = 'Maguindanao del Norte';
        landmark = 'Near Awang Airport Junction';
      } else if (fr.username === 'franchisee_delivery_test') {
        appStatus = 'For Delivery';
        assignedDeliveryId = ids.deliveryUserId;
        cashierName = 'Lorna Mae Dizon';
        collectorName = 'Arnel P. Gutierrez';
        notedByName = 'Ricardo Morales';
        street = '45 Sinsuat Ave';
        barangay = 'Rosary Heights II';
        city = 'Cotabato City';
        province = 'Maguindanao del Norte';
        landmark = 'Beside Cotabato City Plaza & Southseas Mall';
      } else if (fr.username === 'franchisee_approved_test') {
        appStatus = 'Approved';
        cashierName = 'Lorna Mae Dizon';
        street = '102 Sinsuat Ave';
        barangay = 'Poblacion V';
        city = 'Cotabato City';
        province = 'Maguindanao del Norte';
        landmark = 'In front of Public Market Entrance';
      } else if (fr.status === 'Approved') {
        appStatus = 'Active';
      } else if (fr.status === 'Rejected') {
        appStatus = 'Rejected';
      }

      const appRes = db
        .prepare(
          `INSERT INTO franchisee_applications (
            application_no, franchisee_id, user_id, agent_id, date_applied,
            first_name, middle_name, last_name, complete_name, contact_number,
            store_name, street, barangay, city_municipality, province, full_address,
            landmark, facebook_account, email, remarks, lat, lng,
            status, rejection_reason, approved_by, approved_at,
            assigned_delivery_user_id, assigned_at, date_delivered, delivered_at, activated_at,
            cashier_name, collector_name, delivery_team_name, driver_name,
            customer_printed_name, noted_by_name, freezer_no
          ) VALUES (
            ?, ?, ?, ?, date('now'),
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?
          )`
        )
        .run(
          appNo,
          fr.id,
          fr.user_id,
          fr.agent_id,
          firstName,
          middleName,
          lastName,
          fr.owner_name,
          fr.contact_number,
          fr.store_name,
          street,
          barangay,
          city,
          province,
          fr.address,
          landmark,
          fbAccount,
          fr.email || 'store@aicecotabato.ph',
          'Verified electrical outlet and covered store front for AICE chest freezer.',
          fr.lat,
          fr.lng,
          appStatus,
          fr.rejection_reason || null,
          fr.approved_by || null,
          fr.approved_at || null,
          assignedDeliveryId,
          assignedDeliveryId ? '2026-11-18 09:00:00' : null,
          dateDelivered,
          deliveredAt,
          activatedAt,
          cashierName,
          collectorName,
          deliveryTeamName,
          driverName,
          customerPrinted,
          notedByName,
          freezerNo
        );

      const appId = Number(appRes.lastInsertRowid);
      const insertEq = db.prepare(
        `INSERT OR IGNORE INTO franchisee_equipment (application_id, item, condition, quantity, freezer_no)
         VALUES (?, ?, ?, ?, ?)`
      );

      for (const itemName of STANDARD_EQUIPMENT_ITEMS) {
        if (appStatus === 'Active') {
          insertEq.run(
            appId,
            itemName,
            'NEW',
            itemName === 'Baskets' ? 4 : 1,
            itemName === 'Freezer' ? freezerNo : ''
          );
        } else {
          insertEq.run(appId, itemName, 'NOT_ISSUED', 0, '');
        }
      }

      const insertSig = db.prepare(
        `INSERT OR IGNORE INTO franchisee_signatures (application_id, role, printed_name, signature_image, signed_by_user_id)
         VALUES (?, ?, ?, ?, ?)`
      );
      insertSig.run(
        appId,
        'sales_agent',
        'Maria Santos',
        buildSignatureSvgDataUrl('Maria Santos'),
        ids.agentUserId
      );

      if (appStatus === 'Active') {
        insertSig.run(
          appId,
          'customer',
          fr.owner_name,
          buildSignatureSvgDataUrl(fr.owner_name),
          fr.user_id
        );
        insertSig.run(
          appId,
          'delivery_team',
          deliveryTeamName,
          buildSignatureSvgDataUrl('JCDL Delivery Team'),
          ids.deliveryUserId
        );
        insertSig.run(
          appId,
          'driver',
          driverName,
          buildSignatureSvgDataUrl('Carlo Mendoza'),
          ids.deliveryUserId
        );
        insertSig.run(
          appId,
          'collector',
          collectorName,
          buildSignatureSvgDataUrl(collectorName),
          ids.adminUserId
        );
        insertSig.run(
          appId,
          'noted_by',
          notedByName,
          buildSignatureSvgDataUrl('Ricardo Morales'),
          ids.adminUserId
        );
      } else if (appStatus === 'For Delivery') {
        insertSig.run(
          appId,
          'noted_by',
          notedByName,
          buildSignatureSvgDataUrl('Ricardo Morales'),
          ids.adminUserId
        );
      }
    }
  }

  // Ensure every store in franchisees has a store_code
  const deterministicCodesByUsername: Record<string, string> = {
    franchisee_test: 'notredame-a8f3k9m2',
    franchisee_pending_test: 'awang-p4x7n2q8',
    franchisee_delivery_test: 'rosary-d3v9k1w4',
    franchisee_approved_test: 'sinsuat-m5r2t8z6',
  };

  const storesForCodes = db
    .prepare(
      `SELECT f.id, f.store_name, f.store_code, u.username
       FROM franchisees f
       JOIN users u ON u.id = f.user_id`
    )
    .all() as any[];

  for (const st of storesForCodes) {
    let code =
      st.store_code ||
      deterministicCodesByUsername[st.username];
    if (!code) {
      const slug = String(st.store_name || 'store')
        .toLowerCase()
        .replace(/^aice\s+/i, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 10);
      const token = Math.random().toString(36).slice(2, 10);
      code = `${slug || 'st'}-${token}`;
    }

    db.prepare(
      "UPDATE franchisees SET store_code = ? WHERE id = ? AND (store_code IS NULL OR store_code = '')"
    ).run(code, st.id);
    db.prepare(
      "UPDATE franchisee_applications SET store_code = ? WHERE franchisee_id = ? AND (store_code IS NULL OR store_code = '')"
    ).run(code, st.id);
  }
}
