import { Icon } from "@/components/app-icon";

type MetricIcon = "bird" | "cash" | "feed" | "sales";

export function Metric({
  icon,
  label,
  value,
  note,
  tone,
  onClick,
}: {
  icon: MetricIcon;
  label: string;
  value: string;
  note: string;
  tone: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="metric-top">
        <span className={`metric-icon ${tone}`}><Icon name={icon} /></span>
        <span className="metric-label">{label}</span>
      </div>
      <strong className="metric-value">{value}</strong>
      <span className="metric-note">{note}</span>
    </>
  );

  return onClick ? (
    <button
      className="metric-card metric-card-button"
      type="button"
      onClick={onClick}
      aria-label={`View revenue. ${value} revenue recorded. ${note}`}
    >
      {content}
    </button>
  ) : (
    <article className="metric-card">{content}</article>
  );
}
