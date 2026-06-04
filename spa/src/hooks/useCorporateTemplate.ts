import { useState, useCallback } from "react";

const LOGO_KEY        = "tca-corp-logo";
const DISCLAIMER_KEY  = "tca-corp-disclaimer";
const TITLE_KEY       = "tca-corp-title";

export interface CorporateTemplate {
  logoDataUrl:    string | null;
  disclaimerText: string;
  reportTitle:    string;
  setLogo:        (dataUrl: string | null) => void;
  setDisclaimer:  (text: string) => void;
  setTitle:       (text: string) => void;
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

  const setTitle = useCallback((text: string) => {
    localStorage.setItem(TITLE_KEY, text);
    setTitleState(text);
  }, []);

  return { logoDataUrl, disclaimerText, reportTitle, setLogo, setDisclaimer, setTitle };
}
