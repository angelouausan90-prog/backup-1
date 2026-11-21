import React, { useEffect, useState } from 'react';
import { api } from './services/api';
import { RoleName, User } from './types';
import { StoreMapView } from './components/StoreMapView';
import { NotificationsView } from './components/NotificationsView';
import { FranchiseePromoPopupModal } from './components/FranchiseePromoPopupModal';
import { NotificationBellDropdown } from './components/NotificationBellDropdown';
import {
  formatBadgeCount,
  getNotificationTypesForRoute,
  getSidebarBadgeCount,
  NotificationSummaryPayload,
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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [hasWarehouse, setHasWarehouse] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [route, setRoute] = useState<string>(() => {
    const p = typeof window !== 'undefined' ? window.location.pathname : '/';
    return p === '/login' ? '/login' : p || '/';
  });
  const [trackingOrderId, setTrackingOrderId] = useState<number | null>(null);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notificationSummary, setNotificationSummary] =
    useState<NotificationSummaryPayload | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // Login form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  // Forced first-login password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);

  const syncRouteWithHistory = (nextPath: string, replace = false) => {
    setRoute(nextPath);
    if (typeof window !== 'undefined' && window.location.pathname !== nextPath) {
      if (replace) {
        window.history.replaceState({}, '', nextPath);
      } else {
        window.history.pushState({}, '', nextPath);
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

  const refreshSession = async () => {
    const token = localStorage.getItem('aice_token');
    if (!token) {
      try {
        const st = await api.get('/system/status');
        setHasWarehouse(Boolean(st.hasWarehouse));
      } catch {
        // ignore
      }
      setUser(null);
      setNotificationSummary(null);
      setUnreadCount(0);
      const currentPath =
        typeof window !== 'undefined' ? window.location.pathname : '/';
      syncRouteWithHistory(currentPath === '/login' ? '/login' : '/', true);
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
        const nextRoute =
          currentPath === '/' ||
          currentPath === '/login' ||
          currentPath === '/change-password' ||
          !currentPath.startsWith(`/${u.role}`)
            ? defaultRouteForRole(u.role, wh)
            : currentPath;
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
      syncRouteWithHistory(currentPath === '/login' ? '/login' : '/', true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshSession();
  }, []);

  // Redirect logged-in users if route ever lands on "/" or "/login"
  useEffect(() => {
    if (!loading && user) {
      if (user.must_change_password && route !== '/change-password') {
        syncRouteWithHistory('/change-password', true);
      } else if (
        !user.must_change_password &&
        (route === '/' || route === '/login' || !route.startsWith(`/${user.role}`))
      ) {
        syncRouteWithHistory(defaultRouteForRole(user.role, hasWarehouse), true);
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
      syncRouteWithHistory(targetPath === '/login' ? '/login' : '/');
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginBusy(true);
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
        syncRouteWithHistory(defaultRouteForRole(u.role, wh), true);
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
        />
      );
    }

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

          {/* TEST ACCOUNTS BOX (from seed_test.sql — easily removable when testing is finished) */}
          <div className="pt-4 border-t border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-slate-800">
                Test accounts (seed_test.sql)
              </h2>
              <span className="text-[11px] font-mono text-slate-500">
                Password: <strong>Test@1234</strong>
              </span>
            </div>
            <div className="space-y-1 text-xs text-slate-600">
              <div className="flex items-center justify-between">
                <span>
                  1. Admin: <code className="font-mono text-slate-900">admin_test</code>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setUsername('admin_test');
                    setPassword('Test@1234');
                  }}
                  className="text-rose-700 font-semibold hover:underline"
                >
                  Fill Admin
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span>
                  2. Agent: <code className="font-mono text-slate-900">agent_test</code>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setUsername('agent_test');
                    setPassword('Test@1234');
                  }}
                  className="text-rose-700 font-semibold hover:underline"
                >
                  Fill Agent
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span>
                  3. Franchisee (Approved):{' '}
                  <code className="font-mono text-slate-900">franchisee_test</code>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setUsername('franchisee_test');
                    setPassword('Test@1234');
                  }}
                  className="text-rose-700 font-semibold hover:underline"
                >
                  Fill Franchisee
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span>
                  4. Franchisee 2 (Pending):{' '}
                  <code className="font-mono text-slate-900">franchisee_pending_test</code>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setUsername('franchisee_pending_test');
                    setPassword('Test@1234');
                  }}
                  className="text-rose-700 font-semibold hover:underline"
                >
                  Fill Pending
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span>
                  5. Delivery Staff:{' '}
                  <code className="font-mono text-slate-900">delivery_test</code>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setUsername('delivery_test');
                    setPassword('Test@1234');
                  }}
                  className="text-rose-700 font-semibold hover:underline"
                >
                  Fill Delivery
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== 2. FORCED FIRST-LOGIN PASSWORD CHANGE SCREEN =====
  if (user.must_change_password) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              First-Login Password Change Required
            </h1>
            <p className="text-xs text-slate-600 mt-1">
              Signed in as <strong className="font-mono">@{user.username}</strong> ({user.role}). You must change your temporary/initial password before accessing any features.
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
  const activeNavLabel =
    navItems.find((n) => n.path === activeRoute)?.label ||
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
        return <AdminDashboard onNavigate={navigateTo} />;
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
        return <InventoryManagementView />;
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
              <div className="text-xs text-slate-400 capitalize">
                {user.role} Workspace
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
              const isActive = activeRoute === item.path;
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
                  onClick={() => navigateTo(item.path)}
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

        <div className="p-4 border-t border-slate-800 space-y-2 shrink-0">
          <div className="text-xs font-semibold text-white truncate">
            {user.full_name}
          </div>
          <div className="text-[11px] font-mono text-slate-400 truncate">
            @{user.username} · {user.role}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full py-1.5 px-3 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-200 hover:bg-slate-700"
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
              <span className="capitalize">{user.role}</span> /{' '}
              <strong className="text-slate-900 font-semibold">{activeNavLabel}</strong>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
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
          <div className="max-w-7xl w-full mx-auto">
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
