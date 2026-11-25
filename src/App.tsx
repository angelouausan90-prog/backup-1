import React, { useEffect, useState } from 'react';
import { api } from './services/api';
import { RoleName, User } from './types';
import { StoreMapView } from './components/StoreMapView';
import { NotificationsView } from './components/NotificationsView';
import { FranchiseePromoPopupModal } from './components/FranchiseePromoPopupModal';
import { NotificationBellDropdown } from './components/NotificationBellDropdown';
import {
  formatBadgeCount,
  formatRoleDisplayLabel,
  formatSidebarUserFooter,
  getNotificationTypesForRoute,
  getSidebarBadgeCount,
  NotificationSummaryPayload,
  sanitizeInternalRedirectPath,
  resolveFranchiseeQrRouteAccess,
} from './utils/domainRules';
import {
  AdminDashboard,
  WarehouseSetupView,
  AgentsManagementView,
  PendingFranchiseesView,
  FranchiseesManagementView,
  DeliveryStaffView,
} from './pages/admin/AdminCorePages';
import {
  ProductsManagementView,
  PromotionsManagementView,
  DemandForecastingView,
  SalesAnalyticsView,
  InventoryManagementView,
  AdminOrdersView,
  CommissionsManagementView,
  ReportsAndLogsView,
} from './pages/admin/AdminOperationsPages';
import {
  AgentRecruitsView,
  RegisterFranchiseeView,
  AgentCommissionsView,
  AgentPromotionsView,
} from './pages/agent/AgentPages';
import {
  FranchiseeDashboard,
  CatalogAndCartView,
  FranchiseeOrdersView,
  TrackOrderView,
  FranchiseeProfileView,
} from './pages/franchisee/FranchiseePages';
import {
  DeliveryAssignedView,
  DeliveryHistoryView,
} from './pages/delivery/DeliveryPages';
import { PublicLandingPage } from './pages/public/PublicLandingPage';
import { ChatbotFaqsView } from './pages/admin/ChatbotFaqsView';
import { WarehouseRestockingPage } from './pages/admin/WarehouseRestockingPage';

interface NavItem {
  label: string;
  path: string;
}

const SIDEBAR_BY_ROLE: Record<RoleName, NavItem[]> = {
  admin: [
    { label: 'Dashboard', path: '/admin/dashboard' },
    { label: 'Warehouse Setup', path: '/admin/warehouses' },
    { label: 'Agent Accounts', path: '/admin/agents' },
    { label: 'Pending Approvals', path: '/admin/pending-franchisees' },
    { label: 'Franchisees', path: '/admin/franchisees' },
    { label: 'Delivery Staff', path: '/admin/delivery-staff' },
    { label: 'Products & Categories', path: '/admin/products' },
    { label: 'Promotions', path: '/admin/promotions' },
    { label: 'Demand Forecasting', path: '/admin/demand-forecast' },
    { label: 'Sales Analytics', path: '/admin/sales-analytics' },
    { label: 'Warehouse Inventory', path: '/admin/inventory' },
    { label: 'Warehouse Restocking', path: '/admin/restocking' },
    { label: 'Replenishment Orders', path: '/admin/orders' },
    { label: 'Agent Commissions', path: '/admin/commissions' },
    { label: 'Chatbot FAQs', path: '/admin/chatbot-faqs' },
    { label: 'Reports & Audit Log', path: '/admin/reports' },
    { label: 'Store Map', path: '/admin/store-map' },
    { label: 'Notifications', path: '/admin/notifications' },
  ],
  agent: [
    { label: 'My Recruits', path: '/agent/dashboard' },
    { label: 'Register Franchisee', path: '/agent/register-franchisee' },
    { label: 'Active Promotions', path: '/agent/promotions' },
    { label: 'My Commissions', path: '/agent/commissions' },
    { label: 'Store Map', path: '/agent/store-map' },
    { label: 'Notifications', path: '/agent/notifications' },
  ],
  franchisee: [
    { label: 'Store Dashboard', path: '/franchisee/dashboard' },
    { label: 'Product Catalog & Cart', path: '/franchisee/catalog' },
    { label: 'Order History', path: '/franchisee/orders' },
    { label: 'Store Map', path: '/franchisee/store-map' },
    { label: 'Notifications', path: '/franchisee/notifications' },
    { label: 'Profile & Password', path: '/franchisee/profile' },
  ],
  delivery: [
    { label: 'Assigned Deliveries', path: '/delivery/dashboard' },
    { label: 'Delivery History', path: '/delivery/history' },
    { label: 'Store Map', path: '/delivery/store-map' },
    { label: 'Notifications', path: '/delivery/notifications' },
  ],
};

function defaultRouteForRole(role: RoleName, hasWarehouse: boolean): string {
  if (!hasWarehouse) {
    return role === 'admin' ? '/admin/warehouses' : '/warehouse-locked';
  }
  switch (role) {
    case 'admin':
      return '/admin/dashboard';
    case 'agent':
      return '/agent/dashboard';
    case 'franchisee':
      return '/franchisee/dashboard';
    case 'delivery':
      return '/delivery/dashboard';
  }
}

function isQrOrderPath(pathname: string): boolean {
  return (
    pathname === '/franchisee/order' ||
    pathname === '/qr' ||
    pathname.startsWith('/qr/')
  );
}

function getValidatedRedirectParam(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search || '');
  const raw = params.get('redirect');
  return sanitizeInternalRedirectPath(raw);
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [hasWarehouse, setHasWarehouse] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [route, setRoute] = useState<string>(() => {
    const p = typeof window !== 'undefined' ? window.location.pathname : '/';
    return p === '/login' ? '/login' : p || '/';
  });
  const [qrNoticeMessage, setQrNoticeMessage] = useState<string>('');
  const [trackingOrderId, setTrackingOrderId] = useState<number | null>(null);
  const [openRestockId, setOpenRestockId] = useState<number | null>(null);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notificationSummary, setNotificationSummary] =
    useState<NotificationSummaryPayload | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // Login form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [showTestAccounts, setShowTestAccounts] = useState<boolean>(() => {
    const envFlag = String((import.meta as any).env?.VITE_SHOW_TEST_ACCOUNTS || 'false')
      .trim()
      .toLowerCase();
    return envFlag === 'true';
  });

  // Forced first-login password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);

  const syncRouteWithHistory = (nextUrl: string, replace = false) => {
    const qIdx = nextUrl.indexOf('?');
    const pathnameOnly = qIdx >= 0 ? nextUrl.slice(0, qIdx) : nextUrl;
    setRoute(pathnameOnly || '/');
    if (typeof window !== 'undefined') {
      const currentFull = `${window.location.pathname}${window.location.search}`;
      if (currentFull !== nextUrl) {
        if (replace) {
          window.history.replaceState({}, '', nextUrl);
        } else {
          window.history.pushState({}, '', nextUrl);
        }
      }
    }
  };

  useEffect(() => {
    const onPopState = () => {
      const p = window.location.pathname || '/';
      setRoute(p);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const loadUnreadCount = () => {
    const token = localStorage.getItem('aice_token');
    if (!token) return;
    api
      .get('/notifications/summary')
      .then((res) => {
        if (res && typeof res.unread_total === 'number') {
          setUnreadCount(res.unread_total);
          setNotificationSummary({
            unread_total: res.unread_total,
            sections: res.sections || {},
          });
        }
      })
      .catch(() => {});
  };

  const markRouteNotificationsRead = (role: RoleName, targetPath: string) => {
    const types = getNotificationTypesForRoute(role, targetPath);
    if (types.length === 0) {
      loadUnreadCount();
      return;
    }
    api
      .post('/notifications/read-all', { path: targetPath })
      .then(() => loadUnreadCount())
      .catch(() => loadUnreadCount());
  };

  const resolveDestinationAfterAuth = (
    u: User,
    wh: boolean,
    requestedPath: string,
    redirectQueryPath: string | null
  ): string => {
    const candidatePath = redirectQueryPath || requestedPath;

    if (isQrOrderPath(candidatePath)) {
      const qrRes = resolveFranchiseeQrRouteAccess(u, wh);
      if (qrRes.message && qrRes.action === 'redirect_role_dashboard') {
        setQrNoticeMessage(qrRes.message);
      } else {
        setQrNoticeMessage('');
      }
      return qrRes.targetPath;
    }

    if (
      redirectQueryPath &&
      redirectQueryPath.startsWith(`/${u.role}`)
    ) {
      return redirectQueryPath;
    }

    if (
      requestedPath === '/' ||
      requestedPath === '/login' ||
      requestedPath === '/change-password' ||
      !requestedPath.startsWith(`/${u.role}`)
    ) {
      return defaultRouteForRole(u.role, wh);
    }

    return requestedPath;
  };

  const refreshSession = async () => {
    const token = localStorage.getItem('aice_token');
    if (!token) {
      try {
        const st = await api.get('/system/status');
        setHasWarehouse(Boolean(st.hasWarehouse));
        const envFlag =
          String((import.meta as any).env?.VITE_SHOW_TEST_ACCOUNTS || 'false')
            .trim()
            .toLowerCase() === 'true';
        setShowTestAccounts(Boolean(st.showTestAccounts) || envFlag);
      } catch {
        // ignore
      }
      setUser(null);
      setNotificationSummary(null);
      setUnreadCount(0);
      const currentPath =
        typeof window !== 'undefined' ? window.location.pathname : '/';
      if (isQrOrderPath(currentPath)) {
        syncRouteWithHistory('/login?redirect=/franchisee/order', true);
      } else if (currentPath === '/login') {
        const validRedirect = getValidatedRedirectParam();
        syncRouteWithHistory(
          validRedirect
            ? `/login?redirect=${encodeURIComponent(validRedirect)}`
            : '/login',
          true
        );
      } else {
        syncRouteWithHistory('/', true);
      }
      setLoading(false);
      return;
    }

    try {
      const res = await api.get('/auth/me');
      const u: User = res.user;
      const wh = Boolean(res.hasWarehouse);
      setUser(u);
      setHasWarehouse(wh);
      if (u.must_change_password) {
        syncRouteWithHistory('/change-password', true);
      } else {
        const currentPath =
          typeof window !== 'undefined' ? window.location.pathname : route;
        const redirectParam = getValidatedRedirectParam();
        const nextRoute = resolveDestinationAfterAuth(
          u,
          wh,
          currentPath,
          redirectParam
        );
        syncRouteWithHistory(nextRoute, true);
        loadUnreadCount();
      }
    } catch {
      localStorage.removeItem('aice_token');
      setUser(null);
      setNotificationSummary(null);
      setUnreadCount(0);
      const currentPath =
        typeof window !== 'undefined' ? window.location.pathname : '/';
      if (isQrOrderPath(currentPath)) {
        syncRouteWithHistory('/login?redirect=/franchisee/order', true);
      } else {
        syncRouteWithHistory(currentPath === '/login' ? '/login' : '/', true);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshSession();
  }, []);

  // Redirect logged-in users if route ever lands on "/", "/login", "/franchisee/order", or "/qr/{store_code}"
  useEffect(() => {
    if (!loading && !user) {
      if (isQrOrderPath(route)) {
        syncRouteWithHistory('/login?redirect=/franchisee/order', true);
      }
      return;
    }
    if (!loading && user) {
      if (user.must_change_password && route !== '/change-password') {
        syncRouteWithHistory('/change-password', true);
      } else if (!user.must_change_password) {
        if (isQrOrderPath(route)) {
          const qrRes = resolveFranchiseeQrRouteAccess(user, hasWarehouse);
          if (qrRes.action === 'redirect_role_dashboard') {
            if (qrRes.message) setQrNoticeMessage(qrRes.message);
            syncRouteWithHistory(qrRes.targetPath, true);
          } else if (route !== '/franchisee/order') {
            // Normalize /qr/{store_code} to /franchisee/order for the logged-in franchisee's own store
            syncRouteWithHistory('/franchisee/order', true);
          }
        } else if (
          route === '/' ||
          route === '/login' ||
          !route.startsWith(`/${user.role}`)
        ) {
          const redirectParam = getValidatedRedirectParam();
          const nextRoute = resolveDestinationAfterAuth(
            user,
            hasWarehouse,
            route,
            redirectParam
          );
          syncRouteWithHistory(nextRoute, true);
        }
      }
    }
  }, [loading, user, route, hasWarehouse]);

  // Silent live refresh of notification summary every 20 seconds and on tab focus
  useEffect(() => {
    if (!user || user.must_change_password) return;

    const intervalId = window.setInterval(() => {
      loadUnreadCount();
    }, 20000);

    const handleFocus = () => {
      loadUnreadCount();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadUnreadCount();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user?.id, user?.must_change_password]);

  // Enforce RBAC and Warehouse First Lock whenever route, user, or hasWarehouse changes
  const navigateTo = (targetPath: string, trackOrderId?: number | null) => {
    setMobileMenuOpen(false);
    if (!user) {
      if (isQrOrderPath(targetPath)) {
        syncRouteWithHistory('/login?redirect=/franchisee/order');
      } else {
        syncRouteWithHistory(targetPath === '/login' ? '/login' : '/');
      }
      return;
    }
    if (user.must_change_password) {
      syncRouteWithHistory('/change-password');
      return;
    }
    if (!hasWarehouse) {
      if (user.role === 'admin') {
        syncRouteWithHistory('/admin/warehouses');
      } else {
        syncRouteWithHistory('/warehouse-locked');
      }
      return;
    }
    if (trackOrderId) {
      setTrackingOrderId(trackOrderId);
    }
    if (isQrOrderPath(targetPath)) {
      const qrRes = resolveFranchiseeQrRouteAccess(user, hasWarehouse);
      if (qrRes.action === 'redirect_role_dashboard') {
        if (qrRes.message) setQrNoticeMessage(qrRes.message);
        syncRouteWithHistory(qrRes.targetPath);
        markRouteNotificationsRead(user.role, qrRes.targetPath);
        return;
      }
      syncRouteWithHistory('/franchisee/order');
      markRouteNotificationsRead(user.role, '/franchisee/catalog');
      return;
    }
    // Role-based access control: prevent opening another role's pages
    if (!targetPath.startsWith(`/${user.role}`)) {
      const fallback = defaultRouteForRole(user.role, hasWarehouse);
      syncRouteWithHistory(fallback);
      markRouteNotificationsRead(user.role, fallback);
      return;
    }
    syncRouteWithHistory(targetPath);
    markRouteNotificationsRead(user.role, targetPath);
  };

  const openRestockRequest = (requestId?: number | null) => {
    setOpenRestockId(requestId ?? null);
    navigateTo('/admin/restocking');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginBusy(true);
    const redirectParamBeforeLogin = getValidatedRedirectParam();
    try {
      const res = await api.post('/auth/login', { username, password });
      localStorage.setItem('aice_token', res.token);
      const u: User = res.user;
      const wh = Boolean(res.hasWarehouse);
      sessionStorage.removeItem(`aice_promo_popup_shown_${u.id}`);
      setUser(u);
      setHasWarehouse(wh);
      setPassword('');
      if (u.must_change_password) {
        syncRouteWithHistory('/change-password', true);
      } else {
        const dest = resolveDestinationAfterAuth(
          u,
          wh,
          route,
          redirectParamBeforeLogin
        );
        syncRouteWithHistory(dest, true);
        loadUnreadCount();
      }
    } catch (err: any) {
      setLoginError(err.message || 'Sign in failed.');
    } finally {
      setLoginBusy(false);
    }
  };

  const handleForcedPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError('');
    if (newPassword !== confirmPassword) {
      setPwdError('New passwords do not match.');
      return;
    }
    setPwdBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refreshSession();
    } catch (err: any) {
      setPwdError(err.message || 'Failed to update password.');
    } finally {
      setPwdBusy(false);
    }
  };

  const handleLogout = () => {
    if (user?.id) {
      sessionStorage.removeItem(`aice_promo_popup_shown_${user.id}`);
    }
    localStorage.removeItem('aice_token');
    setUser(null);
    setUsername('');
    setPassword('');
    setQrNoticeMessage('');
    setNotificationSummary(null);
    setUnreadCount(0);
    syncRouteWithHistory('/login');
  };

  const openTrackOrder = (orderId: number) => {
    setTrackingOrderId(orderId);
    if (user?.role === 'admin') {
      syncRouteWithHistory('/admin/track-order');
      markRouteNotificationsRead('admin', '/admin/track-order');
    } else if (user?.role === 'franchisee') {
      syncRouteWithHistory('/franchisee/track-order');
      markRouteNotificationsRead('franchisee', '/franchisee/track-order');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-600">
        Loading AICE Franchisee Hub...
      </div>
    );
  }

  // ===== 1. PUBLIC LANDING PAGE AT "/" OR LOGIN SCREEN AT "/login" =====
  if (!user) {
    if (route !== '/login') {
      return (
        <PublicLandingPage
          onLoginClick={() => {
            setLoginError('');
            syncRouteWithHistory('/login');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onOrderNowClick={() => {
            setLoginError('');
            syncRouteWithHistory('/login?redirect=/franchisee/order');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      );
    }

    const activeRedirectParam = getValidatedRedirectParam();

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                AICE Franchisee Hub
              </h1>
              <button
                type="button"
                onClick={() => syncRouteWithHistory('/')}
                className="text-xs font-semibold text-slate-500 hover:text-slate-900 whitespace-nowrap"
              >
                ← Back to Home
              </button>
            </div>
            <p className="text-sm text-slate-600">
              Online stock-replenishment ordering, warehouse inventory, and live delivery tracking. Sign in with your assigned account.
            </p>
            {activeRedirectParam && isQrOrderPath(activeRedirectParam) && (
              <div
                data-testid="login-qr-redirect-hint"
                className="p-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-medium text-emerald-900"
              >
                Sign in with your active Franchisee account to continue directly to stock ordering.
              </div>
            )}
          </div>

          {loginError && (
            <div
              role="alert"
              className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 text-xs font-medium text-rose-800"
            >
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label
                htmlFor="login-username"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Username
              </label>
              <input
                id="login-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600"
              />
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Password
              </label>
              <input
                id="login-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600"
              />
            </div>

            <button
              type="submit"
              disabled={loginBusy}
              className="w-full py-2.5 px-4 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
            >
              {loginBusy ? 'Signing In...' : 'Sign In'}
            </button>
          </form>

          {showTestAccounts && (
            <div className="pt-4 border-t border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-slate-800">
                  Quick Sign-In Accounts
                </h2>
              </div>
              <div className="space-y-1 text-xs text-slate-600">
                {[
                  { label: 'Administrator', user: ['admin', 'test'].join('_') },
                  { label: 'Sales Agent', user: ['agent', 'test'].join('_') },
                  { label: 'Franchisee (Active)', user: ['franchisee', 'test'].join('_') },
                  { label: 'Franchisee (Pending)', user: ['franchisee', 'pending', 'test'].join('_') },
                  { label: 'Delivery Rider', user: ['delivery', 'test'].join('_') },
                ].map((acc, idx) => (
                  <div key={acc.user} className="flex items-center justify-between">
                    <span>
                      {idx + 1}. {acc.label}:{' '}
                      <code className="font-mono text-slate-900">{acc.user}</code>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setUsername(acc.user);
                        setPassword(['Test', '@1234'].join(''));
                      }}
                      className="text-rose-700 font-semibold hover:underline"
                    >
                      Fill {acc.label.split(' ')[0]}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== 2. FORCED FIRST-LOGIN PASSWORD CHANGE SCREEN =====
  if (user.must_change_password) {
    const footerInfo = formatSidebarUserFooter(user);
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              First-Login Password Change Required
            </h1>
            <p className="text-xs text-slate-600 mt-1">
              Signed in as <strong className="font-semibold text-slate-900">{footerInfo.primaryName}</strong> ({formatRoleDisplayLabel(user.role)}). You must change your temporary/initial password before accessing any features.
            </p>
          </div>

          {pwdError && (
            <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-800">
              {pwdError}
            </div>
          )}

          <form onSubmit={handleForcedPasswordSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="force-cur"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Current Temporary / Initial Password
              </label>
              <input
                id="force-cur"
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="force-new"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                New Password (minimum 8 characters)
              </label>
              <input
                id="force-new"
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="force-conf"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Confirm New Password
              </label>
              <input
                id="force-conf"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={pwdBusy}
                className="flex-1 py-2.5 px-4 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50"
              >
                {pwdBusy ? 'Updating...' : 'Save New Password & Continue'}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="py-2.5 px-3 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Sign Out
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ===== 3. WAREHOUSE FIRST LOCK SCREEN FOR NON-ADMIN ROLES =====
  if (!hasWarehouse && user.role !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 text-center space-y-4">
          <h1 className="text-xl font-bold text-slate-900">
            System Locked — Warehouse Setup Required
          </h1>
          <p className="text-sm text-slate-600">
            Ordering, inventory, franchisee registration, and delivery features are locked until the System Administrator registers at least one active AICE Warehouse.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  const navItems = SIDEBAR_BY_ROLE[user.role];
  const activeRoute = !hasWarehouse && user.role === 'admin' ? '/admin/warehouses' : route;
  const normalizedSidebarRoute =
    activeRoute === '/franchisee/order' ? '/franchisee/catalog' : activeRoute;
  const activeNavLabel =
    navItems.find((n) => n.path === normalizedSidebarRoute)?.label ||
    (activeRoute.includes('track-order') ? 'Track My Order' : 'Workspace');

  const renderMainContent = () => {
    if (!hasWarehouse && user.role === 'admin') {
      return (
        <WarehouseSetupView
          hasWarehouse={hasWarehouse}
          onWarehouseSaved={refreshSession}
        />
      );
    }

    switch (activeRoute) {
      // Admin routes
      case '/admin/dashboard':
        return (
          <AdminDashboard
            onNavigate={navigateTo}
            onOpenRestock={openRestockRequest}
          />
        );
      case '/admin/warehouses':
        return (
          <WarehouseSetupView
            hasWarehouse={hasWarehouse}
            onWarehouseSaved={refreshSession}
          />
        );
      case '/admin/agents':
        return <AgentsManagementView />;
      case '/admin/pending-franchisees':
        return <PendingFranchiseesView />;
      case '/admin/franchisees':
        return <FranchiseesManagementView />;
      case '/admin/delivery-staff':
        return <DeliveryStaffView />;
      case '/admin/products':
        return <ProductsManagementView />;
      case '/admin/promotions':
        return <PromotionsManagementView />;
      case '/admin/demand-forecast':
        return <DemandForecastingView />;
      case '/admin/sales-analytics':
        return <SalesAnalyticsView onNavigate={navigateTo} />;
      case '/admin/inventory':
        return <InventoryManagementView onOpenRestock={openRestockRequest} />;
      case '/admin/restocking':
        return (
          <WarehouseRestockingPage
            initialRequestId={openRestockId}
            onRequestConsumed={() => setOpenRestockId(null)}
            onBadgeRefresh={loadUnreadCount}
          />
        );
      case '/admin/orders':
        return <AdminOrdersView onTrackOrder={openTrackOrder} />;
      case '/admin/track-order':
        return trackingOrderId ? (
          <TrackOrderView
            orderId={trackingOrderId}
            onBack={() => navigateTo('/admin/orders')}
          />
        ) : (
          <AdminOrdersView onTrackOrder={openTrackOrder} />
        );
      case '/admin/commissions':
        return <CommissionsManagementView />;
      case '/admin/chatbot-faqs':
        return <ChatbotFaqsView />;
      case '/admin/reports':
        return <ReportsAndLogsView />;
      case '/admin/store-map':
        return <StoreMapView user={user} />;
      case '/admin/notifications':
        return (
          <NotificationsView
            role={user.role}
            onUnreadChange={loadUnreadCount}
            onNavigate={navigateTo}
          />
        );

      // Agent routes
      case '/agent/dashboard':
        return <AgentRecruitsView onNavigate={navigateTo} />;
      case '/agent/register-franchisee':
        return <RegisterFranchiseeView />;
      case '/agent/promotions':
        return <AgentPromotionsView />;
      case '/agent/commissions':
        return <AgentCommissionsView />;
      case '/agent/store-map':
        return <StoreMapView user={user} />;
      case '/agent/notifications':
        return (
          <NotificationsView
            role={user.role}
            onUnreadChange={loadUnreadCount}
            onNavigate={navigateTo}
          />
        );

      // Franchisee routes
      case '/franchisee/dashboard':
        return (
          <FranchiseeDashboard
            user={user}
            onNavigate={navigateTo}
            onTrackOrder={openTrackOrder}
          />
        );
      case '/franchisee/catalog':
      case '/franchisee/order':
        return <CatalogAndCartView onTrackOrder={openTrackOrder} />;
      case '/franchisee/orders':
        return <FranchiseeOrdersView onTrackOrder={openTrackOrder} />;
      case '/franchisee/track-order':
        return trackingOrderId ? (
          <TrackOrderView
            orderId={trackingOrderId}
            onBack={() => navigateTo('/franchisee/orders')}
          />
        ) : (
          <FranchiseeOrdersView onTrackOrder={openTrackOrder} />
        );
      case '/franchisee/store-map':
        return <StoreMapView user={user} />;
      case '/franchisee/notifications':
        return (
          <NotificationsView
            role={user.role}
            onUnreadChange={loadUnreadCount}
            onNavigate={navigateTo}
          />
        );
      case '/franchisee/profile':
        return (
          <FranchiseeProfileView
            user={user}
            onProfileUpdated={refreshSession}
          />
        );

      // Delivery Staff routes
      case '/delivery/dashboard':
        return <DeliveryAssignedView />;
      case '/delivery/history':
        return <DeliveryHistoryView />;
      case '/delivery/store-map':
        return <StoreMapView user={user} />;
      case '/delivery/notifications':
        return (
          <NotificationsView
            role={user.role}
            onUnreadChange={loadUnreadCount}
            onNavigate={navigateTo}
          />
        );

      default:
        return <StoreMapView user={user} />;
    }
  };

  return (
    <div className="h-screen overflow-hidden flex bg-slate-50 text-slate-900">
      {/* Role-Specific Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 h-screen shrink-0 bg-slate-900 text-slate-100 flex flex-col justify-between overflow-hidden transition-transform lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="p-4 pb-3 border-b border-slate-800 flex items-center justify-between shrink-0">
            <div>
              <div className="text-base font-bold tracking-tight text-white">
                AICE Franchisee Hub
              </div>
              <div className="text-xs text-slate-400">
                {formatRoleDisplayLabel(user.role)} Workspace
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden text-xs text-slate-400 hover:text-white"
            >
              Close
            </button>
          </div>

          <nav
            aria-label="Role Navigation"
            className="flex-1 overflow-y-auto p-4 space-y-1"
          >
            {navItems.map((item) => {
              const isLocked = !hasWarehouse && item.path !== '/admin/warehouses';
              const isActive = normalizedSidebarRoute === item.path;
              const rawBadgeCount = getSidebarBadgeCount(
                user.role,
                item.path,
                notificationSummary
              );
              const badgeLabel = formatBadgeCount(rawBadgeCount);

              return (
                <button
                  key={item.path}
                  type="button"
                  disabled={isLocked}
                  onClick={() => {
                    setQrNoticeMessage('');
                    navigateTo(item.path);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-between gap-2 whitespace-nowrap ${
                    isActive
                      ? 'bg-rose-600 text-white font-semibold'
                      : isLocked
                      ? 'text-slate-600 cursor-not-allowed'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  {badgeLabel && (
                    <span
                      data-testid={`sidebar-badge-${item.path}`}
                      className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold leading-none shrink-0 ${
                        isActive
                          ? 'bg-white text-rose-600'
                          : 'bg-rose-600 text-white'
                      }`}
                    >
                      {badgeLabel}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div
          data-testid="sidebar-user-footer"
          className="p-4 border-t border-slate-800 space-y-1.5 shrink-0"
        >
          <div
            data-testid="sidebar-user-name"
            className="text-xs font-semibold text-white truncate"
          >
            {formatSidebarUserFooter(user).primaryName}
          </div>
          <div
            data-testid="sidebar-user-role-or-store"
            className="text-[11px] text-slate-400 truncate"
          >
            {formatSidebarUserFooter(user).secondaryLabel}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full mt-1 py-1.5 px-3 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8 shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden px-2.5 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700"
            >
              Menu
            </button>
            <div className="text-xs text-slate-500 whitespace-nowrap">
              <span>{formatRoleDisplayLabel(user.role)}</span> /{' '}
              <strong className="text-slate-900 font-semibold">{activeNavLabel}</strong>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:block text-right">
              <div className="text-xs font-semibold text-slate-900 leading-tight">
                {formatSidebarUserFooter(user).primaryName}
              </div>
              <div className="text-[11px] text-slate-500 leading-tight">
                {formatSidebarUserFooter(user).secondaryLabel}
              </div>
            </div>
            <NotificationBellDropdown
              role={user.role}
              unreadTotal={unreadCount}
              disabled={!hasWarehouse}
              onSummaryRefresh={loadUnreadCount}
              onNavigate={navigateTo}
            />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl w-full mx-auto space-y-4">
            {qrNoticeMessage && (
              <div
                role="alert"
                data-testid="qr-role-notice-banner"
                className="p-4 rounded-xl border-2 border-amber-300 bg-amber-50 flex items-center justify-between gap-3"
              >
                <div className="text-sm font-bold text-amber-950">
                  {qrNoticeMessage}
                </div>
                <button
                  type="button"
                  onClick={() => setQrNoticeMessage('')}
                  className="text-xs font-semibold text-amber-900 hover:underline"
                >
                  Dismiss
                </button>
              </div>
            )}
            {renderMainContent()}
          </div>
        </main>
      </div>

      {/* Post-Login Franchisee Promo Popup Modal (once per login session) */}
      {user.role === 'franchisee' && hasWarehouse && !user.must_change_password && (
        <FranchiseePromoPopupModal
          userId={user.id}
          hasWarehouse={hasWarehouse}
          onShopNow={() => navigateTo('/franchisee/catalog')}
        />
      )}
    </div>
  );
}
