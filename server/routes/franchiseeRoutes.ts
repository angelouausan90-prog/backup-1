import bcrypt from 'bcryptjs';
import type { Router, Request, Response } from 'express';
import db, { type DbExecutor } from '../db.ts';
import {
  asyncHandler,
  authorize,
  requireWarehouse,
  parsePagination,
  getTodaySqlDate,
  generateFranchiseeUsername,
  logActivity,
  notifyUser,
  notifyAdmins,
  uploadStoreImage,
  saveUploadedFile,
  deleteUploadedFile,
} from '../helpers.ts';
import {
  FRANCHISEE_EQUIPMENT_ITEMS,
  normalizeApplicationStatus,
  canFranchiseeLogin,
  canFranchiseeOrderReplenishment,
  normalizePhMobileNumber,
  formatApplicationNumber,
  composeApplicantFullName,
  composeStoreFullAddress,
  validateFranchiseeStep1,
  validateFranchiseeStep2,
} from '../../src/utils/domainRules.ts';

export function registerFranchiseeApplicationRoutes(api: Router) {
  const getNextApplicationNo = async (executor: DbExecutor = db): Promise<string> => {
    const year = new Date().getFullYear();
    const maxRow = await executor.queryOne<{ max_id: number }>(
      'SELECT COALESCE(MAX(id), 0) AS max_id FROM franchisee_applications'
    );
    const seq = Number(maxRow?.max_id || 0) + 1;
    for (let i = 0; i < 50; i++) {
      const candidate = formatApplicationNumber(year, seq + i);
      const exists = await executor.queryOne(
        'SELECT id FROM franchisee_applications WHERE application_no = $1',
        [candidate]
      );
      if (!exists) return candidate;
    }
    return formatApplicationNumber(year, Date.now() % 100000);
  };

  const findDuplicateApplicationFields = async (
    contactNumberRaw: string,
    emailRaw: string,
    storeNameRaw: string,
    excludeApplicationId?: number | null,
    excludeFranchiseeId?: number | null,
    excludeUserId?: number | null
  ): Promise<Record<string, string>> => {
    const errors: Record<string, string> = {};
    const normContact = normalizePhMobileNumber(contactNumberRaw || '');
    const cleanEmail = String(emailRaw || '').trim().toLowerCase();
    const cleanStore = String(storeNameRaw || '').trim().toLowerCase();

    const appExclId = Number(excludeApplicationId || 0);
    const frExclId = Number(excludeFranchiseeId || 0);
    const uExclId = Number(excludeUserId || 0);

    if (normContact) {
      const altContact = normContact.startsWith('09')
        ? `+63${normContact.slice(1)}`
        : normContact;
      const dupAppContact = await db.queryOne<{ id: number }>(
        `SELECT id
         FROM franchisee_applications
         WHERE id != $1
           AND (REPLACE(REPLACE(contact_number, ' ', ''), '-', '') = $2
             OR REPLACE(REPLACE(contact_number, ' ', ''), '-', '') = $3)`,
        [appExclId, normContact, altContact]
      );

      const dupUserContact = await db.queryOne<{ id: number }>(
        `SELECT id
         FROM users
         WHERE id != $1
           AND REPLACE(REPLACE(COALESCE(contact_number, ''), ' ', ''), '-', '') = $2`,
        [uExclId, normContact]
      );

      if (dupAppContact || dupUserContact) {
        errors.contact_number =
          'This mobile contact number is already registered to another account/application.';
      }
    }

    if (cleanEmail) {
      const dupAppEmail = await db.queryOne(
        `SELECT id FROM franchisee_applications
         WHERE id != $1 AND LOWER(TRIM(email)) = $2`,
        [appExclId, cleanEmail]
      );
      const dupUserEmail = await db.queryOne(
        `SELECT id FROM users
         WHERE id != $1 AND LOWER(TRIM(COALESCE(email, ''))) = $2`,
        [uExclId, cleanEmail]
      );
      if (dupAppEmail || dupUserEmail) {
        errors.email = 'This email address is already registered to another user or application.';
      }
    }

    if (cleanStore) {
      const dupAppStore = await db.queryOne(
        `SELECT id FROM franchisee_applications
         WHERE id != $1 AND LOWER(TRIM(store_name)) = $2`,
        [appExclId, cleanStore]
      );
      const dupFrStore = await db.queryOne(
        `SELECT id FROM franchisees
         WHERE id != $1 AND LOWER(TRIM(store_name)) = $2`,
        [frExclId, cleanStore]
      );
      if (dupAppStore || dupFrStore) {
        errors.store_name = 'A franchisee store with this store name already exists.';
      }
    }

    return errors;
  };

  const hydrateApplicationRecord = async (appRow: any) => {
    if (!appRow) return null;
    const eqRows = await db.queryAll<any>(
      `SELECT id, application_id, item, condition, quantity, freezer_no, updated_at
       FROM franchisee_equipment
       WHERE application_id = $1`,
      [appRow.id]
    );

    const eqMap: Record<string, any> = {};
    for (const r of eqRows) {
      eqMap[r.item] = r;
    }

    const equipment = FRANCHISEE_EQUIPMENT_ITEMS.map((itemName) => {
      const found = eqMap[itemName];
      const cond = (found?.condition || 'NOT_ISSUED') as 'NEW' | 'OLD' | 'NOT_ISSUED';
      return {
        item_name: itemName,
        item: itemName,
        item_condition: cond,
        condition_status: cond,
        condition: cond,
        quantity: Number(found?.quantity || 0),
        freezer_no:
          itemName === 'Freezer'
            ? String(found?.freezer_no || appRow.freezer_no || '')
            : String(found?.freezer_no || ''),
        updated_at: found?.updated_at || null,
      };
    });

    const sigRows = await db.queryAll<any>(
      `SELECT fs.id, fs.application_id, fs.role, fs.printed_name, fs.signature_image,
              fs.signed_by_user_id, fs.signed_at, u.full_name AS signed_by_user_name
       FROM franchisee_signatures fs
       LEFT JOIN users u ON u.id = fs.signed_by_user_id
       WHERE fs.application_id = $1`,
      [appRow.id]
    );

    const signatures: Record<string, any> = {};
    for (const s of sigRows) {
      signatures[s.role] = {
        ...s,
        signature_data: s.signature_image,
      };
    }

    const normalizedStatus = normalizeApplicationStatus(appRow.status);

    return {
      ...appRow,
      id: Number(appRow.id),
      application_id: Number(appRow.id),
      franchisee_id: Number(appRow.franchisee_id),
      user_id: Number(appRow.user_id),
      agent_id: Number(appRow.agent_id),
      owner_name: appRow.complete_name || appRow.owner_name,
      address: appRow.full_address || appRow.address,
      status: normalizedStatus,
      application_status: normalizedStatus,
      legacy_status:
        appRow.franchisee_status ||
        (normalizedStatus === 'Pending Admin Review'
          ? 'Pending'
          : normalizedStatus === 'Rejected'
          ? 'Rejected'
          : 'Approved'),
      assigned_delivery_staff_name: appRow.assigned_delivery_name || null,
      assigned_delivery_staff_contact: appRow.assigned_delivery_contact || null,
      can_login: canFranchiseeLogin(normalizedStatus),
      can_order_replenishment: canFranchiseeOrderReplenishment(normalizedStatus),
      equipment,
      signatures,
      signatures_by_role: signatures,
      signatures_list: sigRows,
    };
  };

  const getHydratedApplicationBy = async (
    column: 'fa.id' | 'fa.franchisee_id' | 'fa.user_id',
    idVal: number
  ) => {
    const row = await db.queryOne<any>(
      `SELECT fa.*,
              f.status AS franchisee_status,
              u.username, u.is_active,
              au.full_name AS agent_name, au.username AS agent_username, au.contact_number AS agent_contact,
              du.full_name AS assigned_delivery_name, du.username AS assigned_delivery_username, du.contact_number AS assigned_delivery_contact,
              apu.full_name AS approved_by_name
       FROM franchisee_applications fa
       JOIN franchisees f ON f.id = fa.franchisee_id
       JOIN users u ON u.id = fa.user_id
       JOIN agents a ON a.id = fa.agent_id
       JOIN users au ON au.id = a.user_id
       LEFT JOIN users du ON du.id = fa.assigned_delivery_user_id
       LEFT JOIN users apu ON apu.id = fa.approved_by
       WHERE ${column} = $1`,
      [idVal]
    );

    return hydrateApplicationRecord(row);
  };

  const resolveApplicationByParamId = async (rawId: number) => {
    return (
      (await getHydratedApplicationBy('fa.id', rawId)) ||
      (await getHydratedApplicationBy('fa.franchisee_id', rawId))
    );
  };

  const upsertSignatureRow = async (
    applicationId: number,
    role: 'customer' | 'sales_agent' | 'delivery_team' | 'driver' | 'collector' | 'noted_by',
    printedName: string,
    signatureImage: string | null | undefined,
    signedByUserId: number | null,
    executor: DbExecutor = db
  ) => {
    const cleanName = String(printedName || '').trim();
    const cleanImg =
      signatureImage && String(signatureImage).trim() ? String(signatureImage).trim() : '';
    if (!cleanName && !cleanImg) return;
    await executor.execute(
      `INSERT INTO franchisee_signatures (application_id, role, printed_name, signature_image, signed_by_user_id, signed_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (application_id, role) DO UPDATE SET
         printed_name = CASE WHEN EXCLUDED.printed_name != '' THEN EXCLUDED.printed_name ELSE franchisee_signatures.printed_name END,
         signature_image = CASE WHEN EXCLUDED.signature_image != '' THEN EXCLUDED.signature_image ELSE franchisee_signatures.signature_image END,
         signed_by_user_id = COALESCE(EXCLUDED.signed_by_user_id, franchisee_signatures.signed_by_user_id),
         signed_at = CURRENT_TIMESTAMP`,
      [applicationId, role, cleanName, cleanImg, signedByUserId]
    );
  };

  // Duplicate check endpoint for Agent registration wizard
  api.get(
    '/franchisee-applications/check-duplicate',
    authorize('agent', 'admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const contactNumber = String(req.query.contact_number || '').trim();
      const email = String(req.query.email || '').trim();
      const storeName = String(req.query.store_name || '').trim();
      const excludeAppId = req.query.exclude_id ? Number(req.query.exclude_id) : null;

      let exclFrId: number | null = null;
      let exclUserId: number | null = null;
      if (excludeAppId) {
        const cur = await resolveApplicationByParamId(excludeAppId);
        if (cur) {
          exclFrId = cur.franchisee_id;
          exclUserId = cur.user_id;
        }
      }

      const errors = await findDuplicateApplicationFields(
        contactNumber,
        email,
        storeName,
        excludeAppId,
        exclFrId,
        exclUserId
      );

      res.json({
        hasDuplicates: Object.keys(errors).length > 0,
        errors,
      });
    })
  );

  // Active Delivery Staff options for Admin to assign equipment delivery
  api.get(
    '/franchisee-applications/delivery-staff-options',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (_req, res) => {
      const riders = await db.queryAll(
        `SELECT u.id, u.full_name, u.username, u.contact_number
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE r.name = 'delivery' AND u.is_active = 1
         ORDER BY u.full_name ASC`
      );
      res.json({ data: riders });
    })
  );

  // Franchisee read-only view of their own registration & equipment record
  api.get(
    '/franchisee-applications/my',
    authorize('franchisee'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const record = await getHydratedApplicationBy('fa.user_id', req.user!.id);
      if (!record) {
        res.status(404).json({ message: 'Franchisee application record not found.' });
        return;
      }
      res.json({ data: record });
    })
  );

  // Handler for creating a new franchisee application
  const handleCreateFranchiseeApplication = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body || {};

    const todayStr = await getTodaySqlDate();
    const dateApplied = String(body.date_applied || todayStr).trim().slice(0, 10);

    let firstName = String(body.first_name || '').trim();
    let middleName = String(body.middle_name || '').trim();
    let lastName = String(body.last_name || '').trim();
    if ((!firstName || !lastName) && body.owner_name) {
      const parts = String(body.owner_name).trim().split(/\s+/);
      firstName = firstName || parts[0] || '';
      lastName = lastName || (parts.length > 1 ? parts.slice(1).join(' ') : parts[0] || '');
    }

    let street = String(body.street || '').trim();
    let barangay = String(body.barangay || '').trim();
    let cityMunicipality = String(body.city_municipality || '').trim();
    let province = String(body.province || '').trim();
    if ((!street || !barangay || !cityMunicipality || !province) && body.address) {
      const addrParts = String(body.address)
        .split(',')
        .map((p: string) => p.trim())
        .filter(Boolean);
      street = street || addrParts[0] || String(body.address).trim();
      barangay = barangay || addrParts[1] || 'Poblacion';
      cityMunicipality = cityMunicipality || addrParts[2] || 'Cotabato City';
      province = province || addrParts[3] || 'Maguindanao del Norte';
    }

    const storeName = String(body.store_name || '').trim();
    const contactNumberRaw = String(body.contact_number || '').trim();
    const landmark = String(body.landmark || 'Near main thoroughfare').trim();
    const facebookAccount = String(body.facebook_account || '').trim();
    const email = String(body.email || '').trim();
    const remarks = String(
      body.remarks || 'New franchisee application submitted by Sales Agent.'
    ).trim();
    const initialPassword = String(body.initial_password || '');
    const lat = Number(body.lat);
    const lng = Number(body.lng);

    const step1Check = validateFranchiseeStep1(
      {
        date_applied: dateApplied,
        first_name: firstName,
        middle_name: middleName,
        last_name: lastName,
        contact_number: contactNumberRaw,
        store_name: storeName,
        email,
        facebook_account: facebookAccount,
        remarks,
        initial_password: initialPassword,
      },
      true
    );

    const step2Check = validateFranchiseeStep2({
      street,
      barangay,
      city_municipality: cityMunicipality,
      province,
      landmark,
      lat,
      lng,
    });

    const combinedErrors: Record<string, string> = {
      ...step1Check.errors,
      ...step2Check.errors,
    };

    if (Object.keys(combinedErrors).length > 0) {
      const firstErrMsg = Object.values(combinedErrors)[0];
      res.status(400).json({
        message: firstErrMsg,
        errors: combinedErrors,
      });
      return;
    }

    const dupErrors = await findDuplicateApplicationFields(contactNumberRaw, email, storeName);
    if (Object.keys(dupErrors).length > 0) {
      const firstDupMsg = Object.values(dupErrors)[0];
      res.status(409).json({
        message: firstDupMsg,
        errors: dupErrors,
      });
      return;
    }

    const normalizedContact = normalizePhMobileNumber(contactNumberRaw);
    const completeName = composeApplicantFullName(firstName, middleName, lastName);
    const fullAddress = composeStoreFullAddress(street, barangay, cityMunicipality, province);
    const hash = await bcrypt.hash(initialPassword, 10);

    const { newAppId, newFranchiseeId, username, applicationNo } = await db.transaction(
      async (tx) => {
        const genUsername = await generateFranchiseeUsername(completeName, storeName, tx);
        const genAppNo = await getNextApplicationNo(tx);
        const storePhotoUrl = req.file
          ? await saveUploadedFile('stores', 'store', req.file, tx)
          : null;

        const role = await tx.queryOne<{ id: number }>(
          "SELECT id FROM roles WHERE name = 'franchisee'"
        );
        const uRes = await tx.queryOne<{ id: number }>(
          `INSERT INTO users (role_id, username, password_hash, full_name, email, contact_number, is_active, must_change_password)
           VALUES ($1, $2, $3, $4, $5, $6, 1, 1)
           RETURNING id`,
          [role!.id, genUsername, hash, completeName, email, normalizedContact]
        );
        const newUserId = Number(uRes!.id);

        const fRes = await tx.queryOne<{ id: number }>(
          `INSERT INTO franchisees (user_id, agent_id, owner_name, store_name, address, contact_number, lat, lng, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending')
           RETURNING id`,
          [
            newUserId,
            req.user!.agentId,
            completeName,
            storeName,
            fullAddress,
            normalizedContact,
            lat,
            lng,
          ]
        );
        const frId = Number(fRes!.id);

        const appRes = await tx.queryOne<{ id: number }>(
          `INSERT INTO franchisee_applications (
             application_no, franchisee_id, user_id, agent_id, date_applied,
             first_name, middle_name, last_name, complete_name, contact_number,
             store_name, street, barangay, city_municipality, province, full_address,
             landmark, facebook_account, email, remarks, lat, lng, store_photo_url,
             freezer_no, status, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10,
             $11, $12, $13, $14, $15, $16,
             $17, $18, $19, $20, $21, $22, $23,
             '', 'Pending Admin Review', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
           )
           RETURNING id`,
          [
            genAppNo,
            frId,
            newUserId,
            req.user!.agentId,
            dateApplied,
            firstName,
            middleName,
            lastName,
            completeName,
            normalizedContact,
            storeName,
            street,
            barangay,
            cityMunicipality,
            province,
            fullAddress,
            landmark,
            facebookAccount,
            email,
            remarks,
            lat,
            lng,
            storePhotoUrl,
          ]
        );
        const appId = Number(appRes!.id);

        for (const itemName of FRANCHISEE_EQUIPMENT_ITEMS) {
          await tx.execute(
            `INSERT INTO franchisee_equipment (application_id, item, condition, quantity, freezer_no)
             VALUES ($1, $2, 'NOT_ISSUED', 0, '')`,
            [appId, itemName]
          );
        }

        await upsertSignatureRow(
          appId,
          'sales_agent',
          req.user!.full_name,
          body.sales_agent_signature || null,
          req.user!.id,
          tx
        );

        await notifyAdmins(
          `New Franchisee Application (${genAppNo})`,
          `Sales Agent ${req.user!.full_name} submitted NEW FRANCHISEE FORM ${genAppNo} for "${storeName}" (${completeName}). Waiting for Admin review.`,
          'approval',
          appId,
          tx
        );

        await logActivity(
          req.user!.id,
          'FRANCHISEE_REGISTERED',
          'franchisee',
          frId,
          `Submitted application ${genAppNo} for ${storeName}`,
          tx
        );

        return {
          newAppId: appId,
          newFranchiseeId: frId,
          username: genUsername,
          applicationNo: genAppNo,
        };
      }
    );

    const hydrated = await getHydratedApplicationBy('fa.id', newAppId);

    res.status(201).json({
      message: `Franchisee application ${applicationNo} submitted for Admin review.`,
      applicationId: newAppId,
      applicationNo,
      franchiseeId: newFranchiseeId,
      generatedUsername: username,
      application: hydrated,
    });
  });

  api.post(
    '/franchisee-applications',
    authorize('agent'),
    requireWarehouse,
    uploadStoreImage.single('store_photo'),
    handleCreateFranchiseeApplication
  );

  api.post(
    '/agent/franchisees',
    authorize('agent'),
    requireWarehouse,
    uploadStoreImage.single('store_photo'),
    handleCreateFranchiseeApplication
  );

  // List franchisee applications (role-filtered for Admin, Agent, Delivery Staff, Franchisee)
  const handleListFranchiseeApplications = asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req.query);
    const search = `%${String(req.query.search || '').trim()}%`;
    const statusParam = String(req.query.status || '').trim();

    const params: any[] = [search];
    let where =
      'WHERE (fa.store_name ILIKE $1 OR fa.complete_name ILIKE $1 OR fa.application_no ILIKE $1 OR u.username ILIKE $1 OR fa.city_municipality ILIKE $1)';

    if (req.user!.role === 'agent') {
      params.push(req.user!.agentId);
      where += ` AND fa.agent_id = $${params.length}`;
    } else if (req.user!.role === 'delivery') {
      params.push(req.user!.id);
      if (req.query.all_for_delivery === '1') {
        where += ` AND (fa.assigned_delivery_user_id = $${params.length} OR fa.status IN ('For Delivery', 'Delivered', 'Active'))`;
      } else {
        where += ` AND fa.assigned_delivery_user_id = $${params.length}`;
      }
    } else if (req.user!.role === 'franchisee') {
      params.push(req.user!.id);
      where += ` AND fa.user_id = $${params.length}`;
    }

    if (statusParam) {
      if (statusParam === 'Pending' || statusParam === 'Pending Admin Review') {
        where += " AND fa.status = 'Pending Admin Review'";
      } else if (statusParam === 'Approved_Group') {
        where += " AND fa.status IN ('Approved', 'For Delivery', 'Delivered', 'Active')";
      } else if (
        ['Approved', 'Rejected', 'For Delivery', 'Delivered', 'Active'].includes(statusParam)
      ) {
        params.push(statusParam);
        where += ` AND fa.status = $${params.length}`;
      }
    }

    const totalRow = await db.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total
       FROM franchisee_applications fa
       JOIN users u ON u.id = fa.user_id
       ${where}`,
      params
    );

    const rawRows = await db.queryAll<any>(
      `SELECT fa.*,
              f.status AS franchisee_status,
              u.username, u.is_active,
              au.full_name AS agent_name, au.username AS agent_username, au.contact_number AS agent_contact,
              du.full_name AS assigned_delivery_name, du.username AS assigned_delivery_username, du.contact_number AS assigned_delivery_contact,
              apu.full_name AS approved_by_name
       FROM franchisee_applications fa
       JOIN franchisees f ON f.id = fa.franchisee_id
       JOIN users u ON u.id = fa.user_id
       JOIN agents a ON a.id = fa.agent_id
       JOIN users au ON au.id = a.user_id
       LEFT JOIN users du ON du.id = fa.assigned_delivery_user_id
       LEFT JOIN users apu ON apu.id = fa.approved_by
       ${where}
       ORDER BY fa.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const data = await Promise.all(rawRows.map((r) => hydrateApplicationRecord(r)));

    let summaryWhere = 'WHERE 1=1';
    const summaryParams: any[] = [];
    if (req.user!.role === 'agent') {
      summaryParams.push(req.user!.agentId);
      summaryWhere += ` AND agent_id = $${summaryParams.length}`;
    } else if (req.user!.role === 'delivery') {
      summaryParams.push(req.user!.id);
      summaryWhere += ` AND assigned_delivery_user_id = $${summaryParams.length}`;
    } else if (req.user!.role === 'franchisee') {
      summaryParams.push(req.user!.id);
      summaryWhere += ` AND user_id = $${summaryParams.length}`;
    }

    const counts = await db.queryOne(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'Pending Admin Review' THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN status = 'Pending Admin Review' THEN 1 ELSE 0 END), 0) AS pending_review,
              COALESCE(SUM(CASE WHEN status IN ('Approved', 'For Delivery', 'Delivered', 'Active') THEN 1 ELSE 0 END), 0) AS approved,
              COALESCE(SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END), 0) AS approved_only,
              COALESCE(SUM(CASE WHEN status = 'For Delivery' THEN 1 ELSE 0 END), 0) AS for_delivery,
              COALESCE(SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END), 0) AS delivered,
              COALESCE(SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END), 0) AS active,
              COALESCE(SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END), 0) AS rejected
       FROM franchisee_applications
       ${summaryWhere}`,
      summaryParams
    );

    const total = totalRow?.total ?? 0;
    res.json({
      data,
      summary: counts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  });

  api.get(
    '/franchisee-applications',
    authorize('admin', 'agent', 'delivery', 'franchisee'),
    requireWarehouse,
    handleListFranchiseeApplications
  );

  api.get(
    '/agent/recruits',
    authorize('agent'),
    requireWarehouse,
    handleListFranchiseeApplications
  );
  api.get(
    '/admin/franchisees',
    authorize('admin'),
    requireWarehouse,
    handleListFranchiseeApplications
  );

  // Single application details
  api.get(
    '/franchisee-applications/:id',
    authorize('admin', 'agent', 'delivery', 'franchisee'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const record = await resolveApplicationByParamId(Number(req.params.id));
      if (!record) {
        res.status(404).json({ message: 'Franchisee application not found.' });
        return;
      }

      if (req.user!.role === 'agent' && record.agent_id !== req.user!.agentId) {
        res.status(403).json({ message: 'Forbidden: you can only view your own recruits.' });
        return;
      }
      if (req.user!.role === 'franchisee' && record.user_id !== req.user!.id) {
        res
          .status(403)
          .json({ message: 'Forbidden: you can only view your own registration form.' });
        return;
      }

      res.json({ data: record });
    })
  );

  // Full application payload formatted for official paper form print & PDF export
  api.get(
    '/franchisee-applications/:id/pdf',
    authorize('admin', 'agent', 'delivery', 'franchisee'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const record = await resolveApplicationByParamId(Number(req.params.id));
      if (!record) {
        res.status(404).json({ message: 'Franchisee application not found.' });
        return;
      }
      if (req.user!.role === 'agent' && record.agent_id !== req.user!.agentId) {
        res.status(403).json({ message: 'Forbidden.' });
        return;
      }
      if (req.user!.role === 'franchisee' && record.user_id !== req.user!.id) {
        res.status(403).json({ message: 'Forbidden.' });
        return;
      }

      res.json({
        company_header: 'AICE COTABATO-JCDL CORPORATION',
        form_banner: 'NEW FRANCHISEE FORM',
        generated_at: new Date().toISOString(),
        data: record,
      });
    })
  );

  // Agent edits an application while it is still "Pending Admin Review"
  api.put(
    '/franchisee-applications/:id',
    authorize('agent'),
    requireWarehouse,
    uploadStoreImage.single('store_photo'),
    asyncHandler(async (req, res) => {
      const record = await resolveApplicationByParamId(Number(req.params.id));
      if (!record) {
        res.status(404).json({ message: 'Franchisee application not found.' });
        return;
      }

      if (record.agent_id !== req.user!.agentId) {
        res.status(403).json({ message: 'You can only edit applications you registered.' });
        return;
      }

      if (record.status !== 'Pending Admin Review') {
        res.status(400).json({
          message: `Application ${record.application_no} is already "${record.status}" and can no longer be edited by the Agent.`,
        });
        return;
      }

      const body = req.body || {};
      const dateApplied = String(body.date_applied || record.date_applied).trim().slice(0, 10);
      const firstName = String(body.first_name ?? record.first_name).trim();
      const middleName = String(body.middle_name ?? record.middle_name).trim();
      const lastName = String(body.last_name ?? record.last_name).trim();
      const contactNumberRaw = String(body.contact_number ?? record.contact_number).trim();
      const storeName = String(body.store_name ?? record.store_name).trim();
      const street = String(body.street ?? record.street).trim();
      const barangay = String(body.barangay ?? record.barangay).trim();
      const cityMunicipality = String(body.city_municipality ?? record.city_municipality).trim();
      const province = String(body.province ?? record.province).trim();
      const landmark = String(body.landmark ?? record.landmark).trim();
      const facebookAccount = String(body.facebook_account ?? record.facebook_account).trim();
      const email = String(body.email ?? record.email).trim();
      const remarks = String(body.remarks ?? record.remarks).trim();
      const initialPassword = body.initial_password ? String(body.initial_password) : '';
      const lat = body.lat !== undefined ? Number(body.lat) : Number(record.lat);
      const lng = body.lng !== undefined ? Number(body.lng) : Number(record.lng);

      const step1Check = validateFranchiseeStep1(
        {
          date_applied: dateApplied,
          first_name: firstName,
          middle_name: middleName,
          last_name: lastName,
          contact_number: contactNumberRaw,
          store_name: storeName,
          email,
          facebook_account: facebookAccount,
          remarks,
          initial_password: initialPassword,
        },
        false
      );

      const step2Check = validateFranchiseeStep2({
        street,
        barangay,
        city_municipality: cityMunicipality,
        province,
        landmark,
        lat,
        lng,
      });

      const combinedErrors: Record<string, string> = {
        ...step1Check.errors,
        ...step2Check.errors,
      };

      if (Object.keys(combinedErrors).length > 0) {
        res.status(400).json({
          message: Object.values(combinedErrors)[0],
          errors: combinedErrors,
        });
        return;
      }

      const dupErrors = await findDuplicateApplicationFields(
        contactNumberRaw,
        email,
        storeName,
        record.id,
        record.franchisee_id,
        record.user_id
      );

      if (Object.keys(dupErrors).length > 0) {
        res.status(409).json({
          message: Object.values(dupErrors)[0],
          errors: dupErrors,
        });
        return;
      }

      const normalizedContact = normalizePhMobileNumber(contactNumberRaw);
      const completeName = composeApplicantFullName(firstName, middleName, lastName);
      const fullAddress = composeStoreFullAddress(street, barangay, cityMunicipality, province);
      const newHash = initialPassword ? await bcrypt.hash(initialPassword, 10) : null;

      await db.transaction(async (tx) => {
        let storePhotoUrl: string | null = record.store_photo_url;
        if (body.remove_store_photo === 'true') {
          await deleteUploadedFile(record.store_photo_url, tx);
          storePhotoUrl = null;
        }
        if (req.file) {
          await deleteUploadedFile(record.store_photo_url, tx);
          storePhotoUrl = await saveUploadedFile('stores', 'store', req.file, tx);
        }

        if (newHash) {
          await tx.execute(
            'UPDATE users SET full_name = $1, email = $2, contact_number = $3, password_hash = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5',
            [completeName, email, normalizedContact, newHash, record.user_id]
          );
        } else {
          await tx.execute(
            'UPDATE users SET full_name = $1, email = $2, contact_number = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
            [completeName, email, normalizedContact, record.user_id]
          );
        }

        await tx.execute(
          `UPDATE franchisees
           SET owner_name = $1, store_name = $2, address = $3, contact_number = $4, lat = $5, lng = $6
           WHERE id = $7`,
          [completeName, storeName, fullAddress, normalizedContact, lat, lng, record.franchisee_id]
        );

        await tx.execute(
          `UPDATE franchisee_applications
           SET date_applied = $1, first_name = $2, middle_name = $3, last_name = $4, complete_name = $5,
               contact_number = $6, store_name = $7, street = $8, barangay = $9, city_municipality = $10,
               province = $11, full_address = $12, landmark = $13, facebook_account = $14, email = $15,
               remarks = $16, lat = $17, lng = $18, store_photo_url = $19, updated_at = CURRENT_TIMESTAMP
           WHERE id = $20`,
          [
            dateApplied,
            firstName,
            middleName,
            lastName,
            completeName,
            normalizedContact,
            storeName,
            street,
            barangay,
            cityMunicipality,
            province,
            fullAddress,
            landmark,
            facebookAccount,
            email,
            remarks,
            lat,
            lng,
            storePhotoUrl,
            record.id,
          ]
        );

        if (body.sales_agent_signature) {
          await upsertSignatureRow(
            record.id,
            'sales_agent',
            req.user!.full_name,
            body.sales_agent_signature,
            req.user!.id,
            tx
          );
        }

        await logActivity(
          req.user!.id,
          'FRANCHISEE_APPLICATION_UPDATED',
          'franchisee',
          record.franchisee_id,
          `Updated application ${record.application_no} for ${storeName}`,
          tx
        );
      });

      const updated = await getHydratedApplicationBy('fa.id', record.id);
      res.json({
        message: `Application ${record.application_no} updated successfully.`,
        application: updated,
      });
    })
  );

  // Admin review: Approve or Reject application
  const handleAdminReviewApplication = asyncHandler(async (req: Request, res: Response) => {
    const record = await resolveApplicationByParamId(Number(req.params.id));
    if (!record) {
      res.status(404).json({ message: 'Franchisee application not found.' });
      return;
    }

    const {
      decision,
      rejection_reason,
      assigned_delivery_user_id,
      cashier_name,
      collector_name,
      collector_signature,
      noted_by_name,
      noted_by_signature,
      freezer_no,
    } = req.body || {};

    if (!['Approved', 'Rejected'].includes(decision)) {
      res.status(400).json({ message: 'Decision must be Approved or Rejected.' });
      return;
    }
    if (decision === 'Rejected' && (!rejection_reason || !String(rejection_reason).trim())) {
      res.status(400).json({
        message: 'Please provide a rejection reason when rejecting a franchisee application.',
      });
      return;
    }
    if (record.status !== 'Pending Admin Review') {
      res.status(400).json({
        message: `Application ${record.application_no} is already "${record.status}".`,
      });
      return;
    }

    const agRow = await db.queryOne<{ user_id: number }>('SELECT user_id FROM agents WHERE id = $1', [
      record.agent_id,
    ]);

    const riderId =
      decision === 'Approved' && assigned_delivery_user_id
        ? Number(assigned_delivery_user_id)
        : null;
    const nextAppStatus =
      decision === 'Rejected' ? 'Rejected' : riderId ? 'For Delivery' : 'Approved';

    const cleanNotedBy = String(noted_by_name || req.user!.full_name || '').trim();
    const cleanCashier = String(cashier_name ?? record.cashier_name ?? '').trim();
    const cleanCollector = String(collector_name ?? record.collector_name ?? '').trim();
    const cleanFreezerNo = String(freezer_no ?? record.freezer_no ?? '').trim();

    await db.transaction(async (tx) => {
      await tx.execute(
        `UPDATE franchisees
         SET status = $1, rejection_reason = $2, approved_by = $3, approved_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [
          decision === 'Rejected' ? 'Rejected' : 'Approved',
          decision === 'Rejected' ? String(rejection_reason).trim() : null,
          req.user!.id,
          record.franchisee_id,
        ]
      );

      await tx.execute(
        `UPDATE franchisee_applications
         SET status = $1,
             rejection_reason = $2,
             approved_by = $3,
             approved_at = CURRENT_TIMESTAMP,
             assigned_delivery_user_id = COALESCE($4::int, assigned_delivery_user_id),
             assigned_at = CASE WHEN $4::int IS NOT NULL THEN CURRENT_TIMESTAMP ELSE assigned_at END,
             cashier_name = $5,
             collector_name = $6,
             noted_by_name = $7,
             freezer_no = $8,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $9`,
        [
          nextAppStatus,
          decision === 'Rejected' ? String(rejection_reason).trim() : null,
          req.user!.id,
          riderId,
          cleanCashier,
          cleanCollector,
          cleanNotedBy,
          cleanFreezerNo,
          record.id,
        ]
      );

      if (cleanFreezerNo) {
        await tx.execute(
          `UPDATE franchisee_equipment
           SET freezer_no = $1
           WHERE application_id = $2 AND item = 'Freezer'`,
          [cleanFreezerNo, record.id]
        );
      }

      if (decision === 'Approved') {
        await upsertSignatureRow(
          record.id,
          'noted_by',
          cleanNotedBy,
          noted_by_signature || null,
          req.user!.id,
          tx
        );
      }

      if (cleanCollector || collector_signature) {
        await upsertSignatureRow(
          record.id,
          'collector',
          cleanCollector,
          collector_signature || null,
          req.user!.id,
          tx
        );
      }

      if (agRow?.user_id) {
        await notifyUser(
          agRow.user_id,
          `Application ${record.application_no} ${nextAppStatus}`,
          decision === 'Approved'
            ? `Your recruit "${record.store_name}" (${record.application_no}) has been Approved by Admin${
                riderId ? ' and scheduled For Delivery' : ''
              }.`
            : `Your recruit "${record.store_name}" (${record.application_no}) was Rejected. Reason: ${String(
                rejection_reason
              ).trim()}`,
          'approval',
          record.id,
          tx
        );
      }

      if (decision === 'Approved') {
        await notifyUser(
          record.user_id,
          `Franchisee Application ${record.application_no} Approved`,
          `Welcome to AICE Franchisee Hub! Your store "${record.store_name}" is now Approved. ${
            riderId
              ? 'A delivery team has been assigned to deliver your freezer and equipment.'
              : 'Your freezer and equipment delivery will be scheduled shortly.'
          }`,
          'approval',
          record.id,
          tx
        );
      }

      if (riderId) {
        await notifyUser(
          riderId,
          `New Equipment Delivery Assigned (${record.application_no})`,
          `Admin assigned you to deliver the freezer & equipment kit to "${record.store_name}" (${record.full_address}). Please complete the Equipment Checklist and on-site signatures upon delivery.`,
          'delivery',
          record.id,
          tx
        );
      }

      await logActivity(
        req.user!.id,
        `FRANCHISEE_${String(decision).toUpperCase()}`,
        'franchisee',
        record.franchisee_id,
        `${record.application_no} (${record.store_name}) -> ${nextAppStatus}`,
        tx
      );
    });

    const updated = await getHydratedApplicationBy('fa.id', record.id);
    res.json({
      message: `Application ${record.application_no} marked as ${nextAppStatus}.`,
      application: updated,
    });
  });

  api.post(
    '/franchisee-applications/:id/review',
    authorize('admin'),
    requireWarehouse,
    handleAdminReviewApplication
  );

  api.post(
    '/admin/franchisees/:id/review',
    authorize('admin'),
    requireWarehouse,
    handleAdminReviewApplication
  );

  // Admin assigns Delivery Staff for equipment delivery
  api.post(
    '/franchisee-applications/:id/assign-delivery',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const record = await resolveApplicationByParamId(Number(req.params.id));
      if (!record) {
        res.status(404).json({ message: 'Franchisee application not found.' });
        return;
      }

      if (record.status === 'Pending Admin Review' || record.status === 'Rejected') {
        res.status(400).json({
          message: 'Application must be Approved before assigning equipment delivery staff.',
        });
        return;
      }

      const {
        assigned_delivery_user_id,
        cashier_name,
        collector_name,
        collector_signature,
        noted_by_name,
        noted_by_signature,
        freezer_no,
      } = req.body || {};

      if (!assigned_delivery_user_id) {
        res.status(400).json({ message: 'Please select a Delivery Staff rider.' });
        return;
      }

      const rider = await db.queryOne<{ id: number; full_name: string }>(
        `SELECT u.id, u.full_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = $1 AND r.name = 'delivery' AND u.is_active = 1`,
        [Number(assigned_delivery_user_id)]
      );

      if (!rider) {
        res.status(404).json({ message: 'Selected Delivery Staff rider not found or inactive.' });
        return;
      }

      const nextStatus = record.status === 'Approved' ? 'For Delivery' : record.status;
      const cleanCashier = String(cashier_name ?? record.cashier_name ?? '').trim();
      const cleanCollector = String(collector_name ?? record.collector_name ?? '').trim();
      const cleanNotedBy = String(
        noted_by_name || record.noted_by_name || req.user!.full_name
      ).trim();
      const cleanFreezerNo = String(freezer_no ?? record.freezer_no ?? '').trim();

      await db.transaction(async (tx) => {
        await tx.execute(
          `UPDATE franchisee_applications
           SET assigned_delivery_user_id = $1,
               assigned_at = CURRENT_TIMESTAMP,
               status = $2,
               cashier_name = $3,
               collector_name = $4,
               noted_by_name = $5,
               freezer_no = $6,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $7`,
          [
            rider.id,
            nextStatus,
            cleanCashier,
            cleanCollector,
            cleanNotedBy,
            cleanFreezerNo,
            record.id,
          ]
        );

        if (cleanFreezerNo) {
          await tx.execute(
            `UPDATE franchisee_equipment
             SET freezer_no = $1
             WHERE application_id = $2 AND item = 'Freezer'`,
            [cleanFreezerNo, record.id]
          );
        }

        if (cleanNotedBy || noted_by_signature) {
          await upsertSignatureRow(
            record.id,
            'noted_by',
            cleanNotedBy,
            noted_by_signature || null,
            req.user!.id,
            tx
          );
        }

        if (cleanCollector || collector_signature) {
          await upsertSignatureRow(
            record.id,
            'collector',
            cleanCollector,
            collector_signature || null,
            req.user!.id,
            tx
          );
        }

        await notifyUser(
          rider.id,
          `New Equipment Delivery Assigned (${record.application_no})`,
          `You have been assigned to deliver the freezer & equipment kit to "${record.store_name}" (${record.full_address}). Landmark: ${record.landmark}. Contact: ${record.contact_number}.`,
          'delivery',
          record.id,
          tx
        );

        await notifyUser(
          record.user_id,
          `Equipment Delivery Scheduled (${record.application_no})`,
          `Delivery rider ${rider.full_name} has been assigned to deliver your AICE freezer and starter equipment kit to "${record.store_name}".`,
          'delivery',
          record.id,
          tx
        );

        await logActivity(
          req.user!.id,
          'EQUIPMENT_DELIVERY_ASSIGNED',
          'franchisee',
          record.franchisee_id,
          `Assigned rider ${rider.full_name} to ${record.application_no} (${nextStatus})`,
          tx
        );
      });

      const updated = await getHydratedApplicationBy('fa.id', record.id);
      res.json({
        message: `Assigned ${rider.full_name} for equipment delivery (${record.application_no}).`,
        application: updated,
      });
    })
  );

  // Admin sign-off / Cashier / Collector / Noted By update
  api.post(
    '/franchisee-applications/:id/admin-signoff',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const record = await resolveApplicationByParamId(Number(req.params.id));
      if (!record) {
        res.status(404).json({ message: 'Franchisee application not found.' });
        return;
      }

      const {
        cashier_name,
        collector_name,
        collector_signature,
        noted_by_name,
        noted_by_signature,
        freezer_no,
        status,
      } = req.body || {};

      const cleanCashier = String(cashier_name ?? record.cashier_name ?? '').trim();
      const cleanCollector = String(collector_name ?? record.collector_name ?? '').trim();
      const cleanNotedBy = String(
        noted_by_name ?? record.noted_by_name ?? req.user!.full_name
      ).trim();
      const cleanFreezerNo = String(freezer_no ?? record.freezer_no ?? '').trim();
      const nextStatus =
        status && ['Approved', 'For Delivery', 'Delivered', 'Active'].includes(status)
          ? status
          : record.status;

      await db.transaction(async (tx) => {
        await tx.execute(
          `UPDATE franchisee_applications
           SET cashier_name = $1,
               collector_name = $2,
               noted_by_name = $3,
               freezer_no = $4,
               status = $5,
               activated_at = CASE WHEN $5::text = 'Active' THEN COALESCE(activated_at, CURRENT_TIMESTAMP) ELSE activated_at END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $6`,
          [cleanCashier, cleanCollector, cleanNotedBy, cleanFreezerNo, nextStatus, record.id]
        );

        if (cleanFreezerNo) {
          await tx.execute(
            `UPDATE franchisee_equipment
             SET freezer_no = $1
             WHERE application_id = $2 AND item = 'Freezer'`,
            [cleanFreezerNo, record.id]
          );
        }

        if (cleanNotedBy || noted_by_signature) {
          await upsertSignatureRow(
            record.id,
            'noted_by',
            cleanNotedBy,
            noted_by_signature || null,
            req.user!.id,
            tx
          );
        }

        if (cleanCollector || collector_signature) {
          await upsertSignatureRow(
            record.id,
            'collector',
            cleanCollector,
            collector_signature || null,
            req.user!.id,
            tx
          );
        }

        await logActivity(
          req.user!.id,
          'FRANCHISEE_ADMIN_SIGNOFF',
          'franchisee',
          record.franchisee_id,
          `Updated Admin/Cashier/Collector sign-offs on ${record.application_no} (${nextStatus})`,
          tx
        );
      });

      const updated = await getHydratedApplicationBy('fa.id', record.id);
      res.json({
        message: `Sign-off details saved for ${record.application_no}.`,
        application: updated,
      });
    })
  );

  // Delivery Staff (or Admin) completes Section 2 (Equipment Checklist) and Section 3 (On-Site Signatures)
  api.post(
    '/franchisee-applications/:id/equipment-delivery',
    authorize('delivery', 'admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const record = await resolveApplicationByParamId(Number(req.params.id));
      if (!record) {
        res.status(404).json({ message: 'Franchisee application not found.' });
        return;
      }

      if (
        req.user!.role === 'delivery' &&
        record.assigned_delivery_user_id &&
        record.assigned_delivery_user_id !== req.user!.id
      ) {
        res.status(403).json({
          message: 'This equipment delivery is assigned to another delivery staff member.',
        });
        return;
      }

      if (record.status === 'Pending Admin Review' || record.status === 'Rejected') {
        res.status(400).json({
          message: 'Cannot record equipment delivery for an unapproved application.',
        });
        return;
      }

      const body = req.body || {};
      const todayStr = await getTodaySqlDate();
      const dateDelivered = String(body.date_delivered || record.date_delivered || todayStr)
        .trim()
        .slice(0, 10);

      const incomingEq: any[] = Array.isArray(body.equipment) ? body.equipment : [];
      const eqByName: Record<
        string,
        { item_condition: 'NEW' | 'OLD' | 'NOT_ISSUED'; quantity: number; freezer_no: string }
      > = {};

      for (const itemName of FRANCHISEE_EQUIPMENT_ITEMS) {
        const match = incomingEq.find(
          (e) => e && (e.item_name === itemName || e.item === itemName)
        );
        const condRaw = String(
          match?.item_condition || match?.condition_status || match?.condition || 'NOT_ISSUED'
        ).toUpperCase();
        const cond: 'NEW' | 'OLD' | 'NOT_ISSUED' =
          condRaw === 'NEW' ? 'NEW' : condRaw === 'OLD' ? 'OLD' : 'NOT_ISSUED';
        const qty =
          cond === 'NOT_ISSUED'
            ? 0
            : Math.max(1, parseInt(String(match?.quantity ?? '1'), 10) || 1);
        const fNo =
          itemName === 'Freezer'
            ? String(body.freezer_no ?? match?.freezer_no ?? record.freezer_no ?? '').trim()
            : '';
        eqByName[itemName] = {
          item_condition: cond,
          quantity: qty,
          freezer_no: fNo,
        };
      }

      const issuedItemsCount = Object.values(eqByName).filter(
        (e) => e.item_condition === 'NEW' || e.item_condition === 'OLD'
      ).length;

      if (issuedItemsCount === 0) {
        res.status(400).json({
          message: 'Please check at least one equipment item as NEW or OLD in Section 2.',
        });
        return;
      }

      const freezerEntry = eqByName['Freezer'];
      if (
        (freezerEntry.item_condition === 'NEW' || freezerEntry.item_condition === 'OLD') &&
        !freezerEntry.freezer_no
      ) {
        res.status(400).json({
          message: 'Freezer # (serial or asset number) is required when issuing a Freezer.',
        });
        return;
      }

      const customerPrintedName = String(
        body.customer_printed_name ||
          record.signatures?.customer?.printed_name ||
          record.complete_name ||
          ''
      ).trim();
      const customerSignature =
        body.customer_signature ||
        body.customer_signature_data ||
        record.signatures?.customer?.signature_image ||
        null;

      const deliveryTeamPrintedName = String(
        body.delivery_team_printed_name ||
          record.signatures?.delivery_team?.printed_name ||
          `${req.user!.full_name} Team`
      ).trim();
      const deliveryTeamSignature =
        body.delivery_team_signature ||
        body.delivery_team_signature_data ||
        record.signatures?.delivery_team?.signature_image ||
        null;

      const driverPrintedName = String(
        body.driver_printed_name ||
          record.signatures?.driver?.printed_name ||
          req.user!.full_name ||
          ''
      ).trim();
      const driverSignature =
        body.driver_signature ||
        body.driver_signature_data ||
        record.signatures?.driver?.signature_image ||
        null;

      if (!customerPrintedName || !customerSignature) {
        res.status(400).json({
          message:
            'Customer printed name and on-site signature are required to complete equipment handover.',
        });
        return;
      }
      if (!deliveryTeamPrintedName || !deliveryTeamSignature) {
        res.status(400).json({
          message: 'Delivery Team printed name and signature are required.',
        });
        return;
      }
      if (!driverPrintedName || !driverSignature) {
        res.status(400).json({
          message: 'Driver printed name and signature are required.',
        });
        return;
      }

      const collectorPrintedName = String(
        body.collector_printed_name ??
          body.collector_name ??
          record.collector_name ??
          record.signatures?.collector?.printed_name ??
          ''
      ).trim();
      const collectorSignature =
        body.collector_signature ||
        body.collector_signature_data ||
        record.signatures?.collector?.signature_image ||
        null;

      const cleanCashier = String(body.cashier_name ?? record.cashier_name ?? '').trim();
      const targetStatus = body.status === 'Delivered' ? 'Delivered' : 'Active';

      const agRow = await db.queryOne<{ user_id: number }>(
        'SELECT user_id FROM agents WHERE id = $1',
        [record.agent_id]
      );

      await db.transaction(async (tx) => {
        for (const itemName of FRANCHISEE_EQUIPMENT_ITEMS) {
          const entry = eqByName[itemName];
          await tx.execute(
            `INSERT INTO franchisee_equipment (application_id, item, condition, quantity, freezer_no, updated_at)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
             ON CONFLICT (application_id, item) DO UPDATE SET
               condition = EXCLUDED.condition,
               quantity = EXCLUDED.quantity,
               freezer_no = EXCLUDED.freezer_no,
               updated_at = CURRENT_TIMESTAMP`,
            [record.id, itemName, entry.item_condition, entry.quantity, entry.freezer_no]
          );
        }

        await upsertSignatureRow(
          record.id,
          'customer',
          customerPrintedName,
          customerSignature,
          record.user_id,
          tx
        );
        await upsertSignatureRow(
          record.id,
          'delivery_team',
          deliveryTeamPrintedName,
          deliveryTeamSignature,
          req.user!.id,
          tx
        );
        await upsertSignatureRow(
          record.id,
          'driver',
          driverPrintedName,
          driverSignature,
          req.user!.id,
          tx
        );

        if (collectorPrintedName || collectorSignature) {
          await upsertSignatureRow(
            record.id,
            'collector',
            collectorPrintedName,
            collectorSignature,
            req.user!.id,
            tx
          );
        }

        await tx.execute(
          `UPDATE franchisee_applications
           SET freezer_no = $1,
               date_delivered = $2,
               delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP),
               activated_at = CASE WHEN $3::text = 'Active' THEN COALESCE(activated_at, CURRENT_TIMESTAMP) ELSE activated_at END,
               assigned_delivery_user_id = COALESCE(assigned_delivery_user_id, $4::int),
               cashier_name = $5,
               collector_name = CASE WHEN $6::text != '' THEN $6::text ELSE collector_name END,
               status = $3,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $7`,
          [
            freezerEntry.freezer_no,
            dateDelivered,
            targetStatus,
            req.user!.role === 'delivery' ? req.user!.id : record.assigned_delivery_user_id,
            cleanCashier,
            collectorPrintedName,
            record.id,
          ]
        );

        await notifyAdmins(
          `Equipment Delivered & Signed (${record.application_no})`,
          `${req.user!.full_name} completed the equipment checklist (Freezer #${
            freezerEntry.freezer_no || 'N/A'
          }) and customer sign-off for "${record.store_name}". Franchisee is now ${targetStatus}.`,
          'delivery',
          record.id,
          tx
        );

        if (agRow?.user_id) {
          await notifyUser(
            agRow.user_id,
            `Recruit Activated (${record.application_no})`,
            `Equipment delivery and signatures for "${record.store_name}" are complete. Store status is now ${targetStatus}.`,
            'approval',
            record.id,
            tx
          );
        }

        await notifyUser(
          record.user_id,
          `Equipment Handover Complete — Store ${targetStatus}!`,
          `Your AICE freezer (${
            freezerEntry.freezer_no || 'Issued'
          }) and equipment checklist have been signed off. You can now place online stock replenishment orders!`,
          'approval',
          record.id,
          tx
        );

        await logActivity(
          req.user!.id,
          'FRANCHISEE_EQUIPMENT_DELIVERED',
          'franchisee',
          record.franchisee_id,
          `Completed equipment checklist & signatures for ${record.application_no} -> ${targetStatus}`,
          tx
        );
      });

      const updated = await getHydratedApplicationBy('fa.id', record.id);
      res.json({
        message: `Equipment checklist and signatures saved! "${record.store_name}" is now ${targetStatus}.`,
        application: updated,
        data: updated,
      });
    })
  );
}
