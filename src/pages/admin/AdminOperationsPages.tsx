import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { PaginationBar, ProductImage, StatusText } from '../../components/SharedUI';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

// ===== 7. PRODUCTS & CATEGORIES (With Multer Image Upload, Live Preview, Neutral "No image" fallback) =====
export const ProductsManagementView: React.FC = () => {
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
      <div>
        <h1 className="text-xl font-bold text-slate-900">Products & Categories</h1>
        <p className="text-sm text-slate-600">
          Manage AICE ice cream SKUs, flavors, sizes, pricing, and upload your own authentic product photos (JPG, PNG, WEBP up to 5 MB).
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Product Categories</h2>
          <form onSubmit={handleAddCategory} className="flex gap-2">
            <input
              type="text"
              aria-label="New category name"
              placeholder="e.g. Stick, Cone, Cup, Mochi"
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
                placeholder="e.g. AICE-WATERMELON-65"
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
                placeholder="e.g. AICE Watermelon Stick (Box of 40)"
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
                placeholder="e.g. Watermelon"
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
                placeholder="e.g. 65ml x 40 pcs"
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
                placeholder="e.g. 480.00"
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
                    <div className="font-mono text-sm font-bold text-slate-900">
                      PHP {Number(o.total_amount).toFixed(2)}
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
                        <div className="font-semibold text-slate-800">{it.product_name}</div>
                        <div className="text-slate-500 font-mono">
                          {it.quantity} x PHP {Number(it.unit_price).toFixed(2)} = PHP{' '}
                          {Number(it.subtotal).toFixed(2)}
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
                            {r.full_name} (@{r.username})
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
                {a.full_name} ({a.approved_recruits} approved / {a.total_recruits} recruits)
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
            placeholder="Period (e.g. November 2026)"
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
                      {c.agent_name} <span className="font-mono text-xs text-slate-500">(@{c.agent_username})</span>
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
      head: [['Order #', 'Date', 'Store', 'Warehouse', 'Status', 'Total (PHP)']],
      body: sales.map((s) => [
        s.order_number,
        s.order_date,
        s.store_name,
        s.warehouse_name,
        s.status,
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
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-slate-500">
                      No sales data yet.
                    </td>
                  </tr>
                ) : (
                  sales.map((s, idx) => (
                    <tr key={idx}>
                      <td className="py-2 pr-3 font-mono font-semibold">{s.order_number}</td>
                      <td className="py-2 pr-3">{s.store_name}</td>
                      <td className="py-2 pr-3">
                        <StatusText status={s.status} />
                      </td>
                      <td className="py-2 text-right font-mono">
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
                    {l.full_name || 'System'} {l.username ? `(@${l.username})` : ''}
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
