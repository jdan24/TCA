import { createElement, createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

// Keys for bridge-fetched assets (cached locally between sessions)
const LOGO_KEY       = "tca-branding-logo";
const DISCLAIMER_KEY = "tca-branding-disclaimer";
const TITLE_KEY      = "tca-branding-title";

// Keys for user-editable contact info
const CONTACT_NAME_KEY  = "tca-contact-name";
const CONTACT_EMAIL_KEY = "tca-contact-email";
const CONTACT_PHONE_KEY = "tca-contact-phone";

const BRIDGE = "http://localhost:8000";

export type BridgeStatus = "idle" | "loaded" | "offline" | "no-branding";

export interface CorporateTemplate {
  // Controlled assets — fetched from bridge, cached in localStorage
  logoDataUrl:    string | null;
  disclaimerText: string;
  reportTitle:    string;
  bridgeStatus:   BridgeStatus;

  // User contact info — editable, persisted in localStorage
  contactName:    string;
  contactEmail:   string;
  contactPhone:   string;
  setContactName:  (v: string) => void;
  setContactEmail: (v: string) => void;
  setContactPhone: (v: string) => void;
}

const CorporateTemplateContext = createContext<CorporateTemplate | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────
// Mount this once at the app root. It fetches branding from bridge.py on
// startup and caches results in localStorage so all consumers share one state.

export function CorporateTemplateProvider({ children }: { children: ReactNode }) {
  const [logoDataUrl, setLogoState] = useState<string | null>(
    () => localStorage.getItem(LOGO_KEY),
  );
  const [disclaimerText, setDisclaimerState] = useState<string>(
    () => localStorage.getItem(DISCLAIMER_KEY) ?? "",
  );
  const [reportTitle, setTitleState] = useState<string>(
    () => localStorage.getItem(TITLE_KEY) ?? "",
  );
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>("idle");

  const [contactName, setContactNameState] = useState<string>(
    () => localStorage.getItem(CONTACT_NAME_KEY) ?? "",
  );
  const [contactEmail, setContactEmailState] = useState<string>(
    () => localStorage.getItem(CONTACT_EMAIL_KEY) ?? "",
  );
  const [contactPhone, setContactPhoneState] = useState<string>(
    () => localStorage.getItem(CONTACT_PHONE_KEY) ?? "",
  );

  const setContactName = useCallback((v: string) => {
    localStorage.setItem(CONTACT_NAME_KEY, v);
    setContactNameState(v);
  }, []);

  const setContactEmail = useCallback((v: string) => {
    localStorage.setItem(CONTACT_EMAIL_KEY, v);
    setContactEmailState(v);
  }, []);

  const setContactPhone = useCallback((v: string) => {
    localStorage.setItem(CONTACT_PHONE_KEY, v);
    setContactPhoneState(v);
  }, []);

  // Fetch controlled branding assets from bridge on mount and cache locally.
  useEffect(() => {
    let cancelled = false;

    async function fetchBranding() {
      try {
        const [logoRes, disclaimerRes, titleRes] = await Promise.all([
          fetch(`${BRIDGE}/branding/logo`),
          fetch(`${BRIDGE}/branding/disclaimer`),
          fetch(`${BRIDGE}/branding/title`),
        ]);
        if (cancelled) return;

        let anyLoaded = false;

        if (logoRes.ok) {
          const { dataUrl } = await logoRes.json() as { dataUrl: string };
          if (!cancelled) {
            localStorage.setItem(LOGO_KEY, dataUrl);
            setLogoState(dataUrl);
            anyLoaded = true;
          }
        } else {
          localStorage.removeItem(LOGO_KEY);
          setLogoState(null);
        }

        if (disclaimerRes.ok) {
          const { text } = await disclaimerRes.json() as { text: string };
          if (!cancelled) {
            localStorage.setItem(DISCLAIMER_KEY, text);
            setDisclaimerState(text);
            anyLoaded = true;
          }
        } else {
          localStorage.removeItem(DISCLAIMER_KEY);
          setDisclaimerState("");
        }

        if (titleRes.ok) {
          const { text } = await titleRes.json() as { text: string };
          if (!cancelled) {
            localStorage.setItem(TITLE_KEY, text);
            setTitleState(text);
            anyLoaded = true;
          }
        } else {
          localStorage.removeItem(TITLE_KEY);
          setTitleState("");
        }

        if (!cancelled) {
          setBridgeStatus(anyLoaded ? "loaded" : "no-branding");
        }
      } catch {
        if (!cancelled) {
          // Bridge offline — keep whatever is in localStorage cache
          const hasCached = !!(
            localStorage.getItem(LOGO_KEY) ||
            localStorage.getItem(DISCLAIMER_KEY) ||
            localStorage.getItem(TITLE_KEY)
          );
          setBridgeStatus(hasCached ? "offline" : "no-branding");
        }
      }
    }

    void fetchBranding();
    return () => { cancelled = true; };
  }, []);

  const value: CorporateTemplate = {
    logoDataUrl,
    disclaimerText,
    reportTitle,
    bridgeStatus,
    contactName,
    contactEmail,
    contactPhone,
    setContactName,
    setContactEmail,
    setContactPhone,
  };

  return createElement(CorporateTemplateContext.Provider, { value }, children);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCorporateTemplate(): CorporateTemplate {
  const ctx = useContext(CorporateTemplateContext);
  if (!ctx) throw new Error("useCorporateTemplate must be inside CorporateTemplateProvider");
  return ctx;
}
