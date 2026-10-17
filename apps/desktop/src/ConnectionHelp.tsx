import React, { useEffect, useState } from 'react';
import { AlertCircle, HelpCircle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

export interface ConnectionGuidance {
  id: string;
  state: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  steps: string[];
}

export interface OemGuidance {
  id: string;
  manufacturer: string;
  family?: string;
  title: string;
  restriction: string;
  uncertainty: string;
  steps: string[];
  reference?: { label: string; url: string };
  evidence: 'documented' | 'community-reported' | 'none';
}

export interface DeviceHelp {
  key: string;
  connection: ConnectionGuidance | null;
  vendor: OemGuidance[];
}

interface ConnectionHelpProps {
  deviceLabel: string;
  help: DeviceHelp | null;
  retrying: boolean;
  onRetry: () => void;
}

const EVIDENCE_LABEL: Record<OemGuidance['evidence'], string> = {
  documented: 'Documented upstream',
  'community-reported': 'Community reported',
  none: 'General advice'
};

/**
 * Compact help area for the selected device. Connection problems (ADB state) are shown separately from
 * vendor-specific input restrictions. Dismissal is remembered per guidance key, so the same help is not
 * shown again until the situation changes.
 */
export default function ConnectionHelp({ deviceLabel, help, retrying, onRetry }: ConnectionHelpProps) {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // A new guidance key (different state or device) re-opens the area collapsed.
  useEffect(() => {
    setExpanded(false);
  }, [help?.key]);

  if (!help || (!help.connection && help.vendor.length === 0)) return null;
  if (dismissedKey === help.key) return null;

  const hasConnectionIssue = !!help.connection;
  const tone =
    help.connection?.severity === 'error'
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-100'
      : help.connection?.severity === 'warning'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
      : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-100';

  return (
    <section
      className="mx-4 mt-3"
      role="region"
      aria-label={`Connection help for ${deviceLabel}`}
      data-testid="connection-help"
    >
      <div className={`rounded-xl border px-4 py-2.5 text-xs ${tone}`}>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-expanded={expanded}
            aria-controls="connection-help-body"
            className="flex items-center gap-2 text-left font-semibold focus-visible:ring-2 focus-visible:ring-indigo-400 rounded cursor-pointer"
          >
            {hasConnectionIssue ? (
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            ) : (
              <HelpCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            )}
            <span>
              {hasConnectionIssue ? help.connection!.title : `Tips for ${deviceLabel}`}
            </span>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="glass-button text-[11px] py-1 px-3 min-h-[30px] flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
              aria-label="Retry device connection check"
            >
              <RefreshCw className={`w-3 h-3 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{retrying ? 'Checking…' : 'Retry'}</span>
            </button>
            <button
              type="button"
              onClick={() => setDismissedKey(help.key)}
              className="text-slate-300 hover:text-white text-base font-bold px-1.5 rounded focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
              aria-label="Dismiss connection help"
            >
              ×
            </button>
          </div>
        </div>

        {expanded && (
          <div id="connection-help-body" className="mt-3 space-y-3 text-slate-200">
            {help.connection && (
              <div>
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-300 mb-1">Connection</div>
                <ol className="list-decimal pl-5 space-y-1">
                  {help.connection.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            )}

            {help.vendor.map(g => (
              <div key={g.id} data-testid={`oem-guidance-${g.id}`}>
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-300 mb-1">
                  Vendor-specific input restrictions · {EVIDENCE_LABEL[g.evidence]}
                </div>
                <p className="font-semibold text-white">{g.title}</p>
                <p className="mt-1">{g.restriction}</p>
                <ol className="list-decimal pl-5 space-y-1 mt-2">
                  {g.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
                <p className="mt-2 text-slate-300 italic">{g.uncertainty}</p>
                {g.reference && (
                  <p className="mt-1 text-slate-300">
                    Reference: <span className="font-mono">{g.reference.label}</span> ({g.reference.url})
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
