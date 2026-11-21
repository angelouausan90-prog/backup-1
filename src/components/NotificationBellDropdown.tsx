import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from '../services/api';
import { RoleName } from '../types';
import {
  formatBadgeCount,
  formatRelativeTimeAgo,
  resolveNotificationTargetRoute,
} from '../utils/domainRules';

interface NotificationItem {
  id: number;
  user_id: number;
  title: string;
  message: string;
  type: string;
  related_id: number | null;
  is_read: number;
  created_at: string;
}

interface NotificationBellDropdownProps {
  role: RoleName;
  unreadTotal: number;
  disabled?: boolean;
  onSummaryRefresh: () => void;
  onNavigate: (path: string, trackOrderId?: number | null) => void;
}

export const NotificationBellDropdown: React.FC<NotificationBellDropdownProps> = ({
  role,
  unreadTotal,
  disabled = false,
  onSummaryRefresh,
  onNavigate,
}) => {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<NotificationItem[]>([]);
  const [markingAll, setMarkingAll] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const badgeText = formatBadgeCount(unreadTotal);

  const fetchRecentNotifications = () => {
    api
      .get('/notifications?limit=8')
      .then((res) => {
        setRecent(Array.isArray(res?.data) ? res.data.slice(0, 8) : []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (open) {
      fetchRecentNotifications();
    }
  }, [open, unreadTotal]);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleMarkAllAsRead = async () => {
    if (markingAll) return;
    setMarkingAll(true);
    try {
      await api.post('/notifications/read-all', {});
      setRecent((prev) => prev.map((item) => ({ ...item, is_read: 1 })));
      onSummaryRefresh();
    } catch {
      // ignore
    } finally {
      setMarkingAll(false);
    }
  };

  const handleNotificationClick = async (n: NotificationItem) => {
    setOpen(false);
    if (!n.is_read) {
      setRecent((prev) =>
        prev.map((item) => (item.id === n.id ? { ...item, is_read: 1 } : item))
      );
      await api.post(`/notifications/${n.id}/read`, {}).catch(() => {});
      onSummaryRefresh();
    }
    const target = resolveNotificationTargetRoute(role, n.type, n.related_id);
    onNavigate(target.path, target.trackOrderId);
  };

  const handleViewAll = () => {
    setOpen(false);
    onNavigate(`/${role}/notifications`);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="true"
        title="Notifications"
        onClick={() => setOpen((prev) => !prev)}
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 transition-colors"
      >
        <Bell className="w-4 h-4" />
        {badgeText && (
          <span
            data-testid="bell-unread-badge"
            className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold leading-none shadow-sm"
          >
            {badgeText}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Recent Notifications"
          className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-slate-200 bg-white shadow-xl z-50 overflow-hidden"
        >
          {/* Dropdown Header */}
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900">Notifications</span>
              {badgeText && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-bold leading-none">
                  {badgeText}
                </span>
              )}
            </div>
            <button
              type="button"
              disabled={unreadTotal === 0 || markingAll}
              onClick={handleMarkAllAsRead}
              className="text-xs font-semibold text-rose-600 hover:text-rose-700 disabled:text-slate-400 disabled:cursor-not-allowed"
            >
              Mark all as read
            </button>
          </div>

          {/* 8 Most Recent Notifications */}
          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
            {recent.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No notifications yet.
              </div>
            ) : (
              recent.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleNotificationClick(n)}
                  className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-slate-50 ${
                    !n.is_read ? 'bg-rose-50/40' : 'bg-white'
                  }`}
                >
                  <div className="pt-1.5 shrink-0">
                    {!n.is_read ? (
                      <span
                        data-testid="notification-unread-dot"
                        className="block w-2 h-2 rounded-full bg-rose-600"
                        title="Unread"
                      />
                    ) : (
                      <span className="block w-2 h-2 rounded-full bg-transparent" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={`text-xs truncate ${
                          !n.is_read
                            ? 'font-bold text-slate-900'
                            : 'font-semibold text-slate-700'
                        }`}
                      >
                        {n.title}
                      </span>
                      <span className="text-[11px] text-slate-400 whitespace-nowrap shrink-0">
                        {formatRelativeTimeAgo(n.created_at)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-2 leading-snug">
                      {n.message}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer: View all */}
          <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 text-center">
            <button
              type="button"
              onClick={handleViewAll}
              className="text-xs font-semibold text-slate-800 hover:text-rose-600 transition-colors"
            >
              View all
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
