import React, { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from '../services/api';
import {
  FRANCHISEE_EQUIPMENT_ITEMS,
  FRANCHISEE_APPLICATION_TIMELINE_STEPS,
  normalizeApplicationStatus,
  getApplicationTimelineStepIndex,
} from '../utils/domainRules';
import { SignaturePadCanvas } from './SignaturePadCanvas';

export const ApplicationStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const norm = normalizeApplicationStatus(status);
  const styleMap: Record<string, string> = {
    'Pending Admin Review': 'bg-amber-100 text-amber-800 border-amber-300',
    Approved: 'bg-blue-100 text-blue-800 border-blue-300',
    'For Delivery': 'bg-indigo-100 text-indigo-800 border-indigo-300',
    Delivered: 'bg-teal-100 text-teal-800 border-teal-300',
    Active: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    Rejected: 'bg-red-100 text-red-800 border-red-300',
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold border ${
        styleMap[norm] || 'bg-slate-100 text-slate-700 border-slate-300'
      }`}
    >
      {norm}
    </span>
  );
};

export const ApplicationWorkflowTimeline: React.FC<{
  status: string;
  rejectionReason?: string | null;
  compact?: boolean;
}> = ({ status, rejectionReason, compact = false }) => {
  const norm = normalizeApplicationStatus(status);
  const currentIdx = getApplicationTimelineStepIndex(norm);

  if (norm === 'Rejected') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-800">
        <span className="font-bold">Workflow Status: Rejected by Admin</span>
        {rejectionReason && <p className="mt-0.5 text-red-700">Reason: {rejectionReason}</p>}
      </div>
    );
  }

  return (
    <div className={`w-full ${compact ? 'py-1' : 'py-2'}`}>
      <div className="grid grid-cols-5 gap-1.5">
        {FRANCHISEE_APPLICATION_TIMELINE_STEPS.map((step, idx) => {
          const isDone = idx <= currentIdx;
          const isCurrent = idx === currentIdx;
          return (
            <div key={step} className="flex flex-col">
              <div className="flex items-center gap-1 mb-1">
                <span
                  className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
                    isCurrent
                      ? 'bg-emerald-600 text-white ring-2 ring-emerald-200'
                      : isDone
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {isDone ? '✓' : idx + 1}
                </span>
                <div
                  className={`h-1 flex-1 rounded ${
                    idx < currentIdx
                      ? 'bg-emerald-500'
                      : isCurrent
                      ? 'bg-emerald-300'
                      : 'bg-slate-200'
                  }`}
                />
              </div>
              <span
                className={`text-[10px] leading-tight font-semibold ${
                  isCurrent
                    ? 'text-emerald-800 font-bold'
                    : isDone
                    ? 'text-slate-700'
                    : 'text-slate-400'
                }`}
              >
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export function downloadApplicationPdf(appRecord: any) {
  if (!appRecord) return;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Official Company Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text('AICE COTABATO-JCDL CORPORATION', pageWidth / 2, 14, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Application No: ${appRecord.application_no || `FR-${appRecord.id}`}   |   Status: ${normalizeApplicationStatus(
      appRecord.status
    )}   |   Account: @${appRecord.username || 'N/A'}`,
    pageWidth / 2,
    19.5,
    { align: 'center' }
  );

  // Green "NEW FRANCHISEE FORM" Banner
  doc.setFillColor(22, 163, 74); // Official green banner
  doc.rect(12, 22.5, pageWidth - 24, 9, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text('NEW FRANCHISEE FORM', pageWidth / 2, 28.5, { align: 'center' });

  // Two-column layout: Left = Section 1 Applicant Details, Right = Section 2 Equipment Received
  const leftX = 12;
  const leftW = 104;
  const rightX = 120;
  const rightW = pageWidth - rightX - 12;
  const startY = 34;

  // Section 1 Table (Left Column)
  autoTable(doc, {
    startY,
    margin: { left: leftX },
    tableWidth: leftW,
    head: [['SECTION 1: APPLICANT DETAILS', '']],
    body: [
      ['DATE APPLIED', String(appRecord.date_applied || '').slice(0, 10)],
      ['COMPLETE NAME', String(appRecord.complete_name || appRecord.owner_name || '')],
      ['CONTACT NUMBER', String(appRecord.contact_number || '')],
      ['NAME OF STORE', String(appRecord.store_name || '')],
      ['STORE ADDRESS', String(appRecord.full_address || appRecord.address || '')],
      ['LANDMARK', String(appRecord.landmark || 'N/A')],
      ['FB ACCT', String(appRecord.facebook_account || 'N/A')],
      ['EMAIL', String(appRecord.email || 'N/A')],
      [
        'GPS COORDS',
        appRecord.lat && appRecord.lng
          ? `${Number(appRecord.lat).toFixed(5)}, ${Number(appRecord.lng).toFixed(5)}`
          : 'N/A',
      ],
      ['REMARKS', String(appRecord.remarks || 'N/A')],
    ],
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontSize: 8.5,
      fontStyle: 'bold',
    },
    styles: {
      fontSize: 8,
      cellPadding: 2.2,
      textColor: [15, 23, 42],
      lineColor: [148, 163, 184],
      lineWidth: 0.2,
    },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 32, fillColor: [241, 245, 249] },
      1: { cellWidth: leftW - 32 },
    },
  });

  const leftFinalY = (doc as any).lastAutoTable?.finalY || 125;

  // Section 2 Table (Right Column: Equipment Received by the Customer)
  const equipmentList: any[] = Array.isArray(appRecord.equipment) ? appRecord.equipment : [];
  const eqBody = FRANCHISEE_EQUIPMENT_ITEMS.map((itemName) => {
    const found = equipmentList.find((e) => e.item_name === itemName);
    const cond = found?.item_condition || 'NOT_ISSUED';
    const qty = found?.quantity ? String(found.quantity) : '0';
    return [
      itemName,
      cond === 'NEW' ? '[ X ]' : '[   ]',
      cond === 'OLD' ? '[ X ]' : '[   ]',
      cond === 'NOT_ISSUED' ? '-' : qty,
    ];
  });

  const freezerNo =
    appRecord.freezer_no ||
    equipmentList.find((e) => e.item_name === 'Freezer')?.freezer_no ||
    '________________________';

  eqBody.push(['Freezer #:', { content: freezerNo, colSpan: 3, styles: { fontStyle: 'bold' } } as any]);

  autoTable(doc, {
    startY,
    margin: { left: rightX },
    tableWidth: rightW,
    head: [['EQUIPMENT RECEIVED', 'NEW', 'OLD', 'QTY']],
    body: eqBody,
    theme: 'grid',
    headStyles: {
      fillColor: [22, 163, 74],
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
    },
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [15, 23, 42],
      lineColor: [148, 163, 184],
      lineWidth: 0.2,
    },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 32 },
      1: { halign: 'center', cellWidth: 15 },
      2: { halign: 'center', cellWidth: 15 },
      3: { halign: 'center', cellWidth: rightW - 62 },
    },
  });

  const rightFinalY = (doc as any).lastAutoTable?.finalY || 125;
  const sigStartY = Math.max(leftFinalY, rightFinalY) + 8;

  // Section 3: Signatures & Sign-offs Header
  doc.setFillColor(30, 41, 59);
  doc.rect(12, sigStartY, pageWidth - 24, 6.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text('SECTION 3: SIGNATURES & SIGN-OFFS', 15, sigStartY + 4.5);

  const sigs = appRecord.signatures || {};
  const boxes = [
    {
      title: 'Customer (Print Name & Signature)',
      name: sigs.customer?.printed_name || appRecord.complete_name || '',
      img: sigs.customer?.signature_image || null,
      signedAt: sigs.customer?.signed_at || null,
    },
    {
      title: 'Sales Agent',
      name: sigs.sales_agent?.printed_name || appRecord.agent_name || '',
      img: sigs.sales_agent?.signature_image || null,
      signedAt: sigs.sales_agent?.signed_at || appRecord.created_at || null,
    },
    {
      title: 'Date Delivered & Cashier',
      name: `Delivered: ${appRecord.date_delivered || 'Pending'}  |  Cashier: ${
        appRecord.cashier_name || 'N/A'
      }`,
      img: null,
      signedAt: appRecord.delivered_at || null,
    },
    {
      title: 'Delivery Team (Print Name & Signature)',
      name: sigs.delivery_team?.printed_name || appRecord.assigned_delivery_name || '',
      img: sigs.delivery_team?.signature_image || null,
      signedAt: sigs.delivery_team?.signed_at || null,
    },
    {
      title: 'Driver (Print Name & Signature)',
      name: sigs.driver?.printed_name || appRecord.assigned_delivery_name || '',
      img: sigs.driver?.signature_image || null,
      signedAt: sigs.driver?.signed_at || null,
    },
    {
      title: 'Collector (Print Name & Signature)',
      name: sigs.collector?.printed_name || appRecord.collector_name || '',
      img: sigs.collector?.signature_image || null,
      signedAt: sigs.collector?.signed_at || null,
    },
    {
      title: 'Noted By (Admin Name & Signature)',
      name: sigs.noted_by?.printed_name || appRecord.noted_by_name || appRecord.approved_by_name || '',
      img: sigs.noted_by?.signature_image || null,
      signedAt: sigs.noted_by?.signed_at || appRecord.approved_at || null,
    },
  ];

  const colW = (pageWidth - 28) / 2;
  const boxH = 26;
  let curY = sigStartY + 9;

  boxes.forEach((box, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 12 + col * (colW + 4);
    const y = curY + row * (boxH + 3);

    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.25);
    doc.rect(x, y, colW, boxH);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(box.title, x + 2.5, y + 4.5);

    if (box.img && typeof box.img === 'string' && box.img.startsWith('data:image/')) {
      try {
        doc.addImage(box.img, 'PNG', x + 20, y + 5.5, 45, 13);
      } catch {
        // ignore invalid image data
      }
    }

    doc.setDrawColor(203, 213, 225);
    doc.line(x + 3, y + boxH - 6.5, x + colW - 3, y + boxH - 6.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(box.name || '______________________________', x + 3, y + boxH - 2.5);

    if (box.signedAt) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(
        String(box.signedAt).slice(0, 10),
        x + colW - 3,
        y + boxH - 2.5,
        { align: 'right' }
      );
    }
  });

  const fileName = `NEW_FRANCHISEE_FORM_${appRecord.application_no || appRecord.id}.pdf`;
  doc.save(fileName);
}

export const FranchiseePaperFormDocument: React.FC<{
  application: any;
}> = ({ application }) => {
  if (!application) return null;
  const equipmentList: any[] = Array.isArray(application.equipment) ? application.equipment : [];
  const sigs = application.signatures || {};
  const freezerNo =
    application.freezer_no ||
    equipmentList.find((e) => e.item_name === 'Freezer')?.freezer_no ||
    '';

  const renderSigBox = (
    title: string,
    printedName: string,
    sigObj?: { printed_name?: string; signature_image?: string | null; signed_at?: string | null },
    extraSubtitle?: string
  ) => {
    const finalName = sigObj?.printed_name || printedName || '';
    const img = sigObj?.signature_image || null;
    const signedAt = sigObj?.signed_at || null;

    return (
      <div className="border border-slate-400 bg-white p-3 flex flex-col justify-between min-h-[118px]">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
            {title}
          </span>
          {signedAt && (
            <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
              {String(signedAt).slice(0, 10)}
            </span>
          )}
        </div>

        <div className="my-1.5 flex items-center justify-center min-h-[52px] border-b border-dashed border-slate-300">
          {img ? (
            <img
              src={img}
              alt={`${title} signature`}
              className="max-h-14 object-contain"
            />
          ) : (
            <span className="text-[11px] italic text-slate-400">
              {finalName ? 'Signed / Recorded' : 'Awaiting signature'}
            </span>
          )}
        </div>

        <div>
          <p className="text-xs font-bold text-slate-900 text-center truncate">
            {finalName || '______________________________'}
          </p>
          <p className="text-[10px] text-slate-500 text-center">
            {extraSubtitle || '(Print Name & Signature)'}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div
      id="aice-official-paper-form"
      className="bg-white border-2 border-slate-800 rounded-none shadow-sm text-slate-900 p-4 sm:p-6"
    >
      {/* Official Paper Header */}
      <div className="text-center border-b-2 border-slate-800 pb-3 mb-3">
        <p className="text-xs font-bold tracking-widest text-slate-500 uppercase">
          Official Franchisee Registration & Equipment Record
        </p>
        <h2 className="text-xl sm:text-2xl font-black tracking-wide text-slate-900">
          AICE COTABATO-JCDL CORPORATION
        </h2>
        <div className="mt-2 bg-emerald-600 text-white py-1.5 px-4 font-extrabold text-base sm:text-lg tracking-widest uppercase">
          NEW FRANCHISEE FORM
        </div>
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-700">
          <span>
            Application No:{' '}
            <strong className="font-mono text-slate-900">
              {application.application_no || `FR-${application.id}`}
            </strong>
          </span>
          <span>
            Account Username:{' '}
            <strong className="font-mono text-blue-700">@{application.username}</strong>
          </span>
          <div className="flex items-center gap-1.5">
            <span>Status:</span>
            <ApplicationStatusBadge status={application.status} />
          </div>
        </div>
      </div>

      {/* 5-Step Status Timeline */}
      <div className="mb-4 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <ApplicationWorkflowTimeline
          status={application.status}
          rejectionReason={application.rejection_reason}
        />
      </div>

      {/* Two-Column Official Paper Body: Left = Section 1 Applicant Details, Right = Section 2 Equipment Received */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: SECTION 1: APPLICANT DETAILS */}
        <div className="lg:col-span-7 border border-slate-400">
          <div className="bg-slate-800 text-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider">
            Section 1: Applicant Details
          </div>
          <div className="divide-y divide-slate-300 text-xs">
            <div className="grid grid-cols-12">
              <div className="col-span-4 bg-slate-100 font-bold p-2 border-r border-slate-300">
                DATE:
              </div>
              <div className="col-span-8 p-2 font-semibold">
                {String(application.date_applied || '').slice(0, 10)}
              </div>
            </div>

            <div className="grid grid-cols-12">
              <div className="col-span-4 bg-slate-100 font-bold p-2 border-r border-slate-300">
                COMPLETE NAME:
              </div>
              <div className="col-span-8 p-2 font-bold text-slate-900">
                {application.complete_name || application.owner_name}
              </div>
            </div>

            <div className="grid grid-cols-12">
              <div className="col-span-4 bg-slate-100 font-bold p-2 border-r border-slate-300">
                CONTACT NUMBER:
              </div>
              <div className="col-span-8 p-2 font-semibold">{application.contact_number}</div>
            </div>

            <div className="grid grid-cols-12">
              <div className="col-span-4 bg-slate-100 font-bold p-2 border-r border-slate-300">
                NAME OF STORE:
              </div>
              <div className="col-span-8 p-2 font-bold text-blue-900">
                {application.store_name}
              </div>
            </div>

            <div className="grid grid-cols-12">
              <div className="col-span-4 bg-slate-100 font-bold p-2 border-r border-slate-300">
                STORE ADDRESS:
              </div>
              <div className="col-span-8 p-2">
                <p className="font-semibold">
                  {application.full_address || application.address}
                </p>
                {application.lat && application.lng && (
                  <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
                    Map Pin: {Number(application.lat).toFixed(5)},{' '}
                    {Number(application.lng).toFixed(5)}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-12">
              <div className="col-span-4 bg-slate-100 font-bold p-2 border-r border-slate-300">
                LANDMARK:
              </div>
              <div className="col-span-8 p-2">{application.landmark || '—'}</div>
            </div>

            <div className="grid grid-cols-12">
              <div className="col-span-4 bg-slate-100 font-bold p-2 border-r border-slate-300">
                FB ACCT:
              </div>
              <div className="col-span-8 p-2 break-all">
                {application.facebook_account || '—'}
              </div>
            </div>

            <div className="grid grid-cols-12">
              <div className="col-span-4 bg-slate-100 font-bold p-2 border-r border-slate-300">
                EMAIL:
              </div>
              <div className="col-span-8 p-2 break-all">{application.email || '—'}</div>
            </div>

            <div className="grid grid-cols-12">
              <div className="col-span-4 bg-slate-100 font-bold p-2 border-r border-slate-300">
                REMARKS:
              </div>
              <div className="col-span-8 p-2 whitespace-pre-wrap">
                {application.remarks || '—'}
              </div>
            </div>

            {application.store_photo_url && (
              <div className="grid grid-cols-12">
                <div className="col-span-4 bg-slate-100 font-bold p-2 border-r border-slate-300">
                  STORE PHOTO:
                </div>
                <div className="col-span-8 p-2">
                  <img
                    src={application.store_photo_url}
                    alt="Storefront"
                    className="h-24 rounded border border-slate-300 object-cover"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: SECTION 2: EQUIPMENT RECEIVED BY THE CUSTOMER */}
        <div className="lg:col-span-5 border border-slate-400 flex flex-col justify-between">
          <div>
            <div className="bg-emerald-700 text-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-center">
              Section 2: Equipment Received by the Customer
            </div>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-400 text-slate-800">
                  <th className="p-2 text-left border-r border-slate-300">ITEM</th>
                  <th className="p-2 text-center border-r border-slate-300 w-14">NEW</th>
                  <th className="p-2 text-center border-r border-slate-300 w-14">OLD</th>
                  <th className="p-2 text-center w-14">QTY</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300">
                {FRANCHISEE_EQUIPMENT_ITEMS.map((itemName) => {
                  const found = equipmentList.find((e) => e.item_name === itemName);
                  const cond = found?.item_condition || 'NOT_ISSUED';
                  const qty = found?.quantity ?? 0;
                  return (
                    <tr key={itemName}>
                      <td className="p-2 font-bold border-r border-slate-300">{itemName}</td>
                      <td className="p-2 text-center border-r border-slate-300">
                        <span
                          className={`inline-flex items-center justify-center w-5 h-5 border rounded font-bold ${
                            cond === 'NEW'
                              ? 'bg-emerald-600 text-white border-emerald-700'
                              : 'bg-white border-slate-400 text-transparent'
                          }`}
                        >
                          ✓
                        </span>
                      </td>
                      <td className="p-2 text-center border-r border-slate-300">
                        <span
                          className={`inline-flex items-center justify-center w-5 h-5 border rounded font-bold ${
                            cond === 'OLD'
                              ? 'bg-amber-600 text-white border-amber-700'
                              : 'bg-white border-slate-400 text-transparent'
                          }`}
                        >
                          ✓
                        </span>
                      </td>
                      <td className="p-2 text-center font-bold">
                        {cond === 'NOT_ISSUED' ? '—' : qty}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t-2 border-slate-400 bg-emerald-50/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-extrabold uppercase text-slate-800">
                Freezer #:
              </span>
              <span className="font-mono text-sm font-black text-emerald-900 bg-white px-3 py-1 border border-emerald-400 rounded">
                {freezerNo || 'Not yet assigned'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3: SIGNATURES AND SIGN-OFFS */}
      <div className="mt-4 border border-slate-400">
        <div className="bg-slate-800 text-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider">
          Section 3: Signatures and Sign-Offs
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 p-2 bg-slate-100">
          {renderSigBox(
            'Customer:',
            application.complete_name || application.owner_name,
            sigs.customer,
            '(Print Name & Signature)'
          )}

          {renderSigBox(
            'Sales Agent:',
            application.agent_name || '',
            sigs.sales_agent,
            '(Registering Sales Agent)'
          )}

          <div className="border border-slate-400 bg-white p-3 flex flex-col justify-between min-h-[118px]">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 block">
                Date Delivered:
              </span>
              <p className="text-sm font-extrabold text-slate-900 mt-1 border-b border-slate-300 pb-1.5">
                {application.date_delivered
                  ? String(application.date_delivered).slice(0, 10)
                  : 'Pending Delivery'}
              </p>
            </div>
            <div className="mt-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 block">
                Cashier:
              </span>
              <p className="text-xs font-bold text-slate-900 mt-1">
                {application.cashier_name || '______________________'}
              </p>
            </div>
          </div>

          {renderSigBox(
            'Delivery Team:',
            application.assigned_delivery_name
              ? `${application.assigned_delivery_name} Team`
              : '',
            sigs.delivery_team,
            '(Print Name & Signature)'
          )}

          {renderSigBox(
            'Driver:',
            application.assigned_delivery_name || '',
            sigs.driver,
            '(Print Name & Signature)'
          )}

          {renderSigBox(
            'Collector:',
            application.collector_name || '',
            sigs.collector,
            '(Print Name & Signature)'
          )}

          <div className="sm:col-span-2">
            {renderSigBox(
              'Noted By (Admin):',
              application.noted_by_name || application.approved_by_name || '',
              sigs.noted_by,
              '(Admin Printed Name & Signature)'
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface FranchiseePaperFormModalProps {
  applicationId?: number | null;
  application?: any;
  initialApplication?: any;
  onClose: () => void;
  viewerRole?: 'admin' | 'agent' | 'delivery' | 'franchisee';
  onUpdated?: (updated?: any) => void;
  onEditRequest?: (appRecord: any) => void;
}

export const FranchiseePaperFormModal: React.FC<FranchiseePaperFormModalProps> = ({
  applicationId,
  application: propApplication,
  initialApplication,
  onClose,
  viewerRole = 'franchisee',
  onUpdated,
  onEditRequest,
}) => {
  const seedApp = initialApplication || propApplication || null;
  const [application, setApplication] = useState<any>(seedApp);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  // Admin review / delivery assignment / signoff state
  const [riders, setRiders] = useState<any[]>([]);
  const [selectedRiderId, setSelectedRiderId] = useState<string>('');
  const [freezerNo, setFreezerNo] = useState<string>('');
  const [cashierName, setCashierName] = useState<string>('');
  const [collectorName, setCollectorName] = useState<string>('');
  const [collectorSig, setCollectorSig] = useState<string | null>(null);
  const [notedByName, setNotedByName] = useState<string>('');
  const [notedBySig, setNotedBySig] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadDetail = async (id: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ data: any }>(`/franchisee-applications/${id}`);
      const rec = res.data;
      setApplication(rec);
      setSelectedRiderId(
        rec.assigned_delivery_user_id ? String(rec.assigned_delivery_user_id) : ''
      );
      setFreezerNo(rec.freezer_no || '');
      setCashierName(rec.cashier_name || '');
      setCollectorName(rec.signatures?.collector?.printed_name || rec.collector_name || '');
      setCollectorSig(rec.signatures?.collector?.signature_image || null);
      setNotedByName(
        rec.signatures?.noted_by?.printed_name ||
          rec.noted_by_name ||
          rec.approved_by_name ||
          'Test Admin'
      );
      setNotedBySig(rec.signatures?.noted_by?.signature_image || null);
    } catch (err: any) {
      setError(err.message || 'Failed to load application details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const targetId = applicationId || seedApp?.id;
    if (targetId) {
      loadDetail(Number(targetId));
    }
    if (viewerRole === 'admin') {
      api
        .get<{ data: any[] }>('/franchisee-applications/delivery-staff-options')
        .then((res) => setRiders(res.data || []))
        .catch(() => {});
    }
  }, [applicationId, seedApp?.id, viewerRole]);

  if (!applicationId && !seedApp) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleAdminApprove = async () => {
    if (!application) return;
    setSubmitting(true);
    setError('');
    setFeedback('');
    try {
      const res = await api.post<{ message: string; application: any }>(
        `/franchisee-applications/${application.id}/review`,
        {
          decision: 'Approved',
          assigned_delivery_user_id: selectedRiderId ? Number(selectedRiderId) : null,
          freezer_no: freezerNo,
          cashier_name: cashierName,
          collector_name: collectorName,
          collector_signature: collectorSig,
          noted_by_name: notedByName,
          noted_by_signature: notedBySig,
        }
      );
      setFeedback(res.message);
      setApplication(res.application);
      onUpdated?.();
    } catch (err: any) {
      setError(err.message || 'Failed to approve application.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdminReject = async () => {
    if (!application) return;
    if (!rejectionReason.trim()) {
      setError('Please enter a rejection reason.');
      return;
    }
    setSubmitting(true);
    setError('');
    setFeedback('');
    try {
      const res = await api.post<{ message: string; application: any }>(
        `/franchisee-applications/${application.id}/review`,
        {
          decision: 'Rejected',
          rejection_reason: rejectionReason.trim(),
        }
      );
      setFeedback(res.message);
      setApplication(res.application);
      setShowRejectInput(false);
      onUpdated?.();
    } catch (err: any) {
      setError(err.message || 'Failed to reject application.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignRiderOrSaveSignoff = async () => {
    if (!application) return;
    setSubmitting(true);
    setError('');
    setFeedback('');
    try {
      if (selectedRiderId) {
        const res = await api.post<{ message: string; application: any }>(
          `/franchisee-applications/${application.id}/assign-delivery`,
          {
            assigned_delivery_user_id: Number(selectedRiderId),
            freezer_no: freezerNo,
            cashier_name: cashierName,
            collector_name: collectorName,
            collector_signature: collectorSig,
            noted_by_name: notedByName,
            noted_by_signature: notedBySig,
          }
        );
        setFeedback(res.message);
        setApplication(res.application);
      } else {
        const res = await api.post<{ message: string; application: any }>(
          `/franchisee-applications/${application.id}/admin-signoff`,
          {
            freezer_no: freezerNo,
            cashier_name: cashierName,
            collector_name: collectorName,
            collector_signature: collectorSig,
            noted_by_name: notedByName,
            noted_by_signature: notedBySig,
          }
        );
        setFeedback(res.message);
        setApplication(res.application);
      }
      onUpdated?.();
    } catch (err: any) {
      setError(err.message || 'Failed to save delivery assignment / sign-off.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-slate-50 border border-slate-300 rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Top Modal Action Bar */}
        <div className="bg-slate-900 text-white px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div>
            <h3 className="text-base font-bold">
              Official Paper Form — {application?.application_no || 'Loading...'}
            </h3>
            <p className="text-xs text-slate-300">
              AICE COTABATO-JCDL CORPORATION • NEW FRANCHISEE FORM
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {viewerRole === 'agent' &&
              application?.status === 'Pending Admin Review' &&
              onEditRequest && (
                <button
                  type="button"
                  onClick={() => onEditRequest(application)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white transition"
                >
                  Edit Application
                </button>
              )}
            {application && (
              <>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-700 hover:bg-slate-600 text-white transition"
                >
                  Print Form
                </button>
                <button
                  type="button"
                  onClick={() => downloadApplicationPdf(application)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition"
                >
                  Download PDF
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20 text-white transition"
            >
              Close ✕
            </button>
          </div>
        </div>

        {/* Modal Scrollable Content */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {loading && !application ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Loading official NEW FRANCHISEE FORM...
            </div>
          ) : (
            <>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-xl text-xs font-semibold">
                  {error}
                </div>
              )}
              {feedback && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-2.5 rounded-xl text-xs font-semibold">
                  {feedback}
                </div>
              )}

              {/* The Official Paper Document */}
              <FranchiseePaperFormDocument application={application} />

              {/* Admin Action Panel: Approve / Reject, Assign Delivery Rider, Cashier/Collector/Noted By Signatures */}
              {viewerRole === 'admin' && application && (
                <div className="bg-white border-2 border-blue-200 rounded-2xl p-4 sm:p-5 space-y-4 print:hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                    <div>
                      <h4 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider">
                        Admin Verification, Equipment Delivery Dispatch & Sign-Off
                      </h4>
                      <p className="text-xs text-slate-500">
                        Approve or reject pending applications, assign a Delivery Staff rider for
                        equipment delivery, and sign &ldquo;Noted By&rdquo;.
                      </p>
                    </div>
                    <ApplicationStatusBadge status={application.status} />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Assign Delivery Staff Rider (Equipment Delivery)
                      </label>
                      <select
                        value={selectedRiderId}
                        onChange={(e) => setSelectedRiderId(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="">-- Select Delivery Staff Rider --</option>
                        {riders.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.full_name} (@{r.username} • {r.contact_number || 'No phone'})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Pre-assign Freezer # (Optional before delivery)
                      </label>
                      <input
                        type="text"
                        value={freezerNo}
                        onChange={(e) => setFreezerNo(e.target.value)}
                        placeholder="e.g. FZ-COT-2026-0105"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Cashier Name (Section 3)
                      </label>
                      <input
                        type="text"
                        value={cashierName}
                        onChange={(e) => setCashierName(e.target.value)}
                        placeholder="e.g. Lorna Bautista"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SignaturePadCanvas
                      label="Noted By (Admin Name & Signature)"
                      printedName={notedByName}
                      onPrintedNameChange={setNotedByName}
                      signatureDataUrl={notedBySig}
                      onSignatureChange={setNotedBySig}
                      signedAt={application.signatures?.noted_by?.signed_at}
                      height={115}
                    />

                    <SignaturePadCanvas
                      label="Collector (Print Name & Signature — Optional)"
                      printedName={collectorName}
                      onPrintedNameChange={setCollectorName}
                      signatureDataUrl={collectorSig}
                      onSignatureChange={setCollectorSig}
                      signedAt={application.signatures?.collector?.signed_at}
                      height={115}
                    />
                  </div>

                  {application.status === 'Pending Admin Review' ? (
                    <div className="pt-2 space-y-3">
                      {showRejectInput && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                          <label className="block text-xs font-bold text-red-800">
                            Rejection Reason (Required) *
                          </label>
                          <textarea
                            rows={2}
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="Explain why this franchisee application is rejected..."
                            className="w-full px-3 py-2 text-sm border border-red-300 rounded-lg bg-white"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={handleAdminReject}
                              className="px-4 py-2 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                            >
                              {submitting ? 'Rejecting...' : 'Confirm Rejection'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowRejectInput(false)}
                              className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-end gap-3">
                        {!showRejectInput && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => setShowRejectInput(true)}
                            className="px-4 py-2.5 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white transition"
                          >
                            Reject Application
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={handleAdminApprove}
                          className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-xs"
                        >
                          {submitting
                            ? 'Processing...'
                            : selectedRiderId
                            ? 'Approve & Dispatch For Equipment Delivery'
                            : 'Approve Franchisee Application'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    application.status !== 'Rejected' && (
                      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={handleAssignRiderOrSaveSignoff}
                          className="px-5 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition shadow-xs"
                        >
                          {submitting
                            ? 'Saving...'
                            : selectedRiderId && application.status === 'Approved'
                            ? 'Assign Rider & Mark "For Delivery"'
                            : 'Save Delivery Rider & Admin Sign-Off'}
                        </button>
                      </div>
                    )
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
