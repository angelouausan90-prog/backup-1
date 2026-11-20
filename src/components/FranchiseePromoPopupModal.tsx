import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { formatPromoLimitNote } from '../utils/domainRules';

interface FranchiseePromoPopupModalProps {
  userId: number;
  hasWarehouse: boolean;
  onShopNow: () => void;
}

export const FranchiseePromoPopupModal: React.FC<FranchiseePromoPopupModalProps> = ({
  userId,
  hasWarehouse,
  onShopNow,
}) => {
  const [promos, setPromos] = useState<any[]>([]);
  const [open, setOpen] = useState<boolean>(false);
  const [visible, setVisible] = useState<boolean>(false);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [dismissedIds, setDismissedIds] = useState<Record<number, boolean>>({});
  const primaryBtnRef = useRef<HTMLButtonElement>(null);

  const sessionKey = `aice_promo_popup_shown_${userId}`;

  useEffect(() => {
    if (!userId || !hasWarehouse) return;
    if (sessionStorage.getItem(sessionKey) === '1') {
      return;
    }

    let cancelled = false;
    api
      .get('/promos/popup')
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res?.data) ? res.data : [];
        sessionStorage.setItem(sessionKey, '1');
        if (list.length > 0) {
          setPromos(list);
          setCurrentIndex(0);
          setOpen(true);
          requestAnimationFrame(() => {
            setVisible(true);
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [userId, hasWarehouse, sessionKey]);

  // Move focus into the modal and lock body scroll when open
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = setTimeout(() => {
      primaryBtnRef.current?.focus();
    }, 30);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      } else if (e.key === 'ArrowRight' && promos.length > 1) {
        setCurrentIndex((prev) => (prev + 1) % promos.length);
      } else if (e.key === 'ArrowLeft' && promos.length > 1) {
        setCurrentIndex((prev) => (prev - 1 + promos.length) % promos.length);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, promos.length]);

  const toggleDismissCurrent = async (promoId: number, checked: boolean) => {
    setDismissedIds((prev) => ({ ...prev, [promoId]: checked }));
    try {
      await api.post(`/promos/${promoId}/dismiss`, { dismissed: checked });
    } catch {
      // ignore network error; retried on close if checked
    }
  };

  const flushDismissals = () => {
    Object.entries(dismissedIds).forEach(([idStr, isChecked]) => {
      if (isChecked) {
        api.post(`/promos/${Number(idStr)}/dismiss`, { dismissed: true }).catch(() => {});
      }
    });
  };

  const handleClose = () => {
    flushDismissals();
    setVisible(false);
    setOpen(false);
  };

  const handleShopNowClick = () => {
    flushDismissals();
    setVisible(false);
    setOpen(false);
    onShopNow();
  };

  if (!open || promos.length === 0) return null;

  const currentPromo = promos[currentIndex] || promos[0];
  const limitNote = currentPromo.limit_note || formatPromoLimitNote(currentPromo);
  const daysRemaining =
    currentPromo.days_remaining !== null && currentPromo.days_remaining !== undefined
      ? Number(currentPromo.days_remaining)
      : null;
  const endsSoon = daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 7;
  const isCurrentDismissed = Boolean(dismissedIds[currentPromo.id]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="franchisee-promo-modal-title"
      onClick={handleClose}
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-[1px] overflow-hidden transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full sm:max-w-lg bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl shadow-2xl overflow-hidden transition-all duration-200 transform ${
          visible
            ? 'translate-y-0 sm:scale-100 opacity-100'
            : 'translate-y-4 sm:translate-y-0 sm:scale-95 opacity-0'
        }`}
      >
        {/* Top Accent Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Active Franchisee Promotion
            </span>
            {promos.length > 1 && (
              <span className="text-xs font-mono text-slate-300">
                ({currentIndex + 1} of {promos.length})
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="Close promotion popup"
            onClick={handleClose}
            className="w-7 h-7 rounded-md bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 flex items-center justify-center text-sm font-bold shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                id="franchisee-promo-modal-title"
                className="text-lg font-bold text-slate-900"
              >
                {currentPromo.name}
              </h2>
              {endsSoon && (
                <span className="font-mono text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-md">
                  {daysRemaining === 0
                    ? 'Ends today!'
                    : `Ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`}
                </span>
              )}
            </div>

            {/* Plain-language how it works */}
            <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50/70 space-y-1">
              <div className="text-sm font-bold text-emerald-950">
                {currentPromo.how_it_works}
              </div>
              {currentPromo.description && (
                <p className="text-xs text-slate-700">{currentPromo.description}</p>
              )}
            </div>
          </div>

          {/* Validity & Max Discount / Limit Note */}
          <div className="space-y-2 text-xs text-slate-600 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Valid until:{' '}
                <strong className="font-mono text-slate-900">{currentPromo.end_date}</strong>
              </span>
              <span className="font-medium text-emerald-800">
                Discount applies automatically in cart
              </span>
            </div>

            {limitNote && (
              <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-700 font-medium">
                <strong className="text-slate-900">Max discount / limit:</strong> {limitNote}
              </div>
            )}
          </div>

          {/* Carousel Controls (Arrows + Dots) if multiple promos */}
          {promos.length > 1 && (
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                aria-label="Previous promotion"
                onClick={() =>
                  setCurrentIndex((prev) => (prev - 1 + promos.length) % promos.length)
                }
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                ← Prev
              </button>

              <div className="flex items-center gap-1.5" role="tablist" aria-label="Promotion slides">
                {promos.map((p, idx) => (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={idx === currentIndex}
                    aria-label={`View promotion ${idx + 1}: ${p.name}`}
                    onClick={() => setCurrentIndex(idx)}
                    className={`h-2 rounded-full transition-all ${
                      idx === currentIndex
                        ? 'w-5 bg-rose-600'
                        : 'w-2 bg-slate-300 hover:bg-slate-400'
                    }`}
                  />
                ))}
              </div>

              <button
                type="button"
                aria-label="Next promotion"
                onClick={() => setCurrentIndex((prev) => (prev + 1) % promos.length)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Next →
              </button>
            </div>
          )}

          {/* Don't show this promo again checkbox */}
          <div className="pt-2 border-t border-slate-100">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isCurrentDismissed}
                onChange={(e) => toggleDismissCurrent(currentPromo.id, e.target.checked)}
                className="rounded border-slate-300 text-rose-600 focus:ring-rose-600"
              />
              <span>Don't show this promo again</span>
            </label>
          </div>

          {/* Primary ("Shop now") & Secondary ("Maybe later") Action Buttons */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="w-full sm:w-auto px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Maybe later
            </button>
            <button
              ref={primaryBtnRef}
              type="button"
              onClick={handleShopNowClick}
              className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
            >
              Shop now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
