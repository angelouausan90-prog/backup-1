import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { Download, Printer, QrCode, ShoppingCart } from 'lucide-react';
import {
  buildFranchiseeOrderQrUrl,
  buildStorePosterQrUrl,
} from '../utils/domainRules';

const DEFAULT_ENV_BASE_URL =
  typeof import.meta !== 'undefined' && (import.meta as any).env
    ? String(
        (import.meta as any).env.VITE_APP_BASE_URL ||
          (import.meta as any).env.APP_BASE_URL ||
          ''
      ).trim()
    : '';

export async function generateQrCodeDataUrl(
  targetUrl: string,
  width = 360
): Promise<string> {
  return QRCode.toDataURL(targetUrl, {
    width,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: {
      dark: '#14532D', // Deep AICE green for high contrast scanning
      light: '#FFFFFF',
    },
  });
}

export async function downloadFranchiseeQrPng(
  targetUrl: string,
  filename = 'AICE-Franchisee-Ordering-QR.png'
): Promise<void> {
  const dataUrl = await generateQrCodeDataUrl(targetUrl, 800);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function printFranchiseeQrPosterPdf(options: {
  qrUrl: string;
  storeName?: string | null;
  storeCode?: string | null;
}): Promise<void> {
  const qrDataUrl = await generateQrCodeDataUrl(options.qrUrl, 900);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Top AICE Red Header Banner
  doc.setFillColor(220, 38, 38); // #DC2626
  doc.rect(0, 0, 210, 44, 'F');

  // Deep AICE Green Accent Strip
  doc.setFillColor(22, 163, 74); // #16A34A
  doc.rect(0, 44, 210, 8, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text('AICE FRANCHISEE HUB', 105, 20, { align: 'center' });

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('AICE COTABATO-JCDL CORPORATION · STOCK REPLENISHMENT PORTAL', 105, 31, {
    align: 'center',
  });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('HAVE AN AICE DAY — OFFICIAL FRANCHISEE ORDERING QR POSTER', 105, 39, {
    align: 'center',
  });

  // Main Headline
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('Franchisee? Order stock in seconds', 105, 68, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(71, 85, 105);
  doc.text(
    'Scan the QR code below to log in and re-order or place a new stock order.',
    105,
    77,
    { align: 'center' }
  );

  if (options.storeName || options.storeCode) {
    doc.setFillColor(240, 253, 244); // emerald-50
    doc.setDrawColor(22, 163, 74);
    doc.roundedRect(25, 84, 160, 18, 3, 3, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(20, 83, 45);
    const label = [
      options.storeName ? `Store: ${options.storeName}` : '',
      options.storeCode ? `Code: ${options.storeCode}` : '',
    ]
      .filter(Boolean)
      .join('  ·  ');
    doc.text(label, 105, 95, { align: 'center' });
  }

  // Outer QR Card Frame
  const qrBoxY = options.storeName || options.storeCode ? 108 : 92;
  doc.setDrawColor(220, 38, 38);
  doc.setLineWidth(1.2);
  doc.roundedRect(45, qrBoxY, 120, 125, 5, 5, 'S');

  doc.addImage(qrDataUrl, 'PNG', 55, qrBoxY + 7, 100, 100);

  doc.setFont('courier', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(20, 83, 45);
  doc.text(options.qrUrl, 105, qrBoxY + 116, {
    align: 'center',
    maxWidth: 112,
  });

  // 3 Steps Box at the bottom
  const stepsY = qrBoxY + 135;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.roundedRect(20, stepsY, 170, 36, 3, 3, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(220, 38, 38);
  doc.text('HOW TO REPLENISH YOUR FREEZER STOCK:', 27, stepsY + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text(
    '1. Open your phone camera and scan this QR code.',
    27,
    stepsY + 17
  );
  doc.text(
    '2. Log in with your assigned AICE franchisee account credentials.',
    27,
    stepsY + 24
  );
  doc.text(
    '3. Choose 1-Click Re-order from a previous delivery or Direct Order from the catalog.',
    27,
    stepsY + 31
  );

  // Footer strip
  doc.setFillColor(20, 83, 45);
  doc.rect(0, 282, 210, 15, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(
    'Official AICE Franchisee Replenishment QR Poster · Keep posted near your store freezer',
    105,
    291,
    { align: 'center' }
  );

  const safeCode = options.storeCode
    ? `-${String(options.storeCode).replace(/[^a-zA-Z0-9_-]/g, '')}`
    : '';
  doc.save(`AICE-Franchisee-QR-Poster${safeCode}.pdf`);
}

interface LandingFranchiseeQrSectionProps {
  appBaseUrl?: string;
  onOrderNowClick: () => void;
  isAdmin?: boolean;
}

/**
 * Public Landing Page Section:
 * "Franchisee? Order stock in seconds"
 * - Shows QR code on the left (desktop) / top (mobile) and "Franchisee Login / Order Now" button beside it.
 * - Uses AICE green and red branding in the same crisp style as the rest of the landing page.
 * - Shows "Download QR" and "Print poster" under the QR ONLY when isAdmin is true (public visitors only see the QR and button).
 */
export const LandingFranchiseeQrSection: React.FC<LandingFranchiseeQrSectionProps> = ({
  appBaseUrl,
  onOrderNowClick,
  isAdmin = false,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const resolvedBase =
    (appBaseUrl && appBaseUrl.trim()) ||
    DEFAULT_ENV_BASE_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '');
  const targetQrUrl = buildFranchiseeOrderQrUrl(resolvedBase);

  useEffect(() => {
    let mounted = true;
    generateQrCodeDataUrl(targetQrUrl, 340)
      .then((url) => {
        if (mounted) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [targetQrUrl]);

  return (
    <section
      id="franchisee-qr"
      data-testid="landing-franchisee-qr-section"
      className="aice-reveal-section transition-all duration-200 ease-out py-14 lg:py-16 bg-white border-b border-slate-200"
    >
      <div className="max-w-7xl mx-auto px-6">
        <div className="rounded-2xl border-2 border-emerald-700/20 bg-gradient-to-br from-emerald-900 via-emerald-800 to-rose-900 text-white p-6 sm:p-8 lg:p-10 shadow-xl">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            {/* Left / Top: QR Code Card */}
            <div className="lg:col-span-4 flex flex-col items-center">
              <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-lg border-4 border-rose-600 flex flex-col items-center space-y-2.5 w-full max-w-[260px]">
                <div className="w-full flex items-center justify-between text-[11px] font-bold tracking-wider uppercase text-emerald-900 border-b border-slate-100 pb-1.5">
                  <span className="flex items-center gap-1">
                    <QrCode className="w-3.5 h-3.5 text-rose-600" />
                    AICE Instant Order
                  </span>
                  <span className="text-rose-600 font-mono">SCAN ME</span>
                </div>

                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Franchisee Stock Ordering QR Code"
                    data-testid="landing-franchisee-qr-img"
                    data-qr-value={targetQrUrl}
                    className="w-48 h-48 sm:w-52 sm:h-52 object-contain rounded-lg"
                  />
                ) : (
                  <div
                    data-testid="landing-franchisee-qr-loading"
                    className="w-48 h-48 sm:w-52 sm:h-52 flex items-center justify-center bg-slate-50 text-xs text-slate-500 rounded-lg"
                  >
                    Generating QR...
                  </div>
                )}

                <div className="text-[11px] font-mono text-slate-600 text-center break-all px-1">
                  /franchisee/order
                </div>
              </div>

              {/* Admin-only controls under the QR code */}
              {isAdmin && (
                <div
                  data-testid="landing-admin-qr-actions"
                  className="mt-3 flex flex-wrap items-center justify-center gap-2"
                >
                  <button
                    type="button"
                    onClick={() => downloadFranchiseeQrPng(targetQrUrl)}
                    className="px-3 py-1.5 rounded-lg bg-white text-emerald-900 text-xs font-bold hover:bg-emerald-50 flex items-center gap-1.5 shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5 text-rose-600" />
                    Download QR
                  </button>
                  <button
                    type="button"
                    onClick={() => printFranchiseeQrPosterPdf({ qrUrl: targetQrUrl })}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 flex items-center gap-1.5 shadow-sm"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print poster
                  </button>
                </div>
              )}
            </div>

            {/* Right / Bottom: Headline, explanation, and "Franchisee Login / Order Now" CTA */}
            <div className="lg:col-span-8 space-y-5 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-200">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                AICE Fast Stock Replenishment
              </div>

              <h2
                className="font-display text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight"
                style={{ textWrap: 'balance' } as React.CSSProperties}
              >
                Franchisee? Order stock in seconds
              </h2>

              <p className="text-sm sm:text-base text-emerald-50/95 max-w-2xl mx-auto lg:mx-0 leading-relaxed">
                Scan the QR code or tap the button to log in and re-order or place a new stock order.
              </p>

              <div className="pt-1 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
                <button
                  type="button"
                  data-testid="landing-franchisee-order-btn"
                  onClick={onOrderNowClick}
                  className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold transition-colors shadow-lg flex items-center justify-center gap-2.5 border border-rose-400/40"
                >
                  <ShoppingCart className="w-4 h-4 shrink-0" />
                  <span>Franchisee Login / Order Now</span>
                </button>
              </div>

              <div className="pt-3 border-t border-white/15 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left text-xs text-emerald-100/90">
                <div>
                  <strong className="text-white block">1. Scan or Tap</strong>
                  Opens your store&apos;s ordering route directly on your phone or browser.
                </div>
                <div>
                  <strong className="text-white block">2. Quick Re-order</strong>
                  Repeat your previous ice cream carton replenishment in one tap.
                </div>
                <div>
                  <strong className="text-white block">3. Direct Catalog Order</strong>
                  Pick live warehouse flavors with automatic promo discounts applied.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

/**
 * Admin-only QR Sticker & Poster Toolbar Card:
 * Lets the Admin download the high-res PNG QR or print the A4 flyer/sticker poster for {APP_BASE_URL}/franchisee/order,
 * or generate a per-store poster for /qr/{store_code}.
 */
export const AdminQrPosterCard: React.FC<{
  appBaseUrl?: string;
  stores?: { id: number; store_name: string; application_no?: string | null }[];
}> = ({ appBaseUrl, stores = [] }) => {
  const [baseUrl, setBaseUrl] = useState<string>(
    appBaseUrl ||
      DEFAULT_ENV_BASE_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '')
  );
  const [selectedStoreCode, setSelectedStoreCode] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    if (appBaseUrl) {
      setBaseUrl(appBaseUrl);
      return;
    }
    fetch('/api/public/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.app_base_url) {
          setBaseUrl(data.app_base_url);
        }
      })
      .catch(() => {});
  }, [appBaseUrl]);

  const activeQrUrl = selectedStoreCode
    ? buildStorePosterQrUrl(baseUrl, selectedStoreCode)
    : buildFranchiseeOrderQrUrl(baseUrl);

  const selectedStoreObj = stores.find(
    (s) => (s.application_no || `STORE-${s.id}`) === selectedStoreCode
  );

  useEffect(() => {
    let mounted = true;
    generateQrCodeDataUrl(activeQrUrl, 320)
      .then((url) => {
        if (mounted) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [activeQrUrl]);

  return (
    <div
      data-testid="admin-qr-poster-card"
      className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-800">
            <QrCode className="w-4 h-4 text-rose-600" />
            Admin Sticker &amp; Flyer Generator
          </div>
          <h2 className="text-base font-bold text-slate-900">
            Franchisee Ordering QR Code — Download &amp; Print Poster
          </h2>
          <p className="text-xs text-slate-600 max-w-2xl">
            Print official AICE QR stickers or posters for franchisees. Scanning the landing page QR (
            <code className="font-mono text-slate-800">/franchisee/order</code>) or a store poster QR (
            <code className="font-mono text-slate-800">/qr/&#123;store_code&#125;</code>) directs the logged-in active franchisee straight to their own replenishment ordering page.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="admin-download-qr-btn"
            onClick={() =>
              downloadFranchiseeQrPng(
                activeQrUrl,
                selectedStoreCode
                  ? `AICE-Store-QR-${selectedStoreCode}.png`
                  : 'AICE-Franchisee-Ordering-QR.png'
              )
            }
            className="px-3.5 py-2 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Download QR
          </button>
          <button
            type="button"
            data-testid="admin-print-poster-btn"
            onClick={() =>
              printFranchiseeQrPosterPdf({
                qrUrl: activeQrUrl,
                storeName: selectedStoreObj?.store_name || null,
                storeCode: selectedStoreCode || null,
              })
            }
            className="px-3.5 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            Print poster
          </button>
        </div>
      </div>

      <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center gap-5">
        <div className="p-3 rounded-xl border-2 border-rose-600 bg-white shrink-0">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="Admin Franchisee Ordering QR Preview"
              data-testid="admin-qr-preview-img"
              data-qr-value={activeQrUrl}
              className="w-32 h-32 object-contain"
            />
          ) : (
            <div className="w-32 h-32 flex items-center justify-center text-xs text-slate-400">
              Loading QR...
            </div>
          )}
        </div>

        <div className="flex-1 space-y-3 w-full">
          <div>
            <div className="text-xs font-semibold text-slate-700">Encoded QR Target URL</div>
            <div
              data-testid="admin-qr-encoded-url"
              className="mt-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 font-mono text-xs text-emerald-900 break-all"
            >
              {activeQrUrl}
            </div>
          </div>

          {stores.length > 0 && (
            <div className="max-w-sm">
              <label
                htmlFor="admin-qr-store-select"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                QR Mode (General Landing QR vs. Per-Store Poster QR):
              </label>
              <select
                id="admin-qr-store-select"
                value={selectedStoreCode}
                onChange={(e) => setSelectedStoreCode(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-medium"
              >
                <option value="">General Franchisee QR (/franchisee/order)</option>
                {stores.map((s) => {
                  const code = s.application_no || `STORE-${s.id}`;
                  return (
                    <option key={s.id} value={code}>
                      {s.store_name} (/qr/{code})
                    </option>
                  );
                })}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
