import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  roleId: integer('role_id')
    .notNull()
    .references(() => roles.id),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  email: text('email'),
  contactNumber: text('contact_number'),
  isActive: integer('is_active').notNull().default(1),
  mustChangePassword: integer('must_change_password').notNull().default(0),
  isTest: integer('is_test').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const warehouses = pgTable('warehouses', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address').notNull(),
  contactPerson: text('contact_person').notNull(),
  contactNumber: text('contact_number').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  capacityLimit: integer('capacity_limit').notNull().default(1000),
  isActive: integer('is_active').notNull().default(1),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const agents = pgTable('agents', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const franchisees = pgTable('franchisees', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  agentId: integer('agent_id')
    .notNull()
    .references(() => agents.id),
  ownerName: text('owner_name').notNull(),
  storeName: text('store_name').notNull(),
  address: text('address').notNull(),
  contactNumber: text('contact_number').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  status: text('status').notNull().default('Pending'),
  rejectionReason: text('rejection_reason'),
  approvedBy: integer('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approvedAt: timestamp('approved_at'),
  storeCode: text('store_code'),
  isOpen: integer('is_open').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow(),
});

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id')
    .notNull()
    .references(() => categories.id),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  flavor: text('flavor').notNull(),
  size: text('size').notNull(),
  price: doublePrecision('price').notNull(),
  lowStockThreshold: integer('low_stock_threshold').notNull().default(20),
  targetQuantity: integer('target_quantity').notNull().default(100),
  safetyStock: integer('safety_stock').notNull().default(15),
  maxReservationQty: integer('max_reservation_qty'),
  imageUrl: text('image_url'),
  isActive: integer('is_active').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const inventory = pgTable(
  'inventory',
  {
    id: serial('id').primaryKey(),
    warehouseId: integer('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(0),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [unique('inventory_warehouse_product_uniq').on(t.warehouseId, t.productId)]
);

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderNumber: text('order_number').notNull().unique(),
  franchiseeId: integer('franchisee_id')
    .notNull()
    .references(() => franchisees.id),
  warehouseId: integer('warehouse_id')
    .notNull()
    .references(() => warehouses.id),
  status: text('status').notNull().default('Placed'),
  totalAmount: doublePrecision('total_amount').notNull().default(0),
  subtotal: doublePrecision('subtotal').notNull().default(0),
  discountAmount: doublePrecision('discount_amount').notNull().default(0),
  deliveryFee: doublePrecision('delivery_fee').notNull().default(0),
  promoId: integer('promo_id'),
  appliedPromosJson: text('applied_promos_json'),
  requestedDeliveryDatetime: text('requested_delivery_datetime'),
  notes: text('notes'),
  stockDeducted: integer('stock_deducted').notNull().default(0),
  cancelReason: text('cancel_reason'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const stockMovements = pgTable('stock_movements', {
  id: serial('id').primaryKey(),
  warehouseId: integer('warehouse_id')
    .notNull()
    .references(() => warehouses.id),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id),
  movementType: text('movement_type').notNull(),
  quantityChange: integer('quantity_change').notNull(),
  previousQty: integer('previous_qty').notNull(),
  newQty: integer('new_qty').notNull(),
  referenceOrderId: integer('reference_order_id').references(() => orders.id, {
    onDelete: 'set null',
  }),
  notes: text('notes'),
  performedBy: integer('performed_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id),
  quantity: integer('quantity').notNull(),
  unitPrice: doublePrecision('unit_price').notNull(),
  subtotal: doublePrecision('subtotal').notNull(),
  discountAmount: doublePrecision('discount_amount').notNull().default(0),
  isFreeItem: integer('is_free_item').notNull().default(0),
});

export const orderStatusHistory = pgTable('order_status_history', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  notes: text('notes'),
  changedBy: integer('changed_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const deliveries = pgTable('deliveries', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .unique()
    .references(() => orders.id, { onDelete: 'cascade' }),
  deliveryStaffId: integer('delivery_staff_id')
    .notNull()
    .references(() => users.id),
  status: text('status').notNull().default('Assigned'),
  acceptedAt: timestamp('accepted_at'),
  pickedUpAt: timestamp('picked_up_at'),
  outForDeliveryAt: timestamp('out_for_delivery_at'),
  arrivedAt: timestamp('arrived_at'),
  deliveredAt: timestamp('delivered_at'),
  proofNote: text('proof_note'),
  proofImageUrl: text('proof_image_url'),
  nearNotified: integer('near_notified').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const deliveryLocations = pgTable('delivery_locations', {
  id: serial('id').primaryKey(),
  deliveryId: integer('delivery_id')
    .notNull()
    .references(() => deliveries.id, { onDelete: 'cascade' }),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  recordedAt: timestamp('recorded_at').defaultNow(),
});

export const commissions = pgTable('commissions', {
  id: serial('id').primaryKey(),
  agentId: integer('agent_id')
    .notNull()
    .references(() => agents.id),
  recruitsCount: integer('recruits_count').notNull().default(0),
  amount: doublePrecision('amount').notNull(),
  periodLabel: text('period_label').notNull(),
  status: text('status').notNull().default('Pending'),
  notes: text('notes'),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  message: text('message').notNull(),
  type: text('type').notNull().default('info'),
  relatedId: integer('related_id'),
  isRead: integer('is_read').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const activityLogs = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: integer('entity_id'),
  details: text('details'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const promos = pgTable('promos', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  promoType: text('promo_type').notNull(),
  tierBasis: text('tier_basis').notNull().default('quantity'),
  discountType: text('discount_type').notNull().default('percent'),
  discountValue: doublePrecision('discount_value').notNull().default(0),
  minOrderAmount: doublePrecision('min_order_amount').notNull().default(0),
  minQuantity: integer('min_quantity').notNull().default(0),
  buyQuantity: integer('buy_quantity').notNull().default(0),
  freeQuantity: integer('free_quantity').notNull().default(0),
  freeProductId: integer('free_product_id'),
  freeDelivery: integer('free_delivery').notNull().default(0),
  maxDiscountCap: doublePrecision('max_discount_cap'),
  scope: text('scope').notNull().default('all_products'),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  recurringMonthly: integer('recurring_monthly').notNull().default(0),
  usageLimitTotal: integer('usage_limit_total'),
  usageLimitPerFranchisee: integer('usage_limit_per_franchisee'),
  stackable: integer('stackable').notNull().default(0),
  status: text('status').notNull().default('Draft'),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const promoProducts = pgTable(
  'promo_products',
  {
    promoId: integer('promo_id')
      .notNull()
      .references(() => promos.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.promoId, t.productId] })]
);

export const promoCategories = pgTable(
  'promo_categories',
  {
    promoId: integer('promo_id')
      .notNull()
      .references(() => promos.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.promoId, t.categoryId] })]
);

export const promoTiers = pgTable('promo_tiers', {
  id: serial('id').primaryKey(),
  promoId: integer('promo_id')
    .notNull()
    .references(() => promos.id, { onDelete: 'cascade' }),
  minQuantityOrAmount: doublePrecision('min_quantity_or_amount').notNull(),
  discountValue: doublePrecision('discount_value').notNull(),
});

export const promoTargets = pgTable(
  'promo_targets',
  {
    promoId: integer('promo_id')
      .notNull()
      .references(() => promos.id, { onDelete: 'cascade' }),
    franchiseeId: integer('franchisee_id')
      .notNull()
      .references(() => franchisees.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.promoId, t.franchiseeId] })]
);

export const promoRedemptions = pgTable('promo_redemptions', {
  id: serial('id').primaryKey(),
  promoId: integer('promo_id')
    .notNull()
    .references(() => promos.id, { onDelete: 'cascade' }),
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  franchiseeId: integer('franchisee_id')
    .notNull()
    .references(() => franchisees.id, { onDelete: 'cascade' }),
  discountAmount: doublePrecision('discount_amount').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const promoDismissals = pgTable(
  'promo_dismissals',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    promoId: integer('promo_id')
      .notNull()
      .references(() => promos.id, { onDelete: 'cascade' }),
    dismissedAt: timestamp('dismissed_at').defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.promoId] })]
);

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const faqs = pgTable('faqs', {
  id: serial('id').primaryKey(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  keywords: text('keywords').default(''),
  audience: text('audience').notNull().default('all'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow(),
});

export const chatAiUsage = pgTable('chat_ai_usage', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const chatUnanswered = pgTable('chat_unanswered', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  question: text('question').notNull(),
  status: text('status').notNull().default('Open'),
  resolvedFaqId: integer('resolved_faq_id'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const franchiseeApplications = pgTable('franchisee_applications', {
  id: serial('id').primaryKey(),
  applicationNo: text('application_no').notNull().unique(),
  franchiseeId: integer('franchisee_id')
    .notNull()
    .unique()
    .references(() => franchisees.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  agentId: integer('agent_id')
    .notNull()
    .references(() => agents.id),
  dateApplied: text('date_applied')
    .notNull()
    .default(sql`to_char(CURRENT_DATE, 'YYYY-MM-DD')`),
  firstName: text('first_name').notNull(),
  middleName: text('middle_name').default(''),
  lastName: text('last_name').notNull(),
  completeName: text('complete_name').notNull(),
  contactNumber: text('contact_number').notNull(),
  storeName: text('store_name').notNull(),
  street: text('street').notNull(),
  barangay: text('barangay').notNull(),
  cityMunicipality: text('city_municipality').notNull(),
  province: text('province').notNull(),
  fullAddress: text('full_address').notNull(),
  landmark: text('landmark').default(''),
  facebookAccount: text('facebook_account').default(''),
  email: text('email').notNull(),
  remarks: text('remarks').default(''),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  storePhotoUrl: text('store_photo_url'),
  status: text('status').notNull().default('Pending Admin Review'),
  rejectionReason: text('rejection_reason'),
  approvedBy: integer('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approvedAt: timestamp('approved_at'),
  assignedDeliveryUserId: integer('assigned_delivery_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  assignedAt: timestamp('assigned_at'),
  dateDelivered: text('date_delivered'),
  deliveredAt: timestamp('delivered_at'),
  activatedAt: timestamp('activated_at'),
  cashierName: text('cashier_name').default(''),
  collectorName: text('collector_name').default(''),
  deliveryTeamName: text('delivery_team_name').default(''),
  driverName: text('driver_name').default(''),
  customerPrintedName: text('customer_printed_name').default(''),
  notedByName: text('noted_by_name').default(''),
  freezerNo: text('freezer_no').default(''),
  storeCode: text('store_code'),
  isOpen: integer('is_open').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const franchiseeEquipment = pgTable(
  'franchisee_equipment',
  {
    id: serial('id').primaryKey(),
    applicationId: integer('application_id')
      .notNull()
      .references(() => franchiseeApplications.id, { onDelete: 'cascade' }),
    item: text('item').notNull(),
    condition: text('condition').notNull().default('NOT_ISSUED'),
    quantity: integer('quantity').notNull().default(0),
    freezerNo: text('freezer_no').default(''),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [unique('franchisee_equipment_app_item_uniq').on(t.applicationId, t.item)]
);

export const franchiseeSignatures = pgTable(
  'franchisee_signatures',
  {
    id: serial('id').primaryKey(),
    applicationId: integer('application_id')
      .notNull()
      .references(() => franchiseeApplications.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    printedName: text('printed_name').notNull(),
    signatureImage: text('signature_image').notNull(),
    signedByUserId: integer('signed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    signedAt: timestamp('signed_at').defaultNow(),
  },
  (t) => [unique('franchisee_signatures_app_role_uniq').on(t.applicationId, t.role)]
);

export const uploadedFiles = pgTable('uploaded_files', {
  id: serial('id').primaryKey(),
  storageKey: text('storage_key').notNull().unique(),
  category: text('category').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  dataBase64: text('data_base64').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const restockRequests = pgTable(
  'restock_requests',
  {
    id: serial('id').primaryKey(),
    requestNumber: text('request_number').notNull().unique(),
    warehouseId: integer('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    triggerType: text('trigger_type').notNull().default('low_stock'),
    priority: text('priority').notNull().default('normal'),
    status: text('status').notNull().default('Draft'),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    approvedBy: integer('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at'),
    expectedArrivalDate: text('expected_arrival_date'),
    receivedBy: integer('received_by').references(() => users.id, { onDelete: 'set null' }),
    receivedAt: timestamp('received_at'),
    rejectionReason: text('rejection_reason'),
    remarks: text('remarks'),
    overdueNotified: integer('overdue_notified').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [
    index('idx_restock_requests_wh_status').on(t.warehouseId, t.status),
    index('idx_restock_requests_status_eta').on(t.status, t.expectedArrivalDate),
    index('idx_restock_requests_priority').on(t.priority),
  ]
);

export const restockRequestItems = pgTable(
  'restock_request_items',
  {
    id: serial('id').primaryKey(),
    requestId: integer('request_id')
      .notNull()
      .references(() => restockRequests.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    targetQtySnapshot: integer('target_qty_snapshot').notNull().default(100),
    physicalStockSnapshot: integer('physical_stock_snapshot').notNull().default(0),
    reservedStockSnapshot: integer('reserved_stock_snapshot').notNull().default(0),
    availableStockSnapshot: integer('available_stock_snapshot').notNull().default(0),
    reorderPointSnapshot: integer('reorder_point_snapshot').notNull().default(0),
    avgDailyOrdersSnapshot: doublePrecision('avg_daily_orders_snapshot').notNull().default(0),
    suggestedQty: integer('suggested_qty').notNull().default(0),
    approvedQty: integer('approved_qty').notNull().default(0),
    receivedQty: integer('received_qty'),
    differenceQty: integer('difference_qty'),
    differenceRemark: text('difference_remark'),
  },
  (t) => [
    unique('restock_request_items_req_prod_uniq').on(t.requestId, t.productId),
    index('idx_restock_request_items_product').on(t.productId),
  ]
);
