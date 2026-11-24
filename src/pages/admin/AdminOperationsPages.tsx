import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { PaginationBar, ProductImage, StatusText } from '../../components/SharedUI';
import {
  formatPromoHowItWorks,
  validatePromoPayload,
} from '../../utils/domainRules';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

// ===== 7. PRODUCTS & CATEGORIES (With Multer Image Upload, Live Preview, Neutral "No image" fallback) =====
export const ProductsManagementView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'catalog' | 'forecast'>('catalog');
  const [categories, setCategories] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    category_id: '',
    sku: '',
    name: '',
    flavor: '',
    size: '',
    price: '',
    low_stock_threshold: '20',
  });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadCategories = () => {
    api.get('/categories').then((res) => setCategories(res.data));
  };

  const loadProducts = (page = 1) => {
    api
      .get(
        `/products?page=${page}&search=${encodeURIComponent(search)}&category_id=${categoryFilter}`
      )
      .then((res) => {
        setProducts(res.data);
        setPagination(res.pagination);
      });
  };

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    loadProducts(1);
  }, [search, categoryFilter]);

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    setError('');
    try {
      await api.post('/categories', { name: newCategoryName.trim() });
      setNewCategoryName('');
      loadCategories();
    } catch (err: any) {
      setError(err.message || 'Failed to add category.');
    }
  };

  const handleFileChange = (selected: File | null) => {
    setFile(selected);
    setRemoveImage(false);
    setPreview(selected ? URL.createObjectURL(selected) : null);
  };

  const startEdit = (p: any) => {
    setEditingId(p.id);
    setForm({
      category_id: String(p.category_id),
      sku: p.sku,
      name: p.name,
      flavor: p.flavor,
      size: p.size,
      price: String(p.price),
      low_stock_threshold: String(p.low_stock_threshold),
    });
    setFile(null);
    setRemoveImage(false);
    setPreview(p.image_url || null);
  };

  const resetForm = () => {
    setEditingId(null);
    setFile(null);
    setPreview(null);
    setRemoveImage(false);
    setForm({
      category_id: '',
      sku: '',
      name: '',
      flavor: '',
      size: '',
      price: '',
      low_stock_threshold: '20',
    });
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    if (file) fd.append('image', file);
    if (removeImage) fd.append('remove_image', 'true');

    try {
      if (editingId) {
        await api.put(`/products/${editingId}`, fd);
        setMessage('Product updated.');
      } else {
        await api.post('/products', fd);
        setMessage('Product created.');
      }
      resetForm();
      loadProducts(1);
    } catch (err: any) {
      setError(err.message || 'Failed to save product.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Products, Categories & Demand Forecast
          </h1>
          <p className="text-sm text-slate-600">
            Manage AICE ice cream SKUs, upload authentic product photos, and view graphical demand forecasting based on franchisee most-ordered products.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/80 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'catalog'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Product Catalog & Uploads
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('forecast')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'forecast'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Demand Forecasting Graph
          </button>
        </div>
      </div>

      {activeTab === 'forecast' ? (
        <DemandForecastingView embedded />
      ) : (
        <>
          {message && (
            <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
              {message}
            </div>
          )}
          {error && (
            <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
              {error}
            </div>
          )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Product Categories</h2>
          <form onSubmit={handleAddCategory} className="flex gap-2">
            <input
              type="text"
              aria-label="New category name"
              placeholder="Enter category name"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              Add Category
            </button>
          </form>

          {categories.length === 0 ? (
            <p className="text-xs text-slate-500">
              No categories yet. Create at least one category before adding products.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 text-sm">
              {categories.map((c) => (
                <div key={c.id} className="py-2 flex items-center justify-between">
                  <span className="font-medium text-slate-800">{c.name}</span>
                  <span className="text-xs font-mono text-slate-400">ID #{c.id}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <form
          onSubmit={handleSaveProduct}
          className="lg:col-span-8 bg-white border border-slate-200 rounded-lg p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              {editingId ? 'Edit AICE Product' : 'Add New AICE Product'}
            </h2>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs font-semibold text-slate-600 hover:underline"
              >
                Cancel Edit
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="prod-cat" className="block text-xs font-semibold text-slate-700 mb-1">
                Category
              </label>
              <select
                id="prod-cat"
                required
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="">Select Category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="prod-sku" className="block text-xs font-semibold text-slate-700 mb-1">
                SKU Code
              </label>
              <input
                id="prod-sku"
                type="text"
                required
                placeholder="Enter SKU code"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
            <div>
              <label htmlFor="prod-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Product Name
              </label>
              <input
                id="prod-name"
                type="text"
                required
                placeholder="Enter product name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label htmlFor="prod-flavor" className="block text-xs font-semibold text-slate-700 mb-1">
                Flavor
              </label>
              <input
                id="prod-flavor"
                type="text"
                required
                placeholder="Enter flavor"
                value={form.flavor}
                onChange={(e) => setForm({ ...form, flavor: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label htmlFor="prod-size" className="block text-xs font-semibold text-slate-700 mb-1">
                Size / Pack
              </label>
              <input
                id="prod-size"
                type="text"
                required
                placeholder="Enter pack size or volume"
                value={form.size}
                onChange={(e) => setForm({ ...form, size: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label htmlFor="prod-price" className="block text-xs font-semibold text-slate-700 mb-1">
                Wholesale Price (PHP)
              </label>
              <input
                id="prod-price"
                type="number"
                step="0.01"
                required
                placeholder="0.00"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
            <div>
              <label htmlFor="prod-low" className="block text-xs font-semibold text-slate-700 mb-1">
                Low-Stock Threshold
              </label>
              <input
                id="prod-low"
                type="number"
                required
                value={form.low_stock_threshold}
                onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center pt-2 border-t border-slate-100">
            <div className="sm:col-span-8 space-y-1">
              <label htmlFor="prod-photo" className="block text-xs font-semibold text-slate-700">
                Upload Your Own AICE Product Photo (JPG, PNG, WEBP — max 5 MB)
              </label>
              <input
                id="prod-photo"
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100"
              />
              <p className="text-[11px] text-slate-500">
                Files are saved in <code>server/uploads/products/</code>. Products without a photo display a neutral "No image" box.
              </p>
            </div>
            <div className="sm:col-span-4 flex items-center justify-end gap-3">
              {preview ? (
                <div className="flex items-center gap-2">
                  <img
                    src={preview}
                    alt="Live preview"
                    className="w-20 h-15 rounded-md object-cover border border-slate-300"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      setPreview(null);
                      setRemoveImage(true);
                    }}
                    className="px-2.5 py-1 rounded border border-rose-300 text-xs font-medium text-rose-700 hover:bg-rose-50"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <ProductImage imageUrl={null} alt="No preview" thumb />
              )}
            </div>
          </div>

          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
          >
            {editingId ? 'Save Product Changes' : 'Create Product'}
          </button>
        </form>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <input
            type="search"
            aria-label="Search products"
            placeholder="Search products by SKU, name, or flavor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-72 px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
          />
          <select
            aria-label="Filter products by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 pr-4">Photo</th>
                <th className="py-2.5 pr-4">SKU</th>
                <th className="py-2.5 pr-4">Product Name & Flavor</th>
                <th className="py-2.5 pr-4">Category</th>
                <th className="py-2.5 pr-4">Size</th>
                <th className="py-2.5 pr-4 text-right">Price</th>
                <th className="py-2.5 pr-4 text-right">Total Stock</th>
                <th className="py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-sm text-slate-500">
                    No products created yet. Add a category and create your first AICE product above.
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-4">
                      <ProductImage imageUrl={p.image_url} alt={p.name} thumb />
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-slate-800">{p.sku}</td>
                    <td className="py-2.5 pr-4">
                      <div className="font-semibold text-slate-900">{p.name}</div>
                      <div className="text-xs text-slate-500">Flavor: {p.flavor}</div>
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-slate-700">{p.category_name}</td>
                    <td className="py-2.5 pr-4 text-xs text-slate-700">{p.size}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs font-semibold text-slate-900">
                      PHP {Number(p.price).toFixed(2)}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs text-slate-800">
                      {p.stock_qty}
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => startEdit(p)}
                        className="px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Edit / Photo
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationBar pagination={pagination} onPageChange={loadProducts} />
      </div>
        </>
      )}
    </div>
  );
};

// ===== 8. WAREHOUSE INVENTORY (Stock-In, Adjustments, Low-Stock Alerts) =====
export const InventoryManagementView: React.FC = () => {
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [selectedWh, setSelectedWh] = useState<string>('');
  const [rows, setRows] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [qtyInput, setQtyInput] = useState<Record<number, string>>({});
  const [notesInput, setNotesInput] = useState<Record<number, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/warehouses').then((res) => {
      setWarehouses(res.data);
      if (res.data.length > 0) setSelectedWh(String(res.data[0].id));
    });
  }, []);

  const load = (page = 1) => {
    if (!selectedWh) return;
    api
      .get(
        `/inventory?warehouse_id=${selectedWh}&page=${page}&search=${encodeURIComponent(search)}&low_only=${lowOnly ? '1' : '0'}`
      )
      .then((res) => {
        setRows(res.data);
        setPagination(res.pagination);
      });
    api.get(`/inventory/movements?warehouse_id=${selectedWh}&limit=8`).then((res) => {
      setMovements(res.data);
    });
  };

  useEffect(() => {
    load(1);
  }, [selectedWh, search, lowOnly]);

  const recordMovement = async (productId: number, movementType: 'STOCK_IN' | 'ADJUSTMENT') => {
    setError('');
    setMessage('');
    const delta = parseInt(qtyInput[productId] || '0', 10);
    if (!delta) {
      setError('Enter a non-zero quantity before clicking Stock-In or Adjust.');
      return;
    }
    try {
      await api.post('/inventory/movement', {
        warehouse_id: Number(selectedWh),
        product_id: productId,
        movement_type: movementType,
        quantity_change: delta,
        notes: notesInput[productId] || '',
      });
      setMessage('Warehouse inventory balance updated.');
      setQtyInput({ ...qtyInput, [productId]: '' });
      setNotesInput({ ...notesInput, [productId]: '' });
      load(pagination.page);
    } catch (err: any) {
      setError(err.message || 'Failed to update stock.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Warehouse Inventory & Stock Movements</h1>
          <p className="text-sm text-slate-600">
            Perform stock-in, manual stock adjustments, and monitor low-stock thresholds per warehouse.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="wh-select" className="text-xs font-semibold text-slate-700">
            Warehouse:
          </label>
          <select
            id="wh-select"
            value={selectedWh}
            onChange={(e) => setSelectedWh(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white font-medium"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {message && (
        <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
          {message}
        </div>
      )}
      {error && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <input
            type="search"
            aria-label="Search inventory"
            placeholder="Search SKU, product name, or flavor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-72 px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
          />
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(e) => setLowOnly(e.target.checked)}
              className="rounded border-slate-300"
            />
            Show Low-Stock Items Only
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 pr-4">Photo</th>
                <th className="py-2.5 pr-4">Product & SKU</th>
                <th className="py-2.5 pr-4 text-right">On-Hand Qty</th>
                <th className="py-2.5 pr-4 text-right">Threshold</th>
                <th className="py-2.5 pr-4">Alert</th>
                <th className="py-2.5 text-right">Stock-In / Adjustment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-slate-500">
                    No products found. Add products on the Products & Categories page first.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.product_id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-4">
                      <ProductImage imageUrl={r.image_url} alt={r.name} thumb />
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="font-semibold text-slate-900">{r.name}</div>
                      <div className="text-xs font-mono text-slate-500">
                        {r.sku} · {r.flavor} ({r.size})
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-sm font-bold text-slate-900">
                      {r.quantity}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs text-slate-500">
                      {r.low_stock_threshold}
                    </td>
                    <td className="py-2.5 pr-4">
                      <StatusText status={r.is_low_stock ? 'LOW' : 'OK'} />
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <input
                          type="number"
                          aria-label={`Quantity change for ${r.name}`}
                          placeholder="+/- Qty"
                          value={qtyInput[r.product_id] || ''}
                          onChange={(e) =>
                            setQtyInput({ ...qtyInput, [r.product_id]: e.target.value })
                          }
                          className="w-20 px-2 py-1 rounded border border-slate-300 text-xs font-mono"
                        />
                        <input
                          type="text"
                          aria-label={`Movement notes for ${r.name}`}
                          placeholder="Reason / batch..."
                          value={notesInput[r.product_id] || ''}
                          onChange={(e) =>
                            setNotesInput({ ...notesInput, [r.product_id]: e.target.value })
                          }
                          className="w-32 px-2 py-1 rounded border border-slate-300 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => recordMovement(r.product_id, 'STOCK_IN')}
                          className="px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 whitespace-nowrap shrink-0"
                        >
                          Stock-In
                        </button>
                        <button
                          type="button"
                          onClick={() => recordMovement(r.product_id, 'ADJUSTMENT')}
                          className="px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          Adjust
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationBar pagination={pagination} onPageChange={load} />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Recent Stock Movements</h2>
        {movements.length === 0 ? (
          <p className="text-sm text-slate-500">No stock movements recorded for this warehouse yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 font-semibold text-slate-500">
                  <th className="py-2 pr-4">Timestamp</th>
                  <th className="py-2 pr-4">Product</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4 text-right">Change</th>
                  <th className="py-2 pr-4 text-right">Prev → New</th>
                  <th className="py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2 pr-4 font-mono text-slate-500">{m.created_at}</td>
                    <td className="py-2 pr-4 font-medium text-slate-800">{m.product_name}</td>
                    <td className="py-2 pr-4 font-mono">{m.movement_type}</td>
                    <td className="py-2 pr-4 text-right font-mono font-semibold">
                      {m.quantity_change > 0 ? `+${m.quantity_change}` : m.quantity_change}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono text-slate-600">
                      {m.previous_qty} → {m.new_qty}
                    </td>
                    <td className="py-2 text-slate-600">{m.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ===== 9. ADMIN REPLENISHMENT ORDERS & DELIVERY ASSIGNMENT =====
export const AdminOrdersView: React.FC<{ onTrackOrder: (orderId: number) => void }> = ({
  onTrackOrder,
}) => {
  const [rows, setRows] = useState<any[]>([]);
  const [riders, setRiders] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedRider, setSelectedRider] = useState<Record<number, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = (page = 1) => {
    api
      .get(`/orders?page=${page}&search=${encodeURIComponent(search)}&status=${encodeURIComponent(statusFilter)}`)
      .then((res) => {
        setRows(res.data);
        setPagination(res.pagination);
      });
  };

  useEffect(() => {
    api.get('/admin/delivery-staff?limit=100').then((res) => {
      setRiders(res.data.filter((r: any) => r.is_active));
    });
  }, []);

  useEffect(() => {
    load(1);
  }, [search, statusFilter]);

  const updateStatus = async (orderId: number, status: string) => {
    setError('');
    setMessage('');
    try {
      await api.patch(`/orders/${orderId}/status`, { status });
      setMessage(`Order #${orderId} updated to ${status}.`);
      load(pagination.page);
    } catch (err: any) {
      setError(err.message || 'Failed to update order.');
    }
  };

  const assignRider = async (orderId: number) => {
    setError('');
    setMessage('');
    const staffId = selectedRider[orderId];
    if (!staffId) {
      setError('Select a delivery staff member first.');
      return;
    }
    try {
      await api.post(`/orders/${orderId}/assign-delivery`, {
        delivery_staff_id: Number(staffId),
      });
      setMessage('Delivery staff assigned to order.');
      load(pagination.page);
    } catch (err: any) {
      setError(err.message || 'Failed to assign delivery staff.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Replenishment Orders & Dispatch</h1>
        <p className="text-sm text-slate-600">
          Confirm orders (automatically deducts warehouse stock), assign delivery staff, or cancel/reject (restores stock).
        </p>
      </div>

      {message && (
        <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
          {message}
        </div>
      )}
      {error && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <input
            type="search"
            aria-label="Search orders"
            placeholder="Search order number or store name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-72 px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
          />
          <select
            aria-label="Filter orders by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
          >
            <option value="">All Order Statuses</option>
            <option value="Placed">Placed</option>
            <option value="Confirmed">Confirmed</option>
            <option value="Preparing">Preparing</option>
            <option value="Assigned to Delivery">Assigned to Delivery</option>
            <option value="Out for Delivery">Out for Delivery</option>
            <option value="Near / Arrived">Near / Arrived</option>
            <option value="Delivered">Delivered</option>
            <option value="Cancelled">Cancelled</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>

        <div className="space-y-4">
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">No replenishment orders match your filter.</p>
          ) : (
            rows.map((o) => (
              <div key={o.id} className="border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900">
                        {o.order_number}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="text-sm font-semibold text-slate-800">{o.store_name}</span>
                      <span className="text-slate-400">·</span>
                      <StatusText status={o.status} />
                    </div>
                    <div className="text-xs text-slate-500">
                      Origin: {o.warehouse_name} · Placed: <span className="font-mono">{o.created_at}</span>
                      {o.requested_delivery_datetime && (
                        <> · Requested Delivery: <span className="font-mono">{o.requested_delivery_datetime}</span></>
                      )}
                      {o.delivery_staff_name && (
                        <> · Rider: <strong className="text-slate-800">{o.delivery_staff_name}</strong></>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    {Number(o.discount_amount || 0) > 0 && (
                      <div className="text-xs font-mono text-slate-500">
                        Subtotal: PHP{' '}
                        {Number(o.subtotal || Number(o.total_amount) + Number(o.discount_amount)).toLocaleString('en-PH', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        ·{' '}
                        <span className="text-emerald-700 font-semibold">
                          Promo ({o.promo_name || 'Discount'}): -PHP{' '}
                          {Number(o.discount_amount).toLocaleString('en-PH', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                    <div className="font-mono text-sm font-bold text-slate-900">
                      PHP{' '}
                      {Number(o.total_amount).toLocaleString('en-PH', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => onTrackOrder(o.id)}
                      className="text-xs font-semibold text-rose-700 hover:underline"
                    >
                      Open Live Map & Timeline
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-2 border-t border-slate-100">
                  {(o.items || []).map((it: any) => (
                    <div key={it.id} className="flex items-center gap-2.5 text-xs">
                      <ProductImage imageUrl={it.image_url} alt={it.product_name} thumb />
                      <div>
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <span>{it.product_name}</span>
                          {Boolean(it.is_free_item) && (
                            <span className="text-[10px] font-bold text-emerald-700 uppercase">
                              [FREE PROMO]
                            </span>
                          )}
                        </div>
                        <div className="text-slate-500 font-mono">
                          {Boolean(it.is_free_item) ? (
                            <span className="text-emerald-700 font-semibold">
                              {it.quantity} free box(es) · PHP 0.00
                            </span>
                          ) : (
                            <>
                              {it.quantity} x PHP {Number(it.unit_price).toFixed(2)} = PHP{' '}
                              {Number(it.subtotal).toFixed(2)}
                              {Number(it.discount_amount || 0) > 0 && (
                                <span className="text-emerald-700 ml-1">
                                  (-PHP {Number(it.discount_amount).toFixed(2)})
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  <div className="flex flex-wrap items-center gap-2">
                    {o.status === 'Placed' && (
                      <>
                        <button
                          type="button"
                          onClick={() => updateStatus(o.id, 'Confirmed')}
                          className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
                        >
                          Confirm Order & Deduct Stock
                        </button>
                        <button
                          type="button"
                          onClick={() => updateStatus(o.id, 'Rejected')}
                          className="px-3 py-1.5 rounded border border-rose-300 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                        >
                          Reject Order
                        </button>
                      </>
                    )}
                    {o.status === 'Confirmed' && (
                      <button
                        type="button"
                        onClick={() => updateStatus(o.id, 'Preparing')}
                        className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                      >
                        Mark Preparing
                      </button>
                    )}
                    {['Confirmed', 'Preparing', 'Assigned to Delivery'].includes(o.status) && (
                      <button
                        type="button"
                        onClick={() => updateStatus(o.id, 'Cancelled')}
                        className="px-3 py-1.5 rounded border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Cancel & Restore Stock
                      </button>
                    )}
                  </div>

                  {['Confirmed', 'Preparing', 'Assigned to Delivery'].includes(o.status) && (
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={`Assign delivery rider for ${o.order_number}`}
                        value={selectedRider[o.id] || ''}
                        onChange={(e) =>
                          setSelectedRider({ ...selectedRider, [o.id]: e.target.value })
                        }
                        className="px-2.5 py-1.5 rounded border border-slate-300 text-xs bg-white"
                      >
                        <option value="">Select Delivery Rider...</option>
                        {riders.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.full_name || 'User'}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => assignRider(o.id)}
                        className="px-3 py-1.5 rounded bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0"
                      >
                        Assign Rider
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        <PaginationBar pagination={pagination} onPageChange={load} />
      </div>
    </div>
  );
};

// ===== 10. MANUAL AGENT COMMISSIONS =====
export const CommissionsManagementView: React.FC = () => {
  const [agents, setAgents] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [form, setForm] = useState({
    agent_id: '',
    amount: '',
    period_label: '',
    status: 'Pending',
    notes: '',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = (page = 1) => {
    api.get(`/commissions?page=${page}`).then((res) => {
      setRows(res.data);
      setPagination(res.pagination);
    });
  };

  useEffect(() => {
    api.get('/admin/agents?limit=100').then((res) => setAgents(res.data));
    load(1);
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/commissions', form);
      setMessage('Agent commission record saved.');
      setForm({ agent_id: '', amount: '', period_label: '', status: 'Pending', notes: '' });
      load(1);
    } catch (err: any) {
      setError(err.message || 'Failed to create commission.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Agent Recruitment Commissions</h1>
        <p className="text-sm text-slate-600">
          Manually issue commission records for agents based on their verified franchisee recruit counts.
        </p>
      </div>

      {message && (
        <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
          {message}
        </div>
      )}
      {error && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
          {error}
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
      >
        <h2 className="text-base font-semibold text-slate-900">Record Manual Agent Commission</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <select
            aria-label="Select Agent"
            required
            value={form.agent_id}
            onChange={(e) => setForm({ ...form, agent_id: e.target.value })}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
          >
            <option value="">Select Agent...</option>
            {agents.map((a) => (
              <option key={a.agent_id} value={a.agent_id}>
                {a.full_name || 'User'} ({a.approved_recruits} approved / {a.total_recruits} recruits)
              </option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            required
            placeholder="Commission Amount (PHP)"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
          />
          <input
            type="text"
            required
            placeholder="Enter commission period"
            value={form.period_label}
            onChange={(e) => setForm({ ...form, period_label: e.target.value })}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
          <select
            aria-label="Commission status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
          >
            <option value="Pending">Pending Payout</option>
            <option value="Paid">Paid</option>
          </select>
          <input
            type="text"
            placeholder="Notes / Reference..."
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
        >
          Create Commission Record
        </button>
      </form>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 pr-4">Agent</th>
                <th className="py-2.5 pr-4">Period</th>
                <th className="py-2.5 pr-4 text-right">Approved Recruits Snapshot</th>
                <th className="py-2.5 pr-4 text-right">Amount</th>
                <th className="py-2.5 pr-4">Status</th>
                <th className="py-2.5 pr-4">Notes</th>
                <th className="py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sm text-slate-500">
                    No commission records created yet.
                  </td>
                </tr>
              ) : (
                rows.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-4 font-medium text-slate-900">
                      {c.agent_name || 'User'}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-700">{c.period_label}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs">{c.recruits_count}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs font-semibold text-slate-900">
                      PHP {Number(c.amount).toFixed(2)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <StatusText status={c.status} />
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-slate-600">{c.notes || '—'}</td>
                    <td className="py-2.5 text-right">
                      {c.status === 'Pending' && (
                        <button
                          type="button"
                          onClick={async () => {
                            await api.patch(`/commissions/${c.id}/paid`);
                            load(pagination.page);
                          }}
                          className="px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                        >
                          Mark Paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationBar pagination={pagination} onPageChange={load} />
      </div>
    </div>
  );
};

// ===== 11. REPORTS (Sales, Orders, Inventory with PDF/Excel Export) & ACTIVITY LOGS =====
export const ReportsAndLogsView: React.FC = () => {
  const [sales, setSales] = useState<any[]>([]);
  const [salesSummary, setSalesSummary] = useState({ count: 0, totalSales: 0 });
  const [invReport, setInvReport] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [logPagination, setLogPagination] = useState({
    page: 1,
    limit: 12,
    total: 0,
    totalPages: 1,
  });
  const [logSearch, setLogSearch] = useState('');

  useEffect(() => {
    api.get('/admin/reports/sales').then((res) => {
      setSales(res.data);
      setSalesSummary(res.summary);
    });
    api.get('/admin/reports/inventory').then((res) => setInvReport(res.data));
  }, []);

  const loadLogs = (page = 1) => {
    api
      .get(`/admin/activity-logs?page=${page}&limit=12&search=${encodeURIComponent(logSearch)}`)
      .then((res) => {
        setLogs(res.data);
        setLogPagination(res.pagination);
      });
  };

  useEffect(() => {
    loadLogs(1);
  }, [logSearch]);

  const exportExcel = (rows: any[], sheetName: string, fileName: string) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, fileName);
  };

  const exportSalesPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text('AICE Franchisee Hub — Sales & Replenishment Orders Report', 14, 16);
    doc.setFontSize(10);
    doc.text(
      `Total Orders: ${salesSummary.count} | Total Sales: PHP ${Number(salesSummary.totalSales).toFixed(2)}`,
      14,
      23
    );
    autoTable(doc, {
      startY: 28,
      head: [
        [
          'Order #',
          'Date',
          'Store',
          'Warehouse',
          'Status',
          'Promo',
          'Subtotal (PHP)',
          'Discount (PHP)',
          'Total (PHP)',
        ],
      ],
      body: sales.map((s) => [
        s.order_number,
        s.order_date,
        s.store_name,
        s.warehouse_name,
        s.status,
        s.promo_name || '—',
        Number(s.subtotal ?? s.total_amount).toFixed(2),
        Number(s.discount_amount || 0).toFixed(2),
        Number(s.total_amount).toFixed(2),
      ]),
    });
    doc.save('aice-sales-report.pdf');
  };

  const exportInventoryPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text('AICE Franchisee Hub — Warehouse Inventory Report', 14, 16);
    autoTable(doc, {
      startY: 22,
      head: [['Warehouse', 'SKU', 'Product', 'Flavor', 'Size', 'Qty', 'Status']],
      body: invReport.map((i) => [
        i.warehouse_name,
        i.sku,
        i.product_name,
        i.flavor,
        i.size,
        i.quantity,
        i.stock_status,
      ]),
    });
    doc.save('aice-inventory-report.pdf');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Reports & Audit Log</h1>
        <p className="text-sm text-slate-600">
          Export sales, orders, and inventory reports to PDF or Excel (.xlsx), and review the system activity audit trail.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Sales & Orders Report</h2>
              <p className="text-xs text-slate-500 font-mono">
                {salesSummary.count} order(s) · Total PHP {Number(salesSummary.totalSales).toFixed(2)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={exportSalesPdf}
                className="px-3 py-1.5 rounded bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
              >
                Export PDF
              </button>
              <button
                type="button"
                onClick={() => exportExcel(sales, 'Sales', 'aice-sales-report.xlsx')}
                className="px-3 py-1.5 rounded border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Export Excel
              </button>
            </div>
          </div>

          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 font-semibold text-slate-500">
                  <th className="py-2 pr-3">Order #</th>
                  <th className="py-2 pr-3">Store</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Subtotal</th>
                  <th className="py-2 pr-3 text-right">Discount</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-slate-500">
                      No sales data yet.
                    </td>
                  </tr>
                ) : (
                  sales.map((s, idx) => (
                    <tr key={idx}>
                      <td className="py-2 pr-3 font-mono font-semibold">
                        <div>{s.order_number}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <div>{s.store_name}</div>
                        {s.promo_name && (
                          <div className="text-[10px] text-emerald-700 font-medium">
                            Promo: {s.promo_name}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusText status={s.status} />
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-slate-600">
                        PHP {Number(s.subtotal ?? s.total_amount).toFixed(2)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-emerald-700">
                        {Number(s.discount_amount || 0) > 0
                          ? `-PHP ${Number(s.discount_amount).toFixed(2)}`
                          : 'PHP 0.00'}
                      </td>
                      <td className="py-2 text-right font-mono font-semibold text-slate-900">
                        PHP {Number(s.total_amount).toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Warehouse Inventory Report</h2>
              <p className="text-xs text-slate-500 font-mono">{invReport.length} warehouse SKU record(s)</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={exportInventoryPdf}
                className="px-3 py-1.5 rounded bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
              >
                Export PDF
              </button>
              <button
                type="button"
                onClick={() => exportExcel(invReport, 'Inventory', 'aice-inventory-report.xlsx')}
                className="px-3 py-1.5 rounded border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Export Excel
              </button>
            </div>
          </div>

          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 font-semibold text-slate-500">
                  <th className="py-2 pr-3">Warehouse</th>
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invReport.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-slate-500">
                      No inventory rows yet.
                    </td>
                  </tr>
                ) : (
                  invReport.map((i, idx) => (
                    <tr key={idx}>
                      <td className="py-2 pr-3">{i.warehouse_name}</td>
                      <td className="py-2 pr-3 font-medium">{i.product_name}</td>
                      <td className="py-2 pr-3 text-right font-mono">{i.quantity}</td>
                      <td className="py-2 text-right">
                        <StatusText status={i.stock_status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-semibold text-slate-900">Activity & Audit Log</h2>
          <input
            type="search"
            aria-label="Search audit log"
            placeholder="Filter by action, user, or details..."
            value={logSearch}
            onChange={(e) => setLogSearch(e.target.value)}
            className="w-full sm:w-72 px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 font-semibold text-slate-500">
                <th className="py-2 pr-4">Timestamp</th>
                <th className="py-2 pr-4">Actor</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Entity</th>
                <th className="py-2">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="py-2 pr-4 font-mono text-slate-500">{l.created_at}</td>
                  <td className="py-2 pr-4 font-medium text-slate-800">
                    {l.full_name || 'System'}
                  </td>
                  <td className="py-2 pr-4 font-mono font-semibold text-slate-900">{l.action}</td>
                  <td className="py-2 pr-4 font-mono text-slate-600">
                    {l.entity_type} #{l.entity_id || '—'}
                  </td>
                  <td className="py-2 text-slate-700">{l.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationBar pagination={logPagination} onPageChange={loadLogs} />
      </div>
    </div>
  );
};

// ===== 12. DEMAND FORECASTING (Graphical Analytics Based on Franchisee Most-Ordered Products) =====
export const DemandForecastingView: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedWh, setSelectedWh] = useState<string>('');
  const [selectedCat, setSelectedCat] = useState<string>('');
  const [horizon, setHorizon] = useState<7 | 30>(30);
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({
    totalProducts: 0,
    totalOrderedUnits: 0,
    totalProjectedUnits: 0,
    totalRecommendedRestock: 0,
    topProduct: null,
  });
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    api.get('/warehouses').then((res) => setWarehouses(res.data || []));
    api.get('/categories').then((res) => setCategories(res.data || []));
  }, []);

  const loadForecast = () => {
    setLoading(true);
    api
      .get(
        `/admin/demand-forecast?horizon=${horizon}&warehouse_id=${selectedWh}&category_id=${selectedCat}`
      )
      .then((res) => {
        setRows(res.data || []);
        setSummary(
          res.summary || {
            totalProducts: 0,
            totalOrderedUnits: 0,
            totalProjectedUnits: 0,
            totalRecommendedRestock: 0,
            topProduct: null,
          }
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadForecast();
  }, [horizon, selectedWh, selectedCat]);

  const topChartRows = rows.slice(0, 8);
  const maxBarValue = Math.max(
    1,
    ...topChartRows.map((r) =>
      Math.max(
        Number(r.total_ordered_qty || 0),
        Number(horizon === 7 ? r.forecast_next_7d : r.forecast_next_30d),
        Number(r.current_stock || 0)
      )
    )
  );

  // Build SVG Cumulative Demand vs Stock Trajectory coordinates for top products
  const svgWidth = 640;
  const svgHeight = 220;
  const padLeft = 44;
  const padRight = 24;
  const padTop = 24;
  const padBottom = 38;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const chartPoints = topChartRows.map((r, idx) => {
    const x =
      topChartRows.length <= 1
        ? padLeft + plotW / 2
        : padLeft + (idx / (topChartRows.length - 1)) * plotW;
    const projected = Number(horizon === 7 ? r.forecast_next_7d : r.forecast_next_30d);
    const ordered = Number(r.total_ordered_qty || 0);
    const stock = Number(r.current_stock || 0);

    const yProjected = padTop + plotH - (Math.min(projected, maxBarValue) / maxBarValue) * plotH;
    const yOrdered = padTop + plotH - (Math.min(ordered, maxBarValue) / maxBarValue) * plotH;
    const yStock = padTop + plotH - (Math.min(stock, maxBarValue) / maxBarValue) * plotH;

    return {
      x,
      yProjected,
      yOrdered,
      yStock,
      sku: r.sku,
      name: r.name,
      projected,
      ordered,
      stock,
    };
  });

  const projectedPolyline = chartPoints.map((p) => `${p.x},${p.yProjected}`).join(' ');
  const orderedPolyline = chartPoints.map((p) => `${p.x},${p.yOrdered}`).join(' ');
  const stockPolyline = chartPoints.map((p) => `${p.x},${p.yStock}`).join(' ');

  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              Franchisee Product Demand Forecasting
            </h1>
            <p className="text-sm text-slate-600">
              Graphical demand projections, velocity trends, and warehouse restock recommendations ranked by franchisee most-ordered AICE products.
            </p>
          </div>
        </div>
      )}

      {/* Filter & Horizon Control Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label
              htmlFor="forecast-wh"
              className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1"
            >
              Warehouse Scope
            </label>
            <select
              id="forecast-wh"
              value={selectedWh}
              onChange={(e) => setSelectedWh(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium bg-white"
            >
              <option value="">All AICE Warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="forecast-cat"
              className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1"
            >
              Product Category
            </label>
            <select
              id="forecast-cat"
              value={selectedCat}
              onChange={(e) => setSelectedCat(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium bg-white"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Forecast Horizon
            </div>
            <div className="text-xs text-slate-600">Includes +15% safety buffer</div>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
            <button
              type="button"
              onClick={() => setHorizon(7)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                horizon === 7
                  ? 'bg-rose-600 text-white'
                  : 'text-slate-700 hover:bg-slate-200/70'
              }`}
            >
              Next 7 Days
            </button>
            <button
              type="button"
              onClick={() => setHorizon(30)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                horizon === 30
                  ? 'bg-rose-600 text-white'
                  : 'text-slate-700 hover:bg-slate-200/70'
              }`}
            >
              Next 30 Days
            </button>
          </div>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">
            #1 Most-Ordered Product
          </div>
          <div className="text-base font-bold text-slate-900 mt-1 truncate">
            {summary.topProduct ? summary.topProduct.name : 'No orders yet'}
          </div>
          <div className="text-xs font-mono tabular-nums text-rose-700 font-semibold mt-1">
            {summary.topProduct
              ? `${summary.topProduct.total_ordered_qty} boxes ordered (${summary.topProduct.demand_share_pct}% share)`
              : 'Place orders to rank SKUs'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">
            Historical Franchisee Demand
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {summary.totalOrderedUnits}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Total boxes ordered across active SKUs
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">
            Projected Demand (Next {horizon} Days)
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-rose-600 mt-1">
            {summary.totalProjectedUnits}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Velocity × trend + 15% cold-chain buffer
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">
            Recommended Warehouse Restock
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">
            {summary.totalRecommendedRestock}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Net boxes needed above current warehouse stock
          </div>
        </div>
      </div>

      {/* Graphical Visualization Row: Comparative Bar Chart + SVG Trajectory Graph */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 cols: Horizontal Multi-Bar Graph of Most-Ordered Products */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Most-Ordered Products vs. {horizon}-Day Forecast Graph
              </h2>
              <p className="text-xs text-slate-500">
                Comparing cumulative franchisee order volume against projected demand and available warehouse stock.
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5 font-medium text-slate-700">
                <span className="w-2.5 h-2.5 rounded-xs bg-slate-900 inline-block" />
                Historical Ordered
              </span>
              <span className="flex items-center gap-1.5 font-medium text-slate-700">
                <span className="w-2.5 h-2.5 rounded-xs bg-rose-600 inline-block" />
                {horizon}d Forecast
              </span>
              <span className="flex items-center gap-1.5 font-medium text-slate-700">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
                Current Stock
              </span>
            </div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Calculating franchisee product demand forecast...
            </div>
          ) : topChartRows.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              No products found in the catalog. Add products in the Product Catalog tab to generate demand forecasts.
            </div>
          ) : (
            <div className="space-y-4 pt-1">
              {topChartRows.map((item) => {
                const projected =
                  horizon === 7 ? item.forecast_next_7d : item.forecast_next_30d;
                const orderedPct = Math.max(
                  2,
                  Math.round((Number(item.total_ordered_qty) / maxBarValue) * 100)
                );
                const projectedPct = Math.max(
                  2,
                  Math.round((Number(projected) / maxBarValue) * 100)
                );
                const stockPct = Math.max(
                  2,
                  Math.round((Number(item.current_stock) / maxBarValue) * 100)
                );

                return (
                  <div
                    key={item.product_id}
                    className="p-3.5 rounded-lg border border-slate-200/90 bg-slate-50/50 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xs font-mono font-bold text-slate-500">
                          #{item.rank}
                        </span>
                        <ProductImage imageUrl={item.image_url} alt={item.name} thumb />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 truncate">
                            {item.name}
                          </div>
                          <div className="text-xs text-slate-500 font-mono">
                            {item.sku} · {item.category_name} · {item.flavor} ({item.size})
                          </div>
                        </div>
                      </div>

                      <div className="text-right font-mono text-xs">
                        <div className="font-bold text-slate-900 tabular-nums">
                          {item.demand_share_pct}% of network demand
                        </div>
                        <div className="text-slate-500 tabular-nums">
                          {item.order_count} order(s) · {item.franchisee_count} store(s)
                        </div>
                      </div>
                    </div>

                    {/* 3-Bar Graphical Comparison */}
                    <div className="space-y-1.5 text-xs">
                      <div className="grid grid-cols-12 items-center gap-2">
                        <span className="col-span-3 text-slate-600 font-medium">
                          Ordered Qty
                        </span>
                        <div className="col-span-7 h-3 bg-slate-200/80 rounded-xs overflow-hidden">
                          <div
                            className="h-full bg-slate-900 rounded-xs transition-all duration-300"
                            style={{ width: `${orderedPct}%` }}
                          />
                        </div>
                        <span className="col-span-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {item.total_ordered_qty}
                        </span>
                      </div>

                      <div className="grid grid-cols-12 items-center gap-2">
                        <span className="col-span-3 text-rose-700 font-semibold">
                          {horizon}d Forecast
                        </span>
                        <div className="col-span-7 h-3 bg-rose-100 rounded-xs overflow-hidden">
                          <div
                            className="h-full bg-rose-600 rounded-xs transition-all duration-300"
                            style={{ width: `${projectedPct}%` }}
                          />
                        </div>
                        <span className="col-span-2 text-right font-mono tabular-nums font-bold text-rose-700">
                          {projected}
                        </span>
                      </div>

                      <div className="grid grid-cols-12 items-center gap-2">
                        <span className="col-span-3 text-emerald-800 font-medium">
                          Whse Stock
                        </span>
                        <div className="col-span-7 h-3 bg-emerald-100 rounded-xs overflow-hidden">
                          <div
                            className="h-full bg-emerald-600 rounded-xs transition-all duration-300"
                            style={{ width: `${stockPct}%` }}
                          />
                        </div>
                        <span className="col-span-2 text-right font-mono tabular-nums font-semibold text-emerald-800">
                          {item.current_stock}
                        </span>
                      </div>
                    </div>

                    {item.top_stores && item.top_stores.length > 0 && (
                      <div className="pt-1.5 border-t border-slate-200/70 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                        <span>
                          Top Ordering Franchisees:{' '}
                          <strong className="text-slate-800">
                            {item.top_stores
                              .map((s: any) => `${s.store_name} (${s.store_qty} boxes)`)
                              .join(' · ')}
                          </strong>
                        </span>
                        <span className="font-mono tabular-nums">
                          Velocity: <strong>{item.daily_velocity}/day</strong> · Trend:{' '}
                          <strong
                            className={
                              item.growth_rate_pct > 0
                                ? 'text-emerald-700'
                                : item.growth_rate_pct < 0
                                ? 'text-amber-700'
                                : 'text-slate-700'
                            }
                          >
                            {item.growth_rate_pct > 0
                              ? `+${item.growth_rate_pct}%`
                              : `${item.growth_rate_pct}%`}
                          </strong>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 5 cols: SVG Trajectory Curve + Demand Share Breakdown */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Demand vs. Stock Coverage Curve (SVG)
              </h2>
              <p className="text-xs text-slate-500">
                Visualizes where projected franchisee demand (rose line) exceeds current warehouse stock (emerald line).
              </p>
            </div>

            {chartPoints.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                No product points available to plot.
              </div>
            ) : (
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/60">
                <svg
                  viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                  className="w-full h-52 overflow-visible"
                  role="img"
                  aria-label="Demand forecast vs warehouse stock trajectory chart"
                >
                  {/* Horizontal grid lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                    const y = padTop + plotH * (1 - ratio);
                    const val = Math.round(maxBarValue * ratio);
                    return (
                      <g key={idx}>
                        <line
                          x1={padLeft}
                          y1={y}
                          x2={svgWidth - padRight}
                          y2={y}
                          stroke="#e2e8f0"
                          strokeDasharray={ratio === 0 ? undefined : '4 4'}
                          strokeWidth="1"
                        />
                        <text
                          x={padLeft - 8}
                          y={y + 4}
                          textAnchor="end"
                          className="text-[10px] fill-slate-500 font-mono"
                        >
                          {val}
                        </text>
                      </g>
                    );
                  })}

                  {/* Lines */}
                  {chartPoints.length > 1 && (
                    <>
                      <polyline
                        fill="none"
                        stroke="#059669"
                        strokeWidth="2.25"
                        points={stockPolyline}
                      />
                      <polyline
                        fill="none"
                        stroke="#0f172a"
                        strokeWidth="2.25"
                        strokeDasharray="4 3"
                        points={orderedPolyline}
                      />
                      <polyline
                        fill="none"
                        stroke="#e11d48"
                        strokeWidth="2.75"
                        points={projectedPolyline}
                      />
                    </>
                  )}

                  {/* Data nodes & X-axis SKU labels */}
                  {chartPoints.map((pt, idx) => (
                    <g key={idx}>
                      <circle
                        cx={pt.x}
                        cy={pt.yStock}
                        r="4"
                        fill="#059669"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      >
                        <title>{`${pt.name} — Current Stock: ${pt.stock}`}</title>
                      </circle>
                      <circle
                        cx={pt.x}
                        cy={pt.yOrdered}
                        r="4"
                        fill="#0f172a"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      >
                        <title>{`${pt.name} — Historical Ordered: ${pt.ordered}`}</title>
                      </circle>
                      <circle
                        cx={pt.x}
                        cy={pt.yProjected}
                        r="4.5"
                        fill="#e11d48"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      >
                        <title>{`${pt.name} — Projected ${horizon}d Demand: ${pt.projected}`}</title>
                      </circle>
                      <text
                        x={pt.x}
                        y={svgHeight - 10}
                        textAnchor="middle"
                        className="text-[10px] fill-slate-600 font-mono"
                      >
                        #{idx + 1}
                      </text>
                    </g>
                  ))}
                </svg>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 text-[11px] text-slate-600">
                  <span>X-Axis: Top Ranked SKUs (#1 to #{chartPoints.length})</span>
                  <span>Y-Axis: Quantity (Boxes)</span>
                </div>
              </div>
            )}
          </div>

          {/* Stacked Demand Share Distribution Bar */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Franchisee Demand Share Distribution
              </h2>
              <p className="text-xs text-slate-500">
                Proportional breakdown of most-ordered AICE products across all franchisee replenishment orders.
              </p>
            </div>

            <div className="h-4 w-full rounded-md bg-slate-100 overflow-hidden flex border border-slate-200">
              {topChartRows.map((r, idx) => {
                const colors = [
                  'bg-rose-600',
                  'bg-slate-900',
                  'bg-amber-500',
                  'bg-emerald-600',
                  'bg-sky-600',
                  'bg-indigo-600',
                  'bg-rose-400',
                  'bg-slate-500',
                ];
                const width = Math.max(2, Number(r.demand_share_pct || 0));
                return (
                  <div
                    key={r.product_id}
                    className={`${colors[idx % colors.length]} h-full transition-all`}
                    style={{ width: `${width}%` }}
                    title={`${r.name}: ${r.demand_share_pct}%`}
                  />
                );
              })}
            </div>

            <div className="divide-y divide-slate-100 text-xs">
              {topChartRows.slice(0, 5).map((r) => (
                <div key={r.product_id} className="py-1.5 flex items-center justify-between">
                  <span className="font-medium text-slate-800 truncate pr-2">
                    #{r.rank} {r.name}
                  </span>
                  <span className="font-mono tabular-nums text-slate-700 shrink-0">
                    {r.total_ordered_qty} boxes ({r.demand_share_pct}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Detailed SKU Replenishment Forecast & Restock Action Table */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              SKU-Level Demand Forecast & Warehouse Restock Schedule
            </h2>
            <p className="text-xs text-slate-500">
              Ranked by franchisee order volume. Restock gap highlights SKUs where projected {horizon}-day demand + threshold exceeds current warehouse inventory.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 font-semibold text-slate-500">
                <th className="py-2.5 pr-3">Rank</th>
                <th className="py-2.5 pr-3">Product & SKU</th>
                <th className="py-2.5 pr-3 text-right">Total Ordered</th>
                <th className="py-2.5 pr-3 text-right">Daily Velocity</th>
                <th className="py-2.5 pr-3 text-right">7d Forecast</th>
                <th className="py-2.5 pr-3 text-right">30d Forecast</th>
                <th className="py-2.5 pr-3 text-right">Current Stock</th>
                <th className="py-2.5 pr-3 text-right">Days of Supply</th>
                <th className="py-2.5 pr-3 text-right">Recommended Restock</th>
                <th className="py-2.5 text-right">Supply Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-slate-500">
                    No product demand records available.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.product_id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-3 font-mono font-bold text-slate-700">
                      #{r.rank}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="font-semibold text-slate-900">{r.name}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {r.sku} · {r.category_name} · {r.flavor}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {r.total_ordered_qty}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-700">
                      {r.daily_velocity}/day
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-800">
                      {r.forecast_next_7d}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums font-bold text-rose-700">
                      {r.forecast_next_30d}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-emerald-800 font-semibold">
                      {r.current_stock}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-700">
                      {r.days_of_supply >= 999 ? '90+ days' : `${r.days_of_supply} days`}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums font-bold text-amber-800">
                      {r.recommended_restock > 0 ? `+${r.recommended_restock} boxes` : '0 (Covered)'}
                    </td>
                    <td className="py-2.5 text-right font-mono font-semibold">
                      {r.risk_level === 'CRITICAL' ? (
                        <span className="text-rose-700">● CRITICAL</span>
                      ) : r.risk_level === 'RESTOCK_SOON' ? (
                        <span className="text-amber-700">● RESTOCK SOON</span>
                      ) : (
                        <span className="text-emerald-700">● HEALTHY</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ===== 13. SALES ANALYTICS (Admin Only — Real SQLite Data, Revenue = Confirmed/Delivered) =====
function formatPhp(amount: number): string {
  return `PHP ${Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function ComparisonIndicator({
  pct,
  invertColor = false,
}: {
  pct: number;
  invertColor?: boolean;
}) {
  const num = Number(pct || 0);
  if (num === 0) {
    return (
      <span className="text-xs font-mono tabular-nums text-slate-500">
        0.0% vs prev period
      </span>
    );
  }
  const isPositive = num > 0;
  const isGood = invertColor ? !isPositive : isPositive;
  return (
    <span
      className={`text-xs font-mono tabular-nums font-semibold ${
        isGood ? 'text-emerald-700' : 'text-rose-700'
      }`}
    >
      {isPositive ? `▲ +${num}%` : `▼ ${num}%`} vs prev period
    </span>
  );
}

export const SalesAnalyticsView: React.FC<{
  onNavigate?: (path: string) => void;
}> = ({ onNavigate }) => {
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [range, setRange] = useState<'7d' | '30d' | 'month' | 'custom'>('30d');
  const [customFrom, setCustomFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [selectedWh, setSelectedWh] = useState<string>('');
  const [selectedCat, setSelectedCat] = useState<string>('');
  const [topProductSort, setTopProductSort] = useState<'revenue' | 'boxes'>('revenue');

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    api.get('/warehouses').then((res) => setWarehouses(res.data || []));
    api.get('/categories').then((res) => setCategories(res.data || []));
  }, []);

  const loadAnalytics = () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    params.set('range', range);
    if (range === 'custom') {
      params.set('from', customFrom);
      params.set('to', customTo);
    }
    if (selectedWh) params.set('warehouse_id', selectedWh);
    if (selectedCat) params.set('category_id', selectedCat);

    api
      .get(`/analytics/sales?${params.toString()}`)
      .then((res) => setData(res))
      .catch((err: any) => setError(err.message || 'Failed to load sales analytics.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (range === 'custom' && (!customFrom || !customTo)) return;
    loadAnalytics();
  }, [range, customFrom, customTo, selectedWh, selectedCat]);

  const kpis = data?.kpis || {
    total_revenue: 0,
    counted_orders: 0,
    total_orders: 0,
    avg_order_value: 0,
    delivered_orders: 0,
    cancelled_orders: 0,
    comparison: {
      revenue_pct: 0,
      total_orders_pct: 0,
      avg_order_value_pct: 0,
      delivered_orders_pct: 0,
      cancelled_orders_pct: 0,
    },
  };

  const revenueOverTime: any[] = data?.revenueOverTime || [];
  const hasRevenueSeries =
    revenueOverTime.length > 0 &&
    revenueOverTime.some((r) => Number(r.revenue || 0) > 0);
  const maxTimeRevenue = Math.max(
    1,
    ...revenueOverTime.map((r) => Number(r.revenue || 0))
  );

  const topProducts: any[] =
    topProductSort === 'revenue'
      ? data?.topProductsByRevenue || []
      : data?.topProductsByBoxes || [];
  const maxProdRevenue = Math.max(
    1,
    ...topProducts.map((p) => Number(p.revenue || 0))
  );
  const maxProdBoxes = Math.max(
    1,
    ...topProducts.map((p) => Number(p.boxes_sold || 0))
  );

  const salesByCategory: any[] = data?.salesByCategory || [];
  const topFranchisees: any[] = data?.topFranchisees || [];
  const agentPerformance: any[] = data?.agentPerformance || [];
  const ordersByStatus: any[] = data?.ordersByStatus || [];

  const categoryStrokeColors = [
    '#e11d48', // rose-600
    '#0f172a', // slate-900
    '#059669', // emerald-600
    '#d97706', // amber-600
    '#0284c7', // sky-600
    '#4f46e5', // indigo-600
  ];

  // SVG Donut geometry for Sales by Category
  const donutRadius = 54;
  const donutCircumference = 2 * Math.PI * donutRadius;
  let cumulativeCatShare = 0;

  // SVG Donut geometry for Orders by Status
  let cumulativeStatusShare = 0;
  const statusStrokeColors: Record<string, string> = {
    Delivered: '#059669',
    Confirmed: '#0284c7',
    Preparing: '#4f46e5',
    'Assigned to Delivery': '#7c3aed',
    'Out for Delivery': '#d97706',
    'Near / Arrived': '#0d9488',
    Placed: '#64748b',
    Cancelled: '#e11d48',
    Rejected: '#9f1239',
  };

  return (
    <div className="space-y-6">
      {/* Page Title & "Go to Reports" Link */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Sales Analytics</h1>
          <p className="text-sm text-slate-600">
            Real-time franchise revenue, product velocity, category distribution, and agent performance. Revenue counts Confirmed and Delivered orders only.
          </p>
        </div>

        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate('/admin/reports')}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-rose-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Go to Reports →
          </button>
        )}
      </div>

      {/* 1. Filters Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Date Range
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
              {(
                [
                  { id: '7d', label: 'Last 7 days' },
                  { id: '30d', label: 'Last 30 days' },
                  { id: 'month', label: 'This month' },
                  { id: 'custom', label: 'Custom' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setRange(opt.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                    range === opt.id
                      ? 'bg-rose-600 text-white'
                      : 'text-slate-700 hover:bg-slate-200/70'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {range === 'custom' && (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label
                  htmlFor="sa-from"
                  className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1"
                >
                  From
                </label>
                <input
                  id="sa-from"
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono bg-white"
                />
              </div>
              <div>
                <label
                  htmlFor="sa-to"
                  className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1"
                >
                  To
                </label>
                <input
                  id="sa-to"
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono bg-white"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="sa-warehouse"
              className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1"
            >
              Warehouse
            </label>
            <select
              id="sa-warehouse"
              value={selectedWh}
              onChange={(e) => setSelectedWh(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium bg-white"
            >
              <option value="">All Warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="sa-category"
              className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1"
            >
              Product Category
            </label>
            <select
              id="sa-category"
              value={selectedCat}
              onChange={(e) => setSelectedCat(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium bg-white"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-sm text-slate-500">
          Loading sales analytics from database...
        </div>
      ) : (
        <>
          {/* 2. KPI Cards (5 cards with previous-period comparison) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                Total Revenue (PHP)
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900">
                {formatPhp(kpis.total_revenue)}
              </div>
              <div>
                <ComparisonIndicator pct={kpis.comparison.revenue_pct} />
              </div>
              <div className="text-[11px] text-slate-500">
                From {kpis.counted_orders} confirmed/delivered order(s)
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                Total Orders
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900">
                {Number(kpis.total_orders || 0).toLocaleString('en-US')}
              </div>
              <div>
                <ComparisonIndicator pct={kpis.comparison.total_orders_pct} />
              </div>
              <div className="text-[11px] text-slate-500">
                {kpis.counted_orders} counted in revenue
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                Average Order Value
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900">
                {formatPhp(kpis.avg_order_value)}
              </div>
              <div>
                <ComparisonIndicator pct={kpis.comparison.avg_order_value_pct} />
              </div>
              <div className="text-[11px] text-slate-500">
                Revenue ÷ confirmed/delivered orders
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                Delivered Orders
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-emerald-700">
                {Number(kpis.delivered_orders || 0).toLocaleString('en-US')}
              </div>
              <div>
                <ComparisonIndicator pct={kpis.comparison.delivered_orders_pct} />
              </div>
              <div className="text-[11px] text-slate-500">
                Completed cold-chain deliveries
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1">
              <div className="text-xs font-medium text-slate-500">
                Cancelled Orders
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-rose-700">
                {Number(kpis.cancelled_orders || 0).toLocaleString('en-US')}
              </div>
              <div>
                <ComparisonIndicator
                  pct={kpis.comparison.cancelled_orders_pct}
                  invertColor
                />
              </div>
              <div className="text-[11px] text-slate-500">
                Excluded from revenue
              </div>
            </div>
          </div>

          {/* 3. Revenue Over Time + 5. Sales by Category */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Revenue Over Time Chart (7 cols) */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Revenue Over Time
                  </h2>
                  <p className="text-xs text-slate-500">
                    Grouped by {data?.period?.groupBy || 'day'} ({data?.period?.startDate} to{' '}
                    {data?.period?.endDate})
                  </p>
                </div>
                <span className="text-xs font-mono text-slate-600">
                  Confirmed & Delivered Revenue
                </span>
              </div>

              {!hasRevenueSeries ? (
                <div className="py-12 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
                  No sales in this period
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Vertical Bar + Line SVG Chart */}
                  <div className="h-52 flex items-end gap-2 pt-6 pb-2 px-3 border border-slate-200 rounded-lg bg-slate-50/60 overflow-x-auto">
                    {revenueOverTime.map((pt) => {
                      const rev = Number(pt.revenue || 0);
                      const heightPct = Math.max(
                        4,
                        Math.round((rev / maxTimeRevenue) * 100)
                      );
                      return (
                        <div
                          key={pt.period_label}
                          className="flex-1 min-w-[44px] h-full flex flex-col justify-end items-center gap-1.5"
                        >
                          <div className="text-[10px] font-mono tabular-nums font-semibold text-slate-700 whitespace-nowrap">
                            {rev > 0
                              ? `₱${Number(rev).toLocaleString('en-US', {
                                  maximumFractionDigits: 0,
                                })}`
                              : '₱0'}
                          </div>
                          <div className="w-full max-w-[36px] flex-1 flex items-end bg-slate-200/60 rounded-t-xs overflow-hidden">
                            <div
                              className="w-full bg-rose-600 rounded-t-xs transition-all duration-300"
                              style={{ height: `${heightPct}%` }}
                              title={`${pt.period_label}: ${formatPhp(rev)} (${pt.counted_orders} confirmed/delivered orders)`}
                            />
                          </div>
                          <div className="text-[10px] font-mono text-slate-600 whitespace-nowrap">
                            {pt.period_label}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 5. Sales by Category (Donut + Breakdown) (5 cols) */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Sales by Category
                </h2>
                <p className="text-xs text-slate-500">
                  Revenue share across AICE ice cream categories.
                </p>
              </div>

              {salesByCategory.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
                  No sales in this period
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                  <div className="sm:col-span-5 flex justify-center">
                    <svg
                      viewBox="0 0 140 140"
                      className="w-36 h-36"
                      role="img"
                      aria-label="Sales by category donut chart"
                    >
                      <circle
                        cx="70"
                        cy="70"
                        r={donutRadius}
                        fill="transparent"
                        stroke="#f1f5f9"
                        strokeWidth="18"
                      />
                      {salesByCategory.map((cat, idx) => {
                        const pct = Math.max(0, Number(cat.share_pct || 0));
                        const dash = (pct / 100) * donutCircumference;
                        const offset =
                          donutCircumference -
                          (cumulativeCatShare / 100) * donutCircumference;
                        cumulativeCatShare += pct;
                        return (
                          <circle
                            key={cat.category_id}
                            cx="70"
                            cy="70"
                            r={donutRadius}
                            fill="transparent"
                            stroke={
                              categoryStrokeColors[
                                idx % categoryStrokeColors.length
                              ]
                            }
                            strokeWidth="18"
                            strokeDasharray={`${dash} ${donutCircumference - dash}`}
                            strokeDashoffset={offset}
                            transform="rotate(-90 70 70)"
                          >
                            <title>{`${cat.category_name}: ${formatPhp(cat.revenue)} (${cat.share_pct}%)`}</title>
                          </circle>
                        );
                      })}
                      <text
                        x="70"
                        y="67"
                        textAnchor="middle"
                        className="text-[10px] fill-slate-500 font-medium"
                      >
                        Categories
                      </text>
                      <text
                        x="70"
                        y="82"
                        textAnchor="middle"
                        className="text-xs fill-slate-900 font-bold font-mono"
                      >
                        {salesByCategory.length}
                      </text>
                    </svg>
                  </div>

                  <div className="sm:col-span-7 space-y-2.5">
                    {salesByCategory.map((cat, idx) => (
                      <div key={cat.category_id} className="space-y-1 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 font-semibold text-slate-800 truncate">
                            <span
                              className="w-2.5 h-2.5 rounded-xs shrink-0"
                              style={{
                                backgroundColor:
                                  categoryStrokeColors[
                                    idx % categoryStrokeColors.length
                                  ],
                              }}
                            />
                            {cat.category_name}
                          </span>
                          <span className="font-mono tabular-nums font-semibold text-slate-900 shrink-0">
                            {formatPhp(cat.revenue)} ({cat.share_pct}%)
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                          <span>{cat.boxes_sold} boxes sold</span>
                          <span>{cat.order_count} order(s)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 4. Top 5 Products (Horizontal Bar Chart) + 8. Orders by Status */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Top 5 Products by Revenue and by Boxes Sold (7 cols) */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Top 5 Products by Revenue & Boxes Sold
                  </h2>
                  <p className="text-xs text-slate-500">
                    Horizontal comparison of best-selling AICE SKUs in Confirmed and Delivered orders.
                  </p>
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setTopProductSort('revenue')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                      topProductSort === 'revenue'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-200/70'
                    }`}
                  >
                    Rank by Revenue
                  </button>
                  <button
                    type="button"
                    onClick={() => setTopProductSort('boxes')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                      topProductSort === 'boxes'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-200/70'
                    }`}
                  >
                    Rank by Boxes Sold
                  </button>
                </div>
              </div>

              {topProducts.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
                  No sales in this period
                </div>
              ) : (
                <div className="space-y-3.5">
                  {topProducts.map((p, idx) => {
                    const revPct = Math.max(
                      3,
                      Math.round((Number(p.revenue || 0) / maxProdRevenue) * 100)
                    );
                    const boxPct = Math.max(
                      3,
                      Math.round((Number(p.boxes_sold || 0) / maxProdBoxes) * 100)
                    );
                    return (
                      <div
                        key={p.product_id}
                        className="p-3.5 rounded-lg border border-slate-200/90 bg-slate-50/50 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-xs font-mono font-bold text-slate-500">
                              #{idx + 1}
                            </span>
                            <ProductImage imageUrl={p.image_url} alt={p.name} thumb />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900 truncate">
                                {p.name}
                              </div>
                              <div className="text-xs font-mono text-slate-500">
                                {p.sku} · {p.category_name} · {p.flavor}
                              </div>
                            </div>
                          </div>
                          <div className="text-right font-mono text-xs shrink-0">
                            <div className="font-bold text-slate-900 tabular-nums">
                              {formatPhp(p.revenue)}
                            </div>
                            <div className="text-slate-600 tabular-nums">
                              {Number(p.boxes_sold).toLocaleString('en-US')} boxes sold
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1.5 text-xs">
                          <div className="grid grid-cols-12 items-center gap-2">
                            <span className="col-span-3 text-rose-700 font-semibold">
                              Revenue
                            </span>
                            <div className="col-span-7 h-2.5 bg-rose-100 rounded-xs overflow-hidden">
                              <div
                                className="h-full bg-rose-600 rounded-xs"
                                style={{ width: `${revPct}%` }}
                              />
                            </div>
                            <span className="col-span-2 text-right font-mono tabular-nums font-semibold text-rose-700">
                              {formatPhp(p.revenue)}
                            </span>
                          </div>

                          <div className="grid grid-cols-12 items-center gap-2">
                            <span className="col-span-3 text-slate-700 font-medium">
                              Boxes Sold
                            </span>
                            <div className="col-span-7 h-2.5 bg-slate-200 rounded-xs overflow-hidden">
                              <div
                                className="h-full bg-slate-900 rounded-xs"
                                style={{ width: `${boxPct}%` }}
                              />
                            </div>
                            <span className="col-span-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                              {Number(p.boxes_sold).toLocaleString('en-US')}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 8. Orders by Status (Donut + Horizontal Bars) (5 cols) */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Orders by Status
                </h2>
                <p className="text-xs text-slate-500">
                  Status breakdown of all replenishment orders in this period.
                </p>
              </div>

              {ordersByStatus.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
                  No sales in this period
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-center">
                    <svg
                      viewBox="0 0 140 140"
                      className="w-32 h-32"
                      role="img"
                      aria-label="Orders by status donut chart"
                    >
                      <circle
                        cx="70"
                        cy="70"
                        r={donutRadius}
                        fill="transparent"
                        stroke="#f1f5f9"
                        strokeWidth="16"
                      />
                      {ordersByStatus.map((st) => {
                        const pct = Math.max(0, Number(st.share_pct || 0));
                        const dash = (pct / 100) * donutCircumference;
                        const offset =
                          donutCircumference -
                          (cumulativeStatusShare / 100) * donutCircumference;
                        cumulativeStatusShare += pct;
                        const color = statusStrokeColors[st.status] || '#475569';
                        return (
                          <circle
                            key={st.status}
                            cx="70"
                            cy="70"
                            r={donutRadius}
                            fill="transparent"
                            stroke={color}
                            strokeWidth="16"
                            strokeDasharray={`${dash} ${donutCircumference - dash}`}
                            strokeDashoffset={offset}
                            transform="rotate(-90 70 70)"
                          >
                            <title>{`${st.status}: ${st.order_count} order(s) (${st.share_pct}%)`}</title>
                          </circle>
                        );
                      })}
                      <text
                        x="70"
                        y="67"
                        textAnchor="middle"
                        className="text-[10px] fill-slate-500 font-medium"
                      >
                        Total Orders
                      </text>
                      <text
                        x="70"
                        y="82"
                        textAnchor="middle"
                        className="text-xs fill-slate-900 font-bold font-mono"
                      >
                        {kpis.total_orders}
                      </text>
                    </svg>
                  </div>

                  <div className="space-y-2.5">
                    {ordersByStatus.map((st) => {
                      const color = statusStrokeColors[st.status] || '#475569';
                      return (
                        <div key={st.status} className="space-y-1 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                              <span
                                className="w-2.5 h-2.5 rounded-xs inline-block"
                                style={{ backgroundColor: color }}
                              />
                              {st.status}
                            </span>
                            <span className="font-mono tabular-nums text-slate-800">
                              <strong>{st.order_count}</strong> ({st.share_pct}%) ·{' '}
                              {formatPhp(st.status_amount)}
                            </span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-xs overflow-hidden">
                            <div
                              className="h-full rounded-xs"
                              style={{
                                width: `${Math.max(3, Number(st.share_pct || 0))}%`,
                                backgroundColor: color,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 6. Top Franchisees Table + 7. Agent Performance Table */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Top Franchisees by Order Value and Number of Orders (6 cols) */}
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Top Franchisees by Order Value & Orders
                </h2>
                <p className="text-xs text-slate-500">
                  Ranked by Confirmed and Delivered replenishment order value in the selected period.
                </p>
              </div>

              {topFranchisees.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
                  No sales in this period
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="border-b border-slate-200 font-semibold text-slate-500">
                        <th className="py-2 pr-3">Rank</th>
                        <th className="py-2 pr-3">Franchisee Store</th>
                        <th className="py-2 pr-3 text-right">Orders (Counted / Total)</th>
                        <th className="py-2 text-right">Order Value (PHP)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {topFranchisees.map((f) => (
                        <tr key={f.franchisee_id} className="hover:bg-slate-50">
                          <td className="py-2.5 pr-3 font-mono font-bold text-slate-700">
                            #{f.rank}
                          </td>
                          <td className="py-2.5 pr-3">
                            <div className="font-semibold text-slate-900">
                              {f.store_name}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {f.owner_name || 'User'}
                            </div>
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-700">
                            {f.counted_orders} / {f.total_orders}
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums font-bold text-slate-900">
                            {formatPhp(f.order_value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 7. Agent Performance Table (6 cols) */}
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Agent Performance
                </h2>
                <p className="text-xs text-slate-500">
                  Each agent’s total recruits, approved franchisees, and confirmed/delivered order value from their franchisees.
                </p>
              </div>

              {agentPerformance.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
                  No agent records found
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="border-b border-slate-200 font-semibold text-slate-500">
                        <th className="py-2 pr-3">Agent</th>
                        <th className="py-2 pr-3 text-right">Recruited</th>
                        <th className="py-2 pr-3 text-right">Approved</th>
                        <th className="py-2 text-right">Franchisee Order Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {agentPerformance.map((ag) => (
                        <tr key={ag.agent_id} className="hover:bg-slate-50">
                          <td className="py-2.5 pr-3">
                            <div className="font-semibold text-slate-900">
                              {ag.agent_name || 'User'}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">
                              {ag.agent_username}
                            </div>
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-700">
                            {ag.recruits_count}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                            {ag.approved_franchisees}
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums font-bold text-slate-900">
                            {formatPhp(ag.total_order_value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ===== 14. PROMOTIONS MANAGEMENT (Admin Promo Engine, Live Rule Preview & Redemptions Audit) =====
const PROMO_TYPE_LABELS: Record<string, string> = {
  volume_tiered: '1. Volume / Tiered Discount',
  min_purchase: '2. Minimum Purchase Discount',
  buy_x_get_y: '3. Buy X Get Y Free',
  free_delivery: '4. Free Delivery Above Minimum Order',
  seasonal: '5. Monthly / Seasonal Promo',
  product_category: '6. Product or Category Specific Promo',
  franchisee_targeted: '7. Franchisee-Targeted Promo',
};

export const PromotionsManagementView: React.FC = () => {
  const [promos, setPromos] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [franchisees, setFranchisees] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedPromoDetail, setSelectedPromoDetail] = useState<{
    promo: any;
    redemptions: any[];
  } | null>(null);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');

  const todayStr = new Date().toISOString().slice(0, 10);
  const nextMonthStr = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);

  const [form, setForm] = useState({
    name: '',
    description: '',
    promo_type: 'volume_tiered',
    discount_type: 'percent' as 'percent' | 'fixed',
    discount_value: '5',
    min_order_amount: '0',
    min_quantity: '0',
    buy_quantity: '10',
    free_quantity: '1',
    free_delivery: false,
    max_discount_cap: '',
    scope: 'all_products' as 'all_products' | 'category' | 'product',
    tier_basis: 'quantity' as 'quantity' | 'amount',
    recurring_monthly: false,
    start_date: todayStr,
    end_date: nextMonthStr,
    usage_limit_total: '',
    usage_limit_per_franchisee: '',
    stackable: false,
    status: 'Active' as 'Draft' | 'Active' | 'Paused' | 'Expired',
    product_ids: [] as number[],
    category_ids: [] as number[],
    target_franchisee_ids: [] as number[],
    tiers: [
      { min_quantity_or_amount: '10', discount_value: '5' },
      { min_quantity_or_amount: '20', discount_value: '10' },
    ],
  });

  const loadPromos = (st = statusFilter) => {
    setLoading(true);
    api
      .get(`/promos?status=${encodeURIComponent(st)}`)
      .then((res) => setPromos(res.data || []))
      .catch((err) => setError(err.message || 'Failed to load promotions.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    api.get('/products?limit=200').then((res) => setProducts(res.data || []));
    api.get('/categories').then((res) => setCategories(res.data || []));
    api
      .get('/admin/franchisees?status=Approved&limit=200')
      .then((res) => setFranchisees(res.data || []));
  }, []);

  useEffect(() => {
    loadPromos(statusFilter);
  }, [statusFilter]);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      name: '',
      description: '',
      promo_type: 'volume_tiered',
      discount_type: 'percent',
      discount_value: '5',
      min_order_amount: '0',
      min_quantity: '0',
      buy_quantity: '10',
      free_quantity: '1',
      free_delivery: false,
      max_discount_cap: '',
      scope: 'all_products',
      tier_basis: 'quantity',
      recurring_monthly: false,
      start_date: todayStr,
      end_date: nextMonthStr,
      usage_limit_total: '',
      usage_limit_per_franchisee: '',
      stackable: false,
      status: 'Active',
      product_ids: [],
      category_ids: [],
      target_franchisee_ids: [],
      tiers: [
        { min_quantity_or_amount: '10', discount_value: '5' },
        { min_quantity_or_amount: '20', discount_value: '10' },
      ],
    });
  };

  const handlePromoTypeChange = (nextType: string) => {
    let nextScope = form.scope;
    let nextFreeDelivery = form.free_delivery;
    if (nextType === 'product_category' && nextScope === 'all_products') {
      nextScope = 'product';
    }
    if (nextType === 'buy_x_get_y' && nextScope === 'all_products') {
      nextScope = 'product';
    }
    if (nextType === 'free_delivery') {
      nextFreeDelivery = true;
    }
    setForm({
      ...form,
      promo_type: nextType,
      scope: nextScope,
      free_delivery: nextFreeDelivery,
    });
  };

  const startEditPromo = (p: any) => {
    setEditingId(p.id);
    setForm({
      name: p.name || '',
      description: p.description || '',
      promo_type: p.promo_type || 'min_purchase',
      discount_type: p.discount_type || 'percent',
      discount_value: String(p.discount_value ?? 0),
      min_order_amount: String(p.min_order_amount ?? 0),
      min_quantity: String(p.min_quantity ?? 0),
      buy_quantity: String(p.buy_quantity ?? 0),
      free_quantity: String(p.free_quantity ?? 0),
      free_delivery: Boolean(p.free_delivery),
      max_discount_cap: p.max_discount_cap !== null && p.max_discount_cap !== undefined ? String(p.max_discount_cap) : '',
      scope: p.scope || 'all_products',
      tier_basis: p.tier_basis || 'quantity',
      recurring_monthly: Boolean(p.recurring_monthly),
      start_date: p.start_date || todayStr,
      end_date: p.end_date || nextMonthStr,
      usage_limit_total:
        p.usage_limit_total !== null && p.usage_limit_total !== undefined
          ? String(p.usage_limit_total)
          : '',
      usage_limit_per_franchisee:
        p.usage_limit_per_franchisee !== null && p.usage_limit_per_franchisee !== undefined
          ? String(p.usage_limit_per_franchisee)
          : '',
      stackable: Boolean(p.stackable),
      status: p.status || 'Draft',
      product_ids: Array.isArray(p.product_ids) ? p.product_ids : [],
      category_ids: Array.isArray(p.category_ids) ? p.category_ids : [],
      target_franchisee_ids: Array.isArray(p.target_franchisee_ids) ? p.target_franchisee_ids : [],
      tiers:
        Array.isArray(p.tiers) && p.tiers.length > 0
          ? p.tiers.map((t: any) => ({
              min_quantity_or_amount: String(t.min_quantity_or_amount),
              discount_value: String(t.discount_value),
            }))
          : [{ min_quantity_or_amount: '10', discount_value: '5' }],
    });
  };

  const buildPayloadFromForm = () => ({
    name: form.name.trim(),
    description: form.description.trim(),
    promo_type: form.promo_type as any,
    discount_type: form.discount_type,
    discount_value: Number(form.discount_value || 0),
    min_order_amount: Number(form.min_order_amount || 0),
    min_quantity: Number(form.min_quantity || 0),
    buy_quantity: Number(form.buy_quantity || 0),
    free_quantity: Number(form.free_quantity || 0),
    free_delivery: form.free_delivery || form.promo_type === 'free_delivery',
    max_discount_cap: form.max_discount_cap !== '' ? Number(form.max_discount_cap) : null,
    scope: form.scope,
    tier_basis: form.tier_basis,
    recurring_monthly: form.recurring_monthly,
    start_date: form.start_date,
    end_date: form.end_date,
    usage_limit_total: form.usage_limit_total !== '' ? Number(form.usage_limit_total) : null,
    usage_limit_per_franchisee:
      form.usage_limit_per_franchisee !== '' ? Number(form.usage_limit_per_franchisee) : null,
    stackable: form.stackable,
    status: form.status,
    product_ids: form.product_ids,
    category_ids: form.category_ids,
    target_franchisee_ids: form.target_franchisee_ids,
    tiers: form.tiers.map((t) => ({
      min_quantity_or_amount: Number(t.min_quantity_or_amount || 0),
      discount_value: Number(t.discount_value || 0),
    })),
  });

  const livePreviewSummary = formatPromoHowItWorks(buildPayloadFromForm());

  const handleSavePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    const payload = buildPayloadFromForm();
    const validation = validatePromoPayload(payload);
    if (!validation.ok) {
      setError(validation.error || 'Invalid promotion details.');
      return;
    }

    try {
      if (editingId) {
        await api.put(`/promos/${editingId}`, payload);
        setMessage(`Promotion "${payload.name}" updated.`);
      } else {
        await api.post('/promos', payload);
        setMessage(
          `Promotion "${payload.name}" created${
            payload.status === 'Active' ? ' and franchisee alerts dispatched.' : '.'
          }`
        );
      }
      resetForm();
      loadPromos(statusFilter);
    } catch (err: any) {
      setError(err.message || 'Failed to save promotion.');
    }
  };

  const handleStatusChange = async (promoId: number, nextStatus: string) => {
    setError('');
    setMessage('');
    try {
      await api.patch(`/promos/${promoId}/status`, { status: nextStatus });
      setMessage(`Promotion #${promoId} status updated to ${nextStatus}.`);
      loadPromos(statusFilter);
      if (selectedPromoDetail?.promo?.id === promoId) {
        openPromoDetail(promoId);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update promo status.');
    }
  };

  const handleDuplicate = async (promoId: number) => {
    setError('');
    setMessage('');
    try {
      await api.post(`/promos/${promoId}/duplicate`, {});
      setMessage(`Promotion #${promoId} duplicated as Draft.`);
      loadPromos(statusFilter);
    } catch (err: any) {
      setError(err.message || 'Failed to duplicate promotion.');
    }
  };

  const openPromoDetail = async (promoId: number) => {
    setError('');
    try {
      const res = await api.get(`/promos/${promoId}`);
      setSelectedPromoDetail({
        promo: res.data,
        redemptions: res.redemptions || [],
      });
    } catch (err: any) {
      setError(err.message || 'Failed to load promo redemption details.');
    }
  };

  const toggleIdInArray = (list: number[], id: number): number[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Promotions & Franchisee Discount Engine</h1>
        <p className="text-sm text-slate-600">
          Create volume/tiered discounts, minimum purchase offers, Buy X Get Y Free cartons, seasonal sales, and franchisee-targeted promotions. Active promos automatically alert eligible franchisees and apply at checkout.
        </p>
      </div>

      {message && (
        <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
          {message}
        </div>
      )}
      {error && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* CREATE / EDIT PROMO FORM + LIVE PREVIEW */}
      <form
        onSubmit={handleSavePromo}
        className="bg-white border border-slate-200 rounded-lg p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {editingId ? `Edit Promotion #${editingId}` : 'Create New Promotion'}
            </h2>
            <p className="text-xs text-slate-500">
              All fields are validated before saving. Setting status to Active immediately notifies eligible franchisees.
            </p>
          </div>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-xs font-semibold text-slate-600 hover:underline"
            >
              Cancel Edit
            </button>
          )}
        </div>

        {/* Live Preview Box */}
        <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50/70 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
              Live Promo Rule Preview
            </div>
            <div className="text-sm font-semibold text-slate-900 mt-0.5">
              {form.name.trim() || 'Untitled Promotion'} —{' '}
              <span className="text-emerald-900">{livePreviewSummary}</span>
            </div>
            <div className="text-xs text-slate-600 mt-0.5">
              Valid: <span className="font-mono">{form.start_date}</span> to{' '}
              <span className="font-mono">{form.end_date}</span>
              {form.recurring_monthly ? ' (Recurring Monthly)' : ''} · Scope:{' '}
              <strong>
                {form.scope === 'all_products'
                  ? 'All Products'
                  : form.scope === 'category'
                  ? `${form.category_ids.length} Selected Categorie(s)`
                  : `${form.product_ids.length} Selected Product(s)`}
              </strong>{' '}
              · Targets:{' '}
              <strong>
                {form.target_franchisee_ids.length === 0
                  ? 'All Approved Franchisees'
                  : `${form.target_franchisee_ids.length} Specific Franchisee(s)`}
              </strong>
            </div>
          </div>
          <div className="text-right">
            <StatusText status={form.status} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="promo-name" className="block text-xs font-semibold text-slate-700 mb-1">
              Promotion Name
            </label>
            <input
              id="promo-name"
              type="text"
              required
              placeholder="Enter promotion name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label htmlFor="promo-type" className="block text-xs font-semibold text-slate-700 mb-1">
              Promo Type
            </label>
            <select
              id="promo-type"
              value={form.promo_type}
              onChange={(e) => handlePromoTypeChange(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              {Object.entries(PROMO_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="promo-status" className="block text-xs font-semibold text-slate-700 mb-1">
              Initial / Current Status
            </label>
            <select
              id="promo-status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as any })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="Active">Active (Publish & Notify Franchisees)</option>
              <option value="Draft">Draft (Save Without Notifying)</option>
              <option value="Paused">Paused</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="promo-desc" className="block text-xs font-semibold text-slate-700 mb-1">
            Promo Description / Franchisee Note (Optional)
          </label>
          <input
            id="promo-desc"
            type="text"
            placeholder="Enter promotion terms or summary note for franchisees"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>

        {/* Dynamic Configuration by Promo Type */}
        {form.promo_type === 'volume_tiered' && (
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-slate-800">
                Volume / Tiered Discount Rules (Multiple Tiers)
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold text-slate-700">
                  Tier Threshold Basis:
                  <select
                    value={form.tier_basis}
                    onChange={(e) => setForm({ ...form, tier_basis: e.target.value as any })}
                    className="ml-2 px-2.5 py-1 rounded border border-slate-300 bg-white text-xs"
                  >
                    <option value="quantity">By Box Quantity</option>
                    <option value="amount">By Order Amount (PHP)</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Discount Unit:
                  <select
                    value={form.discount_type}
                    onChange={(e) => setForm({ ...form, discount_type: e.target.value as any })}
                    className="ml-2 px-2.5 py-1 rounded border border-slate-300 bg-white text-xs"
                  >
                    <option value="percent">Percentage (%)</option>
                    <option value="fixed">Fixed PHP Off</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              {form.tiers.map((tier, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-mono font-semibold text-slate-600 w-16">
                    Tier #{idx + 1}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-600">
                      Min {form.tier_basis === 'amount' ? 'Amount (PHP)' : 'Boxes'}:
                    </span>
                    <input
                      type="number"
                      step={form.tier_basis === 'amount' ? '0.01' : '1'}
                      required
                      value={tier.min_quantity_or_amount}
                      onChange={(e) => {
                        const next = [...form.tiers];
                        next[idx] = { ...next[idx], min_quantity_or_amount: e.target.value };
                        setForm({ ...form, tiers: next });
                      }}
                      className="w-28 px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-mono"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-600">
                      Discount ({form.discount_type === 'percent' ? '%' : 'PHP'}):
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={tier.discount_value}
                      onChange={(e) => {
                        const next = [...form.tiers];
                        next[idx] = { ...next[idx], discount_value: e.target.value };
                        setForm({ ...form, tiers: next });
                      }}
                      className="w-28 px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-mono"
                    />
                  </div>
                  {form.tiers.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          tiers: form.tiers.filter((_, i) => i !== idx),
                        })
                      }
                      className="text-xs text-rose-700 font-semibold hover:underline"
                    >
                      Remove Tier
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setForm({
                  ...form,
                  tiers: [...form.tiers, { min_quantity_or_amount: '30', discount_value: '15' }],
                })
              }
              className="px-3 py-1 rounded border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              + Add Another Tier
            </button>
          </div>
        )}

        {form.promo_type === 'buy_x_get_y' && (
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="promo-buy-qty" className="block text-xs font-semibold text-slate-700 mb-1">
                Buy X Boxes (Qualifying Paid Quantity)
              </label>
              <input
                id="promo-buy-qty"
                type="number"
                min={1}
                required
                value={form.buy_quantity}
                onChange={(e) => setForm({ ...form, buy_quantity: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-mono"
              />
            </div>
            <div>
              <label htmlFor="promo-free-qty" className="block text-xs font-semibold text-slate-700 mb-1">
                Get Y Boxes Free (Automatically Added & Deducted from Warehouse Stock)
              </label>
              <input
                id="promo-free-qty"
                type="number"
                min={1}
                required
                value={form.free_quantity}
                onChange={(e) => setForm({ ...form, free_quantity: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-mono"
              />
            </div>
          </div>
        )}

        {form.promo_type !== 'volume_tiered' && form.promo_type !== 'buy_x_get_y' && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label htmlFor="promo-disc-type" className="block text-xs font-semibold text-slate-700 mb-1">
                Discount Type
              </label>
              <select
                id="promo-disc-type"
                value={form.discount_type}
                onChange={(e) => setForm({ ...form, discount_type: e.target.value as any })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="percent">Percentage (%)</option>
                <option value="fixed">Fixed Amount (PHP)</option>
              </select>
            </div>
            <div>
              <label htmlFor="promo-disc-val" className="block text-xs font-semibold text-slate-700 mb-1">
                Discount Value ({form.discount_type === 'percent' ? '1–90%' : 'PHP'})
              </label>
              <input
                id="promo-disc-val"
                type="number"
                step="0.01"
                value={form.discount_value}
                onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
            <div>
              <label htmlFor="promo-min-amt" className="block text-xs font-semibold text-slate-700 mb-1">
                Min Order Amount (PHP)
              </label>
              <input
                id="promo-min-amt"
                type="number"
                step="0.01"
                value={form.min_order_amount}
                onChange={(e) => setForm({ ...form, min_order_amount: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
            <div>
              <label htmlFor="promo-min-qty" className="block text-xs font-semibold text-slate-700 mb-1">
                Min Order Quantity (Boxes)
              </label>
              <input
                id="promo-min-qty"
                type="number"
                value={form.min_quantity}
                onChange={(e) => setForm({ ...form, min_quantity: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
              />
            </div>
          </div>
        )}

        {/* Dates, Limits & Cap */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
          <div>
            <label htmlFor="promo-start" className="block text-xs font-semibold text-slate-700 mb-1">
              Start Date
            </label>
            <input
              id="promo-start"
              type="date"
              required
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>
          <div>
            <label htmlFor="promo-end" className="block text-xs font-semibold text-slate-700 mb-1">
              End Date
            </label>
            <input
              id="promo-end"
              type="date"
              required
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>
          <div>
            <label htmlFor="promo-cap" className="block text-xs font-semibold text-slate-700 mb-1">
              Max Discount Cap (PHP, Optional)
            </label>
            <input
              id="promo-cap"
              type="number"
              step="0.01"
              placeholder="No cap"
              value={form.max_discount_cap}
              onChange={(e) => setForm({ ...form, max_discount_cap: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>
          <div>
            <label htmlFor="promo-lim-tot" className="block text-xs font-semibold text-slate-700 mb-1">
              Total Usage Limit (Optional)
            </label>
            <input
              id="promo-lim-tot"
              type="number"
              placeholder="Unlimited"
              value={form.usage_limit_total}
              onChange={(e) => setForm({ ...form, usage_limit_total: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>
          <div>
            <label htmlFor="promo-lim-fr" className="block text-xs font-semibold text-slate-700 mb-1">
              Per-Franchisee Limit (Optional)
            </label>
            <input
              id="promo-lim-fr"
              type="number"
              placeholder="Unlimited"
              value={form.usage_limit_per_franchisee}
              onChange={(e) => setForm({ ...form, usage_limit_per_franchisee: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>
        </div>

        {/* Toggles: Free Delivery, Stackable, Recurring Monthly */}
        <div className="flex flex-wrap items-center gap-6 pt-1">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.free_delivery || form.promo_type === 'free_delivery'}
              onChange={(e) => setForm({ ...form, free_delivery: e.target.checked })}
              className="rounded border-slate-300"
            />
            Includes Free Delivery
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.stackable}
              onChange={(e) => setForm({ ...form, stackable: e.target.checked })}
              className="rounded border-slate-300"
            />
            Stackable with Other Stackable Promos
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.recurring_monthly}
              onChange={(e) => setForm({ ...form, recurring_monthly: e.target.checked })}
              className="rounded border-slate-300"
            />
            Recurring Monthly (Valid on same day-of-month range every month)
          </label>
        </div>

        {/* Product / Category Scope & Franchisee Targeting */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
          <div className="space-y-2">
            <label htmlFor="promo-scope" className="block text-xs font-semibold text-slate-700">
              Product / Category Scope
            </label>
            <select
              id="promo-scope"
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as any })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="all_products">All Products in Catalog</option>
              <option value="category">Specific Product Categories</option>
              <option value="product">Specific AICE Products</option>
            </select>

            {form.scope === 'category' && (
              <div className="p-3 rounded-lg border border-slate-200 max-h-40 overflow-y-auto space-y-1.5 bg-slate-50">
                <div className="text-[11px] font-semibold text-slate-500">
                  Select qualifying categories:
                </div>
                {categories.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.category_ids.includes(c.id)}
                      onChange={() =>
                        setForm({
                          ...form,
                          category_ids: toggleIdInArray(form.category_ids, c.id),
                        })
                      }
                    />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            )}

            {form.scope === 'product' && (
              <div className="p-3 rounded-lg border border-slate-200 max-h-44 overflow-y-auto space-y-1.5 bg-slate-50">
                <div className="text-[11px] font-semibold text-slate-500">
                  Select qualifying products:
                </div>
                {products.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.product_ids.includes(p.id)}
                      onChange={() =>
                        setForm({
                          ...form,
                          product_ids: toggleIdInArray(form.product_ids, p.id),
                        })
                      }
                    />
                    <span>
                      {p.name} ({p.flavor}) — <span className="font-mono">PHP {Number(p.price).toFixed(2)}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="block text-xs font-semibold text-slate-700">
                Target Franchisees (Empty = All Approved Franchisees)
              </span>
              {form.target_franchisee_ids.length > 0 && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, target_franchisee_ids: [] })}
                  className="text-[11px] font-semibold text-rose-700 hover:underline"
                >
                  Reset to All Franchisees
                </button>
              )}
            </div>
            <div className="p-3 rounded-lg border border-slate-200 max-h-44 overflow-y-auto space-y-1.5 bg-slate-50">
              {franchisees.length === 0 ? (
                <p className="text-xs text-slate-500">No approved franchisees registered yet.</p>
              ) : (
                franchisees.map((f) => (
                  <label key={f.id} className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.target_franchisee_ids.includes(f.id)}
                      onChange={() =>
                        setForm({
                          ...form,
                          target_franchisee_ids: toggleIdInArray(form.target_franchisee_ids, f.id),
                        })
                      }
                    />
                    <span>
                      <strong>{f.store_name}</strong> ({f.owner_name})
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
        >
          {editingId ? 'Save Promotion Changes' : 'Create Promotion'}
        </button>
      </form>

      {/* PROMOTIONS TABLE WITH STATUS FILTER */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">All Promotions</h2>
            <p className="text-xs text-slate-500">
              Monitor validity dates, total redemptions, and total PHP discount granted across franchisee orders.
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {['', 'Active', 'Draft', 'Paused', 'Expired'].map((st) => (
              <button
                key={st || 'All'}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st || 'All'}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 pr-4">Promotion & Rule</th>
                <th className="py-2.5 pr-4">Type</th>
                <th className="py-2.5 pr-4">Validity</th>
                <th className="py-2.5 pr-4">Status</th>
                <th className="py-2.5 pr-4 text-right">Redemptions</th>
                <th className="py-2.5 pr-4 text-right">Total Discount Given</th>
                <th className="py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sm text-slate-500">
                    Loading promotions...
                  </td>
                </tr>
              ) : promos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sm text-slate-500">
                    No promotions match the selected status filter. Create a new promo above.
                  </td>
                </tr>
              ) : (
                promos.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-slate-900">{p.name}</div>
                      <div className="text-xs text-emerald-800 font-medium">{p.how_it_works}</div>
                      {p.description && (
                        <div className="text-xs text-slate-500">{p.description}</div>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs text-slate-700">
                      <div>{PROMO_TYPE_LABELS[p.promo_type] || p.promo_type}</div>
                      <div className="text-[11px] text-slate-500">
                        {Boolean(p.stackable) ? 'Stackable' : 'Non-stackable'}
                      </div>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-700">
                      <div>
                        {p.start_date} → {p.end_date}
                      </div>
                      {Boolean(p.recurring_monthly) && (
                        <div className="text-[11px] text-indigo-700 font-sans font-semibold">
                          Recurring Monthly
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusText status={p.status} />
                    </td>
                    <td className="py-3 pr-4 text-right font-mono text-xs font-semibold text-slate-900">
                      {p.redemptions_count || 0}
                      {p.usage_limit_total ? ` / ${p.usage_limit_total}` : ''}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono text-xs font-bold text-emerald-700">
                      PHP{' '}
                      {Number(p.total_discount_given || 0).toLocaleString('en-PH', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openPromoDetail(p.id)}
                          className="px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Redemptions
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditPromo(p)}
                          className="px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Edit
                        </button>
                        {p.status !== 'Active' && p.status !== 'Expired' && (
                          <button
                            type="button"
                            onClick={() => handleStatusChange(p.id, 'Active')}
                            className="px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                          >
                            Activate
                          </button>
                        )}
                        {p.status === 'Active' && (
                          <button
                            type="button"
                            onClick={() => handleStatusChange(p.id, 'Paused')}
                            className="px-2.5 py-1 rounded border border-amber-300 bg-amber-50 text-amber-900 text-xs font-semibold hover:bg-amber-100"
                          >
                            Pause
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDuplicate(p.id)}
                          className="px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Duplicate
                        </button>
                        {p.status !== 'Expired' && (
                          <button
                            type="button"
                            onClick={() => handleStatusChange(p.id, 'Expired')}
                            className="px-2.5 py-1 rounded border border-rose-300 text-rose-700 text-xs font-medium hover:bg-rose-50"
                          >
                            End
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PROMO DETAIL & REDEMPTION HISTORY PANEL */}
      {selectedPromoDetail && (
        <div className="bg-white border border-slate-300 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Redemption History · {selectedPromoDetail.promo.name}
              </h2>
              <p className="text-xs text-slate-600">
                {selectedPromoDetail.promo.how_it_works} · Total Discount Given:{' '}
                <strong className="font-mono text-emerald-700">
                  PHP{' '}
                  {Number(selectedPromoDetail.promo.total_discount_given || 0).toLocaleString(
                    'en-PH',
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                  )}
                </strong>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedPromoDetail(null)}
              className="px-3 py-1 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Close History
            </button>
          </div>

          {selectedPromoDetail.redemptions.length === 0 ? (
            <p className="text-xs text-slate-500">
              No franchisee orders have redeemed this promotion yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 font-semibold text-slate-500">
                    <th className="py-2 pr-4">Redeemed At</th>
                    <th className="py-2 pr-4">Franchisee Store</th>
                    <th className="py-2 pr-4">Order Number</th>
                    <th className="py-2 pr-4">Order Status</th>
                    <th className="py-2 pr-4 text-right">Order Subtotal</th>
                    <th className="py-2 pr-4 text-right">Discount Applied</th>
                    <th className="py-2 text-right">Final Order Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedPromoDetail.redemptions.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="py-2 pr-4 font-mono text-slate-500">{r.created_at}</td>
                      <td className="py-2 pr-4 font-semibold text-slate-900">{r.store_name}</td>
                      <td className="py-2 pr-4 font-mono font-semibold text-slate-900">
                        {r.order_number}
                      </td>
                      <td className="py-2 pr-4">
                        <StatusText status={r.order_status} />
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-slate-600">
                        PHP {Number(r.subtotal ?? r.total_amount).toFixed(2)}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono font-bold text-emerald-700">
                        -PHP {Number(r.discount_amount).toFixed(2)}
                      </td>
                      <td className="py-2 text-right font-mono font-bold text-slate-900">
                        PHP {Number(r.total_amount).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};



