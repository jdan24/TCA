import { useState, useCallback } from "react";

const LOGO_KEY       = "tca-corp-logo";
const DISCLAIMER_KEY = "tca-corp-disclaimer";

export interface CorporateTemplate {
  logoDataUrl:   string | null;
  disclaimerText: string;
  setLogo:       (dataUrl: string | null) => void;
  setDisclaimer: (text: string) => void;
}

export function useCorporateTemplate(): CorporateTemplate {
  const [logoDataUrl, setLogoState] = useState<string | null>(
    () => localStorage.getItem(LOGO_KEY),
  );
  const [disclaimerText, setDisclaimerState] = useState<string>(
    () => localStorage.getItem(DISCLAIMER_KEY) ?? "",
  );

  const setLogo = useCallback((dataUrl: string | null) => {
    if (dataUrl) {
      localStorage.setItem(LOGO_KEY, dataUrl);
    } else {
      localStorage.removeItem(LOGO_KEY);
    }
    setLogoState(dataUrl);
  }, []);

  const setDisclaimer = useCallback((text: string) => {
    localStorage.setItem(DISCLAIMER_KEY, text);
    setDisclaimerState(text);
  }, []);

  return { logoDataUrl, disclaimerText, setLogo, setDisclaimer };
}
