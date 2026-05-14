import { useEffect, useState } from 'react';
import { Beaker } from 'lucide-react';
import { getHealth } from '../services/brevoApi';

// Demo-mode banner. Hidden by default. Renders only when the backend's
// /api/health reports `demoMode: true`, which is set by the `DEMO_MODE` env
// flag on the server. Tells visitors the instance is a sandbox so they don't
// expect their data to stick around, and explains why "Send" doesn't mail
// (brevoClient short-circuits to dry-run in demo mode).
//
// We fetch once on mount; the banner shape doesn't change mid-session.
export function DemoBanner() {
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((data) => {
        if (cancelled) return;
        setDemoMode(Boolean(data?.demoMode));
      })
      .catch(() => {
        // If health check fails we'd rather show nothing than wrongly accuse
        // the instance of being a demo. Default-off stays correct.
      });
    return () => { cancelled = true; };
  }, []);

  if (!demoMode) return null;
  return (
    <div className="demo-banner" role="note" aria-label="Demo instance notice">
      <Beaker size={14} aria-hidden="true" />
      <span>
        <strong>Demo instance.</strong> Sends are dry-run only and the database resets every hour. Sign up at{' '}
        <a href="https://github.com/helloSanmi/posty-mail" target="_blank" rel="noopener noreferrer">
          github.com/helloSanmi/posty-mail
        </a>{' '}
        to self-host.
      </span>
    </div>
  );
}
