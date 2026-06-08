import { useState, useCallback } from "react";

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

  // Call once on app mount to hydrate controlled assets from bridge
  fetchBranding: () => Promise<void>;
}

export function useCorporateTemplate(): CorporateTemplate {
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

  const fetchBranding = useCallback(async () => {
    try {
      const [logoRes, disclaimerRes, titleRes] = await Promise.all([
        fetch(`${BRIDGE}/branding/logo`),
        fetch(`${BRIDGE}/branding/disclaimer`),
        fetch(`${BRIDGE}/branding/title`),
      ]);

      let anyLoaded = false;

      if (logoRes.ok) {
        const { dataUrl } = await logoRes.json() as { dataUrl: string };
        localStorage.setItem(LOGO_KEY, dataUrl);
        setLogoState(dataUrl);
        anyLoaded = true;
      } else {
        localStorage.removeItem(LOGO_KEY);
        setLogoState(null);
      }

      if (disclaimerRes.ok) {
        const { text } = await disclaimerRes.json() as { text: string };
        localStorage.setItem(DISCLAIMER_KEY, text);
        setDisclaimerState(text);
        anyLoaded = true;
      } else {
        localStorage.removeItem(DISCLAIMER_KEY);
        setDisclaimerState("");
      }

      if (titleRes.ok) {
        const { text } = await titleRes.json() as { text: string };
        localStorage.setItem(TITLE_KEY, text);
        setTitleState(text);
        anyLoaded = true;
      } else {
        localStorage.removeItem(TITLE_KEY);
        setTitleState("");
      }

      setBridgeStatus(anyLoaded ? "loaded" : "no-branding");
    } catch {
      // Bridge offline — keep whatever is in localStorage cache
      setBridgeStatus(
        logoDataUrl || disclaimerText || reportTitle ? "offline" : "no-branding",
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
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
    fetchBranding,
  };
}
