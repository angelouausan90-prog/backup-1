import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { ChevronDown, MapPin } from 'lucide-react';
import {
  PublicProductItem,
  PublicPromoItem,
  PublicStoreItem,
} from '../../utils/domainRules';
import { PublicChatbotWidget } from '../../components/PublicChatbotWidget';

interface PublicFaqItem {
  id: number;
  question: string;
  answer: string;
}

interface PublicSettingsData {
  show_public_prices: boolean;
  contact_email: string;
  contact_phone: string;
}

interface PublicLandingPageProps {
  onLoginClick: () => void;
}

// Create a custom purple SVG marker icon for the public store locator map
const createPublicStoreIcon = () =>
  L.divIcon({
    className: 'aice-public-store-pin',
    html: `<div style="width:28px;height:28px;border-radius:9999px;background:#23084E;border:3px solid #F59E0B;box-shadow:0 4px 10px rgba(35,8,78,0.35);display:flex;align-items:center;justify-content:center;">
      <div style="width:8px;height:8px;border-radius:9999px;background:#FFFFFF;"></div>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });

export const PublicLandingPage: React.FC<PublicLandingPageProps> = ({
  onLoginClick,
}) => {
  const [products, setProducts] = useState<PublicProductItem[]>([]);
  const [showPrices, setShowPrices] = useState(false);
  const [stores, setStores] = useState<PublicStoreItem[]>([]);
  const [promos, setPromos] = useState<PublicPromoItem[]>([]);
  const [faqs, setFaqs] = useState<PublicFaqItem[]>([]);
  const [settings, setSettings] = useState<PublicSettingsData>({
    show_public_prices: false,
    contact_email: 'franchising@aicehub.local',
    contact_phone: '+63 (02) 8888-2423',
  });
  const [loadingData, setLoadingData] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [openFaqId, setOpenFaqId] = useState<number | null>(null);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersByIdRef = useRef<Record<number, L.Marker>>({});

  useEffect(() => {
    let active = true;

    Promise.all([
      fetch('/api/public/products').then((r) => (r.ok ? r.json() : { data: [], show_prices: false })),
      fetch('/api/public/stores').then((r) => (r.ok ? r.json() : { data: [] })),
      fetch('/api/public/promos').then((r) => (r.ok ? r.json() : { data: [] })),
      fetch('/api/public/faqs').then((r) => (r.ok ? r.json() : { data: [] })),
      fetch('/api/public/settings').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([prodRes, storeRes, promoRes, faqRes, settingsRes]) => {
        if (!active) return;
        const prodList = Array.isArray(prodRes?.data) ? prodRes.data : [];
        const storeList = Array.isArray(storeRes?.data) ? storeRes.data : [];
        const promoList = Array.isArray(promoRes?.data) ? promoRes.data : [];
        const faqList = Array.isArray(faqRes?.data) ? faqRes.data : [];

        setProducts(prodList);
        setShowPrices(Boolean(prodRes?.show_prices));
        setStores(storeList);
        setPromos(promoList);
        setFaqs(faqList);
        if (faqList.length > 0) {
          setOpenFaqId(faqList[0].id);
        }
        if (settingsRes) {
          setSettings({
            show_public_prices: Boolean(settingsRes.show_public_prices),
            contact_email: settingsRes.contact_email || 'franchising@aicehub.local',
            contact_phone: settingsRes.contact_phone || '+63 (02) 8888-2423',
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingData(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Subtle fade-in on scroll using IntersectionObserver (compositor-only opacity & transform)
  useEffect(() => {
    const elements = document.querySelectorAll('.aice-reveal-section');
    if (typeof IntersectionObserver === 'undefined') {
      elements.forEach((el) => el.classList.remove('opacity-0', 'translate-y-3'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.remove('opacity-0', 'translate-y-3');
            entry.target.classList.add('opacity-100', 'translate-y-0');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08 }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [loadingData, promos.length]);

  // Initialize Leaflet + OpenStreetMap store locator map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const defaultCenter: [number, number] =
        stores.length > 0
          ? [Number(stores[0].lat) || 14.6042, Number(stores[0].lng) || 120.9921]
          : [14.5995, 120.9842];

      const map = L.map(mapContainerRef.current, {
        center: defaultCenter,
        zoom: 12,
        scrollWheelZoom: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;
    // Clear existing markers
    Object.values(markersByIdRef.current).forEach((m) => m.remove());
    markersByIdRef.current = {};

    if (stores.length > 0) {
      const icon = createPublicStoreIcon();
      const bounds = L.latLngBounds([]);

      stores.forEach((s) => {
        const lat = Number(s.lat);
        const lng = Number(s.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const marker = L.marker([lat, lng], { icon }).addTo(map);
        const popupEl = document.createElement('div');
        popupEl.style.fontFamily = "'Plus Jakarta Sans', sans-serif";
        const titleEl = document.createElement('div');
        titleEl.style.fontWeight = '700';
        titleEl.style.fontSize = '13px';
        titleEl.style.color = '#1B063E';
        titleEl.textContent = s.store_name;

        const areaEl = document.createElement('div');
        areaEl.style.fontSize = '12px';
        areaEl.style.color = '#475569';
        areaEl.style.marginTop = '2px';
        areaEl.textContent = s.area;

        popupEl.appendChild(titleEl);
        popupEl.appendChild(areaEl);
        marker.bindPopup(popupEl);

        markersByIdRef.current[s.id] = marker;
        bounds.extend([lat, lng]);
      });

      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [44, 44], maxZoom: 14 });
      }
    }

    setTimeout(() => {
      map.invalidateSize();
    }, 150);
  }, [stores]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const focusStoreOnMap = (store: PublicStoreItem) => {
    setSelectedStoreId(store.id);
    const map = mapInstanceRef.current;
    const marker = markersByIdRef.current[store.id];
    if (map && marker) {
      map.setView([store.lat, store.lng], 15, { animate: true });
      marker.openPopup();
    }
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const categories = Array.from(
    new Set(products.map((p) => p.category).filter(Boolean))
  );
  const visibleProducts =
    selectedCategory === 'ALL'
      ? products
      : products.filter((p) => p.category === selectedCategory);

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFC] text-slate-900 selection:bg-amber-400 selection:text-[#1B063E]">
      {/* 1. STICKY NAVBAR (Strict 3-Zone Top Bar Contract, No Sign-Up Button Anywhere) */}
      <header className="sticky top-0 z-[1000] bg-[#1B063E]/95 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            AICE Franchisee Hub
          </a>

          {/* Zone 2: 5 Single-Line Navigation Links */}
          <nav
            aria-label="Primary Navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-purple-100/90"
          >
            <a
              href="#how-it-works"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('how-it-works');
              }}
              className="hover:text-amber-300 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              How it works
            </a>
            <a
              href="#products"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('products');
              }}
              className="hover:text-amber-300 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Products
            </a>
            <a
              href="#stores"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('stores');
              }}
              className="hover:text-amber-300 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Stores
            </a>
            <a
              href="#faq"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('faq');
              }}
              className="hover:text-amber-300 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              FAQ
            </a>
            <a
              href="#contact"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('contact');
              }}
              className="hover:text-amber-300 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Contact
            </a>
          </nav>

          {/* Zone 3: 1 Primary Action (Login button only — no sign-up anywhere) */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onLoginClick}
              className="px-5 py-2 rounded-lg bg-amber-400 text-[#1B063E] text-xs font-bold hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 shadow-sm"
            >
              Login
            </button>
          </div>
        </div>
      </header>

      {/* 2. HERO SECTION (Uses /images/aice-logo-cover.jpg as background) */}
      <section
        id="top"
        className="relative overflow-hidden bg-[#1B063E] text-white"
      >
        <img
          src="/images/aice-logo-cover.jpg"
          alt="Aice — Have an Aice day cover backdrop"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover object-center opacity-40"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-[#170436]/95 via-[#23084E]/85 to-[#23084E]/60"
        />

        <div className="relative max-w-7xl mx-auto px-6 py-20 lg:py-28 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 space-y-6">
            <p className="text-sm font-semibold tracking-wide text-amber-300">
              Have an Aice day
            </p>
            <h1
              className="font-display text-4xl sm:text-5xl lg:text-[3.5rem] font-extrabold tracking-tight text-white leading-[1.08]"
              style={{ textWrap: 'balance' } as React.CSSProperties}
            >
              Order stock online. Track every delivery.
            </h1>
            <p className="text-base sm:text-lg text-purple-100/90 max-w-2xl leading-relaxed">
              The dedicated stock-replenishment and cold-chain dispatch platform for accredited AICE franchise stores, field agents, warehouse administrators, and delivery riders.
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={onLoginClick}
                className="px-6 py-3 rounded-lg bg-amber-400 text-[#1B063E] text-sm font-bold hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 shadow-md"
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('how-it-works')}
                className="px-6 py-3 rounded-lg border border-white/25 bg-white/10 text-white text-sm font-semibold hover:bg-white/15 transition-colors whitespace-nowrap shrink-0"
              >
                How it works
              </button>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="rounded-2xl border border-white/15 bg-[#280A5A]/80 backdrop-blur-sm p-6 space-y-5 shadow-2xl">
              <div className="border-b border-white/10 pb-4">
                <div className="text-xs font-medium text-amber-300">
                  Franchise Replenishment Network
                </div>
                <div className="mt-1 font-display text-xl font-bold text-white">
                  Direct Warehouse-to-Freezer Dispatch
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
                  <dt className="text-xs text-purple-200/80">Active Catalog SKUs</dt>
                  <dd className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">
                    {products.length}
                  </dd>
                </div>
                <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
                  <dt className="text-xs text-purple-200/80">Approved Store Pins</dt>
                  <dd className="mt-1 font-mono text-2xl font-bold text-amber-300 tabular-nums">
                    {stores.length}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-purple-200/80 leading-relaxed">
                Replaces manual telephone stock ordering with live warehouse carton availability, automatic checkout promotions, and real-time GPS route visibility.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. HOW IT WORKS (3 Steps) */}
      <section
        id="how-it-works"
        className="aice-reveal-section transition-all duration-200 ease-out py-16 lg:py-20 bg-white border-b border-slate-200"
      >
        <div className="max-w-7xl mx-auto px-6 space-y-10">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-semibold text-[#2E0B66]">
              Replenishment Workflow
            </p>
            <h2
              className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight"
              style={{ textWrap: 'balance' } as React.CSSProperties}
            >
              Three steps from online stock reservation to store freezer delivery
            </h2>
            <p className="text-sm text-slate-600">
              Every order moves through a structured, auditable pipeline connecting the franchise store, origin warehouse, and assigned delivery rider.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-xl border border-slate-200 bg-[#FAFAFC] p-6 space-y-3">
              <div className="font-mono text-xs font-bold text-[#2E0B66]">
                Step 01
              </div>
              <h3 className="font-display text-lg font-bold text-slate-900">
                01. Reserve stock online
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Approved franchisees sign in, select an origin warehouse, add AICE cartons to their replenishment cart, and submit their preferred delivery schedule online with automatic promotional discounts applied at checkout.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-[#FAFAFC] p-6 space-y-3">
              <div className="font-mono text-xs font-bold text-[#2E0B66]">
                Step 02
              </div>
              <h3 className="font-display text-lg font-bold text-slate-900">
                02. Admin confirms
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Warehouse administrators verify carton stock availability, confirm the reservation to deduct inventory from the origin warehouse, and assign an active delivery rider for dispatch.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-[#FAFAFC] p-6 space-y-3">
              <div className="font-mono text-xs font-bold text-[#2E0B66]">
                Step 03
              </div>
              <h3 className="font-display text-lg font-bold text-slate-900">
                03. Rider delivers with live tracking
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Delivery staff pick up the order, broadcast live GPS coordinates on the route map, alert the store when nearby, and upload proof of delivery upon arrival.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. FEATURES BY ROLE (Cards for Franchisee, Agent, Admin, Delivery Staff) */}
      <section className="aice-reveal-section transition-all duration-200 ease-out py-16 lg:py-20 bg-[#FAFAFC]">
        <div className="max-w-7xl mx-auto px-6 space-y-10">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-semibold text-[#2E0B66]">
              Role-Based Workspaces
            </p>
            <h2
              className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight"
              style={{ textWrap: 'balance' } as React.CSSProperties}
            >
              Built for every role in the AICE distribution network
            </h2>
            <p className="text-sm text-slate-600">
              Each account signs in to a dedicated workspace with strict role-based permissions tailored to its daily responsibilities.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
              <div className="text-xs font-semibold text-[#2E0B66]">
                Store Operations
              </div>
              <h3 className="font-display text-lg font-bold text-slate-900">
                Franchisee
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Browse active warehouse stock, receive automatic volume and bundle discounts in the cart, schedule replenishment deliveries, and track assigned riders live on an interactive map.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
              <div className="text-xs font-semibold text-[#2E0B66]">
                Field Expansion
              </div>
              <h3 className="font-display text-lg font-bold text-slate-900">
                Agent
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Register new franchisee applicants on-site with pinned store coordinates, monitor Admin approval decisions, view active network promotions, and track earned recruitment commissions.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
              <div className="text-xs font-semibold text-[#2E0B66]">
                Network Control
              </div>
              <h3 className="font-display text-lg font-bold text-slate-900">
                Admin
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Manage origin warehouses, approve pending franchisees, control SKU stock-in and low-stock thresholds, configure promotions, analyze demand forecasts, and confirm replenishment orders.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
              <div className="text-xs font-semibold text-[#2E0B66]">
                Cold-Chain Logistics
              </div>
              <h3 className="font-display text-lg font-bold text-slate-900">
                Delivery Staff
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                View assigned warehouse dispatches, update pickup and transit milestones, share live GPS location updates, send nearby store alerts, and record proof of delivery.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* PRODUCT BANNER SECTION DIVIDER STRIP (Uses /images/aice-product-banner.jpg) */}
      <div
        aria-label="Aice Ice Cream Product Lineup Divider"
        className="w-full bg-[#23084E] border-y border-purple-900/40 overflow-hidden"
      >
        <img
          src="/images/aice-product-banner.jpg"
          alt="Aice ice cream cones, mochi, and chocolate bars banner"
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-full h-36 sm:h-48 lg:h-56 object-cover object-center block"
        />
      </div>

      {/* 5. PRODUCTS GRID (From /api/public/products with real images & empty state) */}
      <section
        id="products"
        className="aice-reveal-section transition-all duration-200 ease-out py-16 lg:py-20 bg-white border-b border-slate-200"
      >
        <div className="max-w-7xl mx-auto px-6 space-y-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl space-y-2">
              <p className="text-xs font-semibold text-[#2E0B66]">
                AICE Product Catalog
              </p>
              <h2
                className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight"
                style={{ textWrap: 'balance' } as React.CSSProperties}
              >
                Ice cream products available for franchisee replenishment
              </h2>
              <p className="text-sm text-slate-600">
                Live catalog of active AICE flavors and carton packs registered in the franchise system.
              </p>
            </div>

            {categories.length > 1 && (
              <div
                role="tablist"
                aria-label="Filter products by category"
                className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg"
              >
                <button
                  type="button"
                  onClick={() => setSelectedCategory('ALL')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    selectedCategory === 'ALL'
                      ? 'bg-[#23084E] text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All ({products.length})
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      selectedCategory === cat
                        ? 'bg-[#23084E] text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {loadingData ? (
            <div className="p-10 rounded-xl border border-slate-200 bg-[#FAFAFC] text-center text-sm text-slate-500">
              Loading active products from catalog...
            </div>
          ) : visibleProducts.length === 0 ? (
            <div
              data-testid="public-products-empty"
              className="p-10 rounded-xl border border-slate-200 bg-[#FAFAFC] text-center space-y-2"
            >
              <div className="font-display text-base font-bold text-slate-900">
                No active products in the public catalog yet
              </div>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                Products appear here automatically as soon as the warehouse administrator adds active AICE catalog items.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {visibleProducts.map((p) => {
                const hasImage = Boolean(p.image_url) && !failedImages[p.id];
                return (
                  <article
                    key={p.id}
                    className="rounded-xl border border-slate-200 bg-[#FAFAFC] overflow-hidden flex flex-col justify-between"
                  >
                    <div>
                      <div className="aspect-[4/3] w-full bg-[#23084E]/5 border-b border-slate-200 flex items-center justify-center overflow-hidden">
                        {hasImage ? (
                          <img
                            src={p.image_url!}
                            alt={`${p.name} — ${p.flavor}`}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setFailedImages((prev) => ({ ...prev, [p.id]: true }))
                            }
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-[#23084E] to-[#3B0F82] p-4 flex flex-col items-center justify-center text-center">
                            <span className="font-display text-sm font-bold text-amber-300">
                              AICE
                            </span>
                            <span className="mt-1 text-xs text-purple-100 font-medium line-clamp-2">
                              {p.name}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="p-4 space-y-1.5">
                        {/* Unboxed metadata with typographic separators (Zero-Pill Rule) */}
                        <div className="text-xs text-slate-500 truncate">
                          <span>{p.category}</span>
                          {p.flavor ? (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span>{p.flavor}</span>
                            </>
                          ) : null}
                          {p.size ? (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span>{p.size}</span>
                            </>
                          ) : null}
                        </div>

                        <h3 className="font-display text-base font-bold text-slate-900">
                          {p.name}
                        </h3>
                      </div>
                    </div>

                    {showPrices && typeof p.price === 'number' && (
                      <div className="px-4 pb-4 pt-1 border-t border-slate-200/70 flex items-center justify-between text-xs">
                        <span className="text-slate-500">Carton Price</span>
                        <span className="font-mono font-bold text-[#23084E] tabular-nums">
                          PHP {p.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 6. STORE LOCATOR (Leaflet + OpenStreetMap from /api/public/stores, store name & area only) */}
      <section
        id="stores"
        className="aice-reveal-section transition-all duration-200 ease-out py-16 lg:py-20 bg-[#FAFAFC] border-b border-slate-200"
      >
        <div className="max-w-7xl mx-auto px-6 space-y-8">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-semibold text-[#2E0B66]">
              Approved Franchise Network
            </p>
            <h2
              className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight"
              style={{ textWrap: 'balance' } as React.CSSProperties}
            >
              Accredited AICE franchise store locator
            </h2>
            <p className="text-sm text-slate-600">
              Explore approved AICE retail stores across the network. Only verified store names and general districts/cities are shown publicly.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            <div className="lg:col-span-8 relative z-0 isolate rounded-xl border border-slate-200 bg-white overflow-hidden min-h-[380px]">
              <div
                ref={mapContainerRef}
                aria-label="Approved AICE Stores Map"
                className="w-full h-[380px] lg:h-full min-h-[380px]"
              />
            </div>

            <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white flex flex-col max-h-[440px]">
              <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">
                  Approved Stores
                </span>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {stores.length} store{stores.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                {stores.length === 0 ? (
                  <div className="p-6 text-sm text-slate-500">
                    No approved franchisee stores pinned yet.
                  </div>
                ) : (
                  stores.map((s) => {
                    const isSelected = selectedStoreId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => focusStoreOnMap(s)}
                        className={`w-full text-left px-4 py-3.5 flex items-start gap-3 transition-colors ${
                          isSelected
                            ? 'bg-purple-50/80 text-[#1B063E]'
                            : 'hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        <MapPin className="w-4 h-4 text-[#2E0B66] mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-slate-900 truncate">
                            {s.store_name}
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            {s.area}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. ACTIVE PROMOS TEASER (From /api/public/promos, hidden when empty) */}
      {promos.length > 0 && (
        <section
          data-testid="public-promos-section"
          className="aice-reveal-section transition-all duration-200 ease-out py-16 lg:py-20 bg-[#1B063E] text-white"
        >
          <div className="max-w-7xl mx-auto px-6 space-y-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-2xl space-y-2">
                <p className="text-xs font-semibold text-amber-300">
                  Active Replenishment Promotions
                </p>
                <h2
                  className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight"
                  style={{ textWrap: 'balance' } as React.CSSProperties}
                >
                  Current stock-replenishment deals for approved franchisees
                </h2>
                <p className="text-sm text-purple-100/85">
                  Eligible discounts and free cartons apply automatically when you place a replenishment order.
                </p>
              </div>

              <button
                type="button"
                onClick={onLoginClick}
                className="px-5 py-2.5 rounded-lg bg-amber-400 text-[#1B063E] text-xs font-bold hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0"
              >
                Log in to order
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {promos.map((pr) => (
                <div
                  key={pr.id}
                  className="rounded-xl border border-white/15 bg-[#280A5A]/90 p-6 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="text-xs text-amber-300 font-mono">
                      Valid until {pr.valid_until}
                    </div>
                    <h3 className="font-display text-lg font-bold text-white">
                      {pr.name}
                    </h3>
                    <p className="text-sm text-purple-100/90 leading-relaxed">
                      {pr.short_description}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-white/10">
                    <button
                      type="button"
                      onClick={onLoginClick}
                      className="text-xs font-bold text-amber-300 hover:text-amber-200 hover:underline underline-offset-4 whitespace-nowrap"
                    >
                      Log in to order →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 8. BECOME A FRANCHISEE (Text only, explaining accredited agent onboarding + DB/env contact info, NO form) */}
      <section
        id="contact"
        className="aice-reveal-section transition-all duration-200 ease-out py-16 lg:py-20 bg-white border-b border-slate-200"
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="rounded-2xl border border-slate-200 bg-[#23084E] text-white p-8 sm:p-10 lg:p-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-4">
              <p className="text-xs font-semibold text-amber-300">
                Become a Franchisee
              </p>
              <h2
                className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight"
                style={{ textWrap: 'balance' } as React.CSSProperties}
              >
                Franchise onboarding is conducted exclusively through accredited AICE field agents
              </h2>
              <p className="text-sm sm:text-base text-purple-100/90 leading-relaxed">
                To protect territory spacing and verify freezer readiness, AICE Franchisee Hub does not offer public self sign-up or online application forms. An accredited AICE agent visits your store location, records your owner details, pins your exact store coordinates on the network map, and submits your application for Admin approval.
              </p>
            </div>

            <div className="lg:col-span-5 rounded-xl border border-white/15 bg-white/10 p-6 space-y-4">
              <div className="text-xs font-semibold text-amber-300">
                Request an Accredited Field Agent Visit
              </div>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-xs text-purple-200/80">Franchise Inquiry Email</div>
                  <a
                    href={`mailto:${settings.contact_email}`}
                    data-testid="public-contact-email"
                    className="font-mono font-bold text-white hover:text-amber-300 break-all"
                  >
                    {settings.contact_email}
                  </a>
                </div>
                <div>
                  <div className="text-xs text-purple-200/80">Franchise Desk Telephone</div>
                  <a
                    href={`tel:${settings.contact_phone}`}
                    data-testid="public-contact-phone"
                    className="font-mono font-bold text-amber-300 hover:underline"
                  >
                    {settings.contact_phone}
                  </a>
                </div>
              </div>
              <p className="text-xs text-purple-200/80 leading-relaxed">
                Once your recruiting agent registers your store and the Admin approves your account, you will receive your login credentials to begin ordering stock online.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 9. FAQ ACCORDION (From /api/public/faqs) */}
      <section
        id="faq"
        className="aice-reveal-section transition-all duration-200 ease-out py-16 lg:py-20 bg-[#FAFAFC]"
      >
        <div className="max-w-4xl mx-auto px-6 space-y-8">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#2E0B66]">
              Frequently Asked Questions
            </p>
            <h2
              className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight"
              style={{ textWrap: 'balance' } as React.CSSProperties}
            >
              Answers about stock replenishment, onboarding, and delivery tracking
            </h2>
          </div>

          {faqs.length === 0 ? (
            <div className="p-6 rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
              No public FAQs available right now.
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-200 overflow-hidden">
              {faqs.map((item) => {
                const isOpen = openFaqId === item.id;
                return (
                  <div key={item.id}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() =>
                        setOpenFaqId((prev) => (prev === item.id ? null : item.id))
                      }
                      className="w-full text-left px-6 py-4 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors"
                    >
                      <span className="font-display text-base font-bold text-slate-900">
                        {item.question}
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-150 ${
                          isOpen ? 'rotate-180 text-[#2E0B66]' : ''
                        }`}
                      />
                    </button>
                    {isOpen && (
                      <div className="px-6 pb-5 pt-1 text-sm text-slate-600 leading-relaxed">
                        {item.answer}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 10. FOOTER (Contact info, Login link, and "Capstone project - not affiliated with Aice") */}
      <footer className="mt-auto bg-[#170436] text-purple-100 border-t border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="font-display text-base font-bold text-white">
              AICE Franchisee Hub
            </div>
            <p className="text-xs text-purple-200/80">
              Capstone project - not affiliated with Aice
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-purple-200/90">
            <span>
              Email:{' '}
              <a
                href={`mailto:${settings.contact_email}`}
                className="font-mono text-white hover:text-amber-300"
              >
                {settings.contact_email}
              </a>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Phone:{' '}
              <a
                href={`tel:${settings.contact_phone}`}
                className="font-mono text-white hover:text-amber-300"
              >
                {settings.contact_phone}
              </a>
            </span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={onLoginClick}
              className="font-bold text-amber-300 hover:text-amber-200 hover:underline underline-offset-4 whitespace-nowrap"
            >
              Login
            </button>
          </div>
        </div>
      </footer>

      {/* PUBLIC LANDING-PAGE HELP CHATBOT (FAQ match first -> optional Gemini AI fallback) */}
      <PublicChatbotWidget
        faqs={faqs}
        contactEmail={settings.contact_email}
        contactPhone={settings.contact_phone}
      />
    </div>
  );
};
