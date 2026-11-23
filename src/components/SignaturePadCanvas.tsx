import React, { useRef, useEffect, useState } from 'react';

interface SignaturePadCanvasProps {
  label: string;
  printedName: string;
  onPrintedNameChange?: (name: string) => void;
  printedNamePlaceholder?: string;
  readOnlyName?: boolean;
  signatureDataUrl: string | null;
  onSignatureChange: (dataUrl: string | null) => void;
  signedAt?: string | null;
  required?: boolean;
  height?: number;
  helperText?: string;
}

export const SignaturePadCanvas: React.FC<SignaturePadCanvasProps> = ({
  label,
  printedName,
  onPrintedNameChange,
  printedNamePlaceholder = 'Enter printed full name',
  readOnlyName = false,
  signatureDataUrl,
  onSignatureChange,
  signedAt,
  required = false,
  height = 130,
  helperText,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(Boolean(signatureDataUrl));
  const [isEditingExisting, setIsEditingExisting] = useState(!signatureDataUrl);

  useEffect(() => {
    setHasStrokes(Boolean(signatureDataUrl));
    if (!signatureDataUrl) {
      setIsEditingExisting(true);
    }
  }, [signatureDataUrl]);

  useEffect(() => {
    if (!isEditingExisting) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 360;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Signature baseline guide
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(16, height - 26);
    ctx.lineTo(width - 16, height - 26);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [isEditingExisting, height]);

  const getPointerPos = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      const touch = e.touches[0] || e.changedTouches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if ('touches' in e) {
      e.preventDefault();
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const pos = getPointerPos(e);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setIsDrawing(true);
    setHasStrokes(true);
  };

  const draw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing) return;
    if ('touches' in e) {
      e.preventDefault();
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const pos = getPointerPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const endDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png');
      onSignatureChange(dataUrl);
    }
  };

  const handleClear = () => {
    setIsEditingExisting(true);
    setHasStrokes(false);
    onSignatureChange(null);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 360;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(16, height - 26);
    ctx.lineTo(width - 16, height - 26);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
          {label} {required && <span className="text-red-600">*</span>}
        </label>
        <div className="flex items-center gap-2">
          {signedAt && (
            <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-medium">
              Signed {new Date(signedAt).toLocaleDateString()}
            </span>
          )}
          {(hasStrokes || signatureDataUrl) && (
            <button
              type="button"
              onClick={handleClear}
              className="text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-0.5 rounded bg-white border border-red-200 hover:bg-red-50 transition"
            >
              Clear Signature
            </button>
          )}
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-slate-500 mb-1">
          Printed Name {required && <span className="text-red-500">*</span>}
        </label>
        <input
          type="text"
          value={printedName}
          readOnly={readOnlyName}
          onChange={(e) => onPrintedNameChange?.(e.target.value)}
          placeholder={printedNamePlaceholder}
          className={`w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg ${
            readOnlyName ? 'bg-slate-100 text-slate-700 font-semibold' : 'bg-white text-slate-900'
          }`}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold text-slate-500">
            Signature Pad (Draw with finger, stylus, or mouse)
          </span>
          {signatureDataUrl && (
            <span className="text-[11px] font-bold text-emerald-700">✓ Captured</span>
          )}
        </div>

        {!isEditingExisting && signatureDataUrl ? (
          <div className="relative bg-white border border-slate-300 rounded-lg p-2 flex flex-col items-center justify-center">
            <img
              src={signatureDataUrl}
              alt={`${label} signature`}
              className="max-h-24 object-contain"
            />
            <button
              type="button"
              onClick={handleClear}
              className="mt-1 text-xs text-blue-700 hover:underline font-medium"
            >
              Re-sign on Pad
            </button>
          </div>
        ) : (
          <div className="relative bg-white border-2 border-dashed border-slate-300 rounded-lg overflow-hidden">
            <canvas
              ref={canvasRef}
              style={{ width: '100%', height: `${height}px`, touchAction: 'none' }}
              className="block cursor-crosshair"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={endDrawing}
              onMouseLeave={endDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={endDrawing}
            />
            {!hasStrokes && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400">
                Sign here above the dotted line
              </div>
            )}
          </div>
        )}
      </div>

      {helperText && <p className="text-[11px] text-slate-500">{helperText}</p>}
    </div>
  );
};
