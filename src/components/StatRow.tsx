"use client";

// Reusable stat comparison row component

import React from "react";

// Render a single comparison row with proportional bar fills and values
export default function StatRow({
  leftVal,
  rightVal,
  label,
  leftText,
  rightText,
  leftColor,
  rightColor,
  sensitivity = 1,
}: {
  leftVal: number | null;
  rightVal: number | null;
  label: string;
  leftText?: string;
  rightText?: string;
  leftColor: string;
  rightColor: string;
  /** Multiplies the bar split’s distance from 50/50; does not alter values. */
  sensitivity?: number;
}) {
  // Normalize inputs to finite numbers or null
  const l =
    typeof leftVal === "number" && Number.isFinite(leftVal) ? leftVal : null;
  const r =
    typeof rightVal === "number" && Number.isFinite(rightVal) ? rightVal : null;

  // Use absolute values to compute proportional bar widths
  const lAbs = l != null ? Math.abs(l) : null;
  const rAbs = r != null ? Math.abs(r) : null;

  const total = lAbs != null && rAbs != null ? lAbs + rAbs : null;

  // Default to a 50/50 split when values are missing or zero
  const baseLeftPct = total && total > 0 ? (lAbs! / total) * 100 : 50;
  const boost = Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : 1;
  const leftPct = Math.max(0, Math.min(100, 50 + (baseLeftPct - 50) * boost));
  const rightPct = 100 - leftPct;

  return (
    <div className="StatRow">
      {/* Team color fills */}
      <div className="StatRowFill">
        <div style={{ width: `${leftPct}%`, background: leftColor }} />
        <div style={{ width: `${rightPct}%`, background: rightColor }} />
      </div>

      {/* Content */}
      <div className="StatRowContent">
        <div className="StatRowValue left">
          {leftText ?? (l != null ? l : "—")}
        </div>

        <div className="StatRowLabel">{label}</div>

        <div className="StatRowValue right">
          {rightText ?? (r != null ? r : "—")}
        </div>
      </div>
    </div>
  );
}
