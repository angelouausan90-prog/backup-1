import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { RoleName } from '../types';
import {
  formatRelativeTimeAgo,
  resolveNotificationTargetRoute,
} from '../utils/domainRules';
import { PaginationBar } from './SharedUI';

export const NotificationsView: React.FC<{
  role?: RoleName;
  onUnreadChange?: () => void;
  onNavigate?: (path: string, trackOrderId?: number | null) => void;
}> = ({ role, onUnreadChange, onNavigate }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 15,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);

  const load = (page = 1) => {
    setLoading(true);
    api
      .get(`/notifications?page=${page}&limit=15`)
      .then((res) => {
        setRows(res.data || []);
        if (res.pagination) setPagination(res.pagination);
        if (onUnreadChange) onUnreadChange();
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(1);
  }, []);

  const markRead = async (id: number | 'all') => {
    if (id === 'all') {
      await api.post('/notifications/read-all', {});
    } else {
      await api.post(`/notifications/${id}/read`, {});
    }
    load(pagination.page);
  };

  const handleRowClick = async (n: any) => {
    if (!n.is_read) {
      await api.post(`/notifications/${n.id}/read`, {}).catch(() => {});
      if (onUnreadChange) onUnreadChange();
    }
    if (role && onNavigate) {
      const target = resolveNotificationTargetRoute(role, n.type, n.related_id);
      if (!target.path.endsWith('/notifications')) {
        onNavigate(target.path, target.trackOrderId);
        return;
      }
    }
    if (!n.is_read) {
      load(pagination.page);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Notifications</h1>
          <p className="text-sm text-slate-600">
            In-app alerts for new replenishment orders, franchisee approvals, delivery status updates, promotions, and low stock.
          </p>
        </div>
        <button
          type="button"
          onClick={() => markRead('all')}
          className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          Mark All Read
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading notifications...</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No notifications recorded yet.</div>
        ) : (
          rows.map((n) => (
            <div
              key={n.id}
              onClick={() => handleRowClick(n)}
              className={`p-4 flex items-start justify-between gap-4 cursor-pointer transition-colors hover:bg-slate-50 ${
                !n.is_read ? 'bg-amber-50/40' : ''
              }`}
            >
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {!n.is_read && (
                    <span
                      className="w-2 h-2 rounded-full bg-rose-600 shrink-0"
                      aria-label="Unread notification"
                    />
                  )}
                  <span className="font-semibold text-slate-900">{n.title}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-xs text-slate-500">
                    {formatRelativeTimeAgo(n.created_at)}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="text-xs font-mono text-slate-400">{n.created_at}</span>
                  {!n.is_read && (
                    <>
                      <span className="text-slate-400">·</span>
                      <span className="text-xs font-semibold text-rose-700">Unread</span>
                    </>
                  )}
                </div>
                <p className="text-sm text-slate-700">{n.message}</p>
              </div>
              {!n.is_read && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    markRead(n.id);
                  }}
                  className="px-3 py-1 rounded border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Mark Read
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <PaginationBar pagination={pagination} onPageChange={load} />
    </div>
  );
};
