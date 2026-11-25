import React from 'react';
import { Pagination } from '../types';

/**
 * ProductImage renders the product's own uploaded image with consistent 4:3 aspect ratio and object-fit: cover.
 * When a product has no image yet, it renders a clean neutral "No image" box (never stock photos, emojis, or fake photos).
 */
export const ProductImage: React.FC<{
  imageUrl: string | null | undefined;
  alt: string;
  thumb?: boolean;
}> = ({ imageUrl, alt, thumb }) => {
  if (!imageUrl) {
    return (
      <div
        className={
          thumb
            ? 'w-16 h-12 rounded-md bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-[11px] font-medium text-slate-500 shrink-0 select-none'
            : 'w-full aspect-[4/3] rounded-lg bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-xs font-medium text-slate-500 select-none'
        }
      >
        No image
      </div>
    );
  }
  return (
    <img
      src={imageUrl}
      alt={alt}
      referrerPolicy="no-referrer"
      className={
        thumb
          ? 'w-16 h-12 rounded-md object-cover bg-slate-100 border border-slate-200 shrink-0'
          : 'w-full aspect-[4/3] rounded-lg object-cover bg-slate-100 border border-slate-200'
      }
    />
  );
};

/**
 * StockStatusBadge renders exact, consistent stock status labels ("In Stock", "Low Stock", "No Stock")
 * with distinct high-contrast colors (green, orange, red) across inventory, catalog, reports, and restocking.
 */
export const StockStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const normalized =
    status === 'No Stock'
      ? 'No Stock'
      : status === 'Low Stock'
      ? 'Low Stock'
      : 'In Stock';

  const styleMap: Record<string, string> = {
    'In Stock': 'bg-emerald-100 text-emerald-800 border-emerald-200',
    'Low Stock': 'bg-orange-100 text-orange-800 border-orange-200',
    'No Stock': 'bg-rose-100 text-rose-800 border-rose-200',
  };

  const dotMap: Record<string, string> = {
    'In Stock': 'bg-emerald-600',
    'Low Stock': 'bg-orange-500',
    'No Stock': 'bg-rose-600',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold whitespace-nowrap ${styleMap[normalized]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotMap[normalized]}`} aria-hidden="true" />
      {normalized}
    </span>
  );
};

/**
 * StatusText renders clean semantic status text for orders, applications, and restock workflows.
 */
export const StatusText: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'In Stock' || status === 'Low Stock' || status === 'No Stock') {
    return <StockStatusBadge status={status} />;
  }
  const colorMap: Record<string, string> = {
    Approved: 'text-emerald-700 font-semibold',
    'Approved/In Transit': 'text-blue-700 font-semibold',
    Received: 'text-emerald-700 font-semibold',
    Delivered: 'text-emerald-700 font-semibold',
    Paid: 'text-emerald-700 font-semibold',
    Active: 'text-emerald-700 font-semibold',
    Pending: 'text-amber-700 font-semibold',
    Placed: 'text-slate-700 font-medium',
    Confirmed: 'text-blue-700 font-semibold',
    Preparing: 'text-indigo-700 font-semibold',
    'Assigned to Delivery': 'text-blue-700 font-semibold',
    Assigned: 'text-blue-700 font-semibold',
    'Picked Up': 'text-indigo-700 font-semibold',
    'Out for Delivery': 'text-amber-700 font-semibold',
    'Near / Arrived': 'text-rose-700 font-semibold',
    Rejected: 'text-rose-700 font-semibold',
    Cancelled: 'text-slate-500 font-medium line-through',
    Inactive: 'text-slate-500 font-medium',
    Draft: 'text-amber-800 font-semibold',
    Paused: 'text-amber-700 font-semibold',
    Expired: 'text-slate-500 font-medium',
  };
  return <span className={`text-xs ${colorMap[status] || 'text-slate-700 font-medium'}`}>{status}</span>;
};

export const PaginationBar: React.FC<{
  pagination: Pagination;
  onPageChange: (page: number) => void;
}> = ({ pagination, onPageChange }) => {
  if (!pagination || pagination.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-200 text-xs text-slate-600">
      <span className="tabular-nums">
        Page {pagination.page} of {pagination.totalPages} · {pagination.total} records
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
          className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap shrink-0"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => onPageChange(pagination.page + 1)}
          className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap shrink-0"
        >
          Next
        </button>
      </div>
    </div>
  );
};
