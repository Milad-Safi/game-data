import type { ReactNode } from "react";

type Props = {
    label: string;
    left: ReactNode;
    right: ReactNode;
    leftValue?: number | null;
    rightValue?: number | null;
    leftColor: string;
    rightColor: string;
};

/** Numbers/text flank one centered label; the small bar compares raw quantities. */
export default function CompactStatRow({ label, left, right, leftValue, rightValue, leftColor, rightColor }: Props) {
    const showBar = leftValue != null && rightValue != null && leftValue >= 0 && rightValue >= 0;
    const total = (leftValue ?? 0) + (rightValue ?? 0);
    const share = total > 0 ? (leftValue ?? 0) / total * 100 : 50;
    return <div className="compactStatRow">
        <div className="compactStatValue">{left}</div>
        <div className="compactStatCenter"><span>{label}</span>
            {showBar && <span className="compactStatTrack" aria-hidden="true">
                {total > 0 && <><span style={{ width: `${share}%`, backgroundColor: leftColor }} /><span style={{ width: `${100 - share}%`, backgroundColor: rightColor }} /></>}
            </span>}
        </div>
        <div className="compactStatValue compactStatValueRight">{right}</div>
    </div>;
}
