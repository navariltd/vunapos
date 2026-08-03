import { useEffect, useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import { unwrapVunaResponse, vunaMethods } from "../services/vunaApi";

type CsrfTokenPayload = {
  csrf_token?: string;
};

type CsrfTokenLoaderProps = {
  children: React.ReactNode;
};

declare global {
  interface Window {
    csrf_token?: string;
    frappe?: {
      csrf_token?: string;
    };
  }
}

export function CsrfTokenLoader({ children }: CsrfTokenLoaderProps) {
  const response = useFrappeGetCall<unknown>(vunaMethods.getCsrfToken);

  const csrfToken = useMemo(() => {
    if (!response.data) {
      return window.csrf_token || window.frappe?.csrf_token;
    }
    try {
      return unwrapVunaResponse<CsrfTokenPayload>(response.data).csrf_token;
    } catch (err) {
      console.error(err);
      return window.csrf_token || window.frappe?.csrf_token;
    }
  }, [response.data]);

  useEffect(() => {
    const token = csrfToken || window.frappe?.csrf_token;
    if (token) {
      window.csrf_token = token;
    }
  }, [csrfToken]);

  return <>{children}</>;
}
