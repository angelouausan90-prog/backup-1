import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { PaginationBar } from './SharedUI';

export const NotificationsView: React.FC<{ onUnreadChange?: () => void }> = ({
  onUnreadChange,
}) => {
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
        setRows(res.data);
        setPagination(res.pagination);
        if (onUnreadChange) onUnreadChange();
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(1);
  }, []);

  const markRead = async (id: number | 'all') => {
    await api.patch(`/notifications/${id}/read`);
    load(pagination.page);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Notifications</h1>
          <p className="text-sm text-slate-600">
            In-app alerts for new replenishment orders, franchisee approvals, delivery status updates, and low stock.
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
              className={`p-4 flex items-start justify-between gap-4 ${
                !n.is_read ? 'bg-amber-50/40' : ''
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold text-slate-900">{n.title}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-xs font-mono text-slate-500">{n.created_at}</span>
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
                  onClick={() => markRead(n.id)}
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
