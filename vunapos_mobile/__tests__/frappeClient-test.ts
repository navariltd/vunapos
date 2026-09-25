import {
  FrappeClientError,
  getVunaMethod,
  postFrappeJsonMethod,
  postVunaJsonMethod,
  postVunaMethod,
  requestFrappePasswordReset,
  signInToFrappe,
  updateFrappePassword,
  validateFrappeSession,
  verifyVunaPosSite,
} from "@/services/frappeClient";

type MockResponseOptions = {
  json?: unknown;
  ok?: boolean;
  setCookies?: string[];
  status?: number;
};

function mockResponse({
  json = {},
  ok = true,
  setCookies = [],
  status = ok ? 200 : 500,
}: MockResponseOptions = {}): Response {
  return {
    headers: {
      get: jest.fn(() => setCookies[0] ?? null),
      getSetCookie: jest.fn(() => setCookies),
    },
    json: jest.fn().mockResolvedValue(json),
    ok,
    status,
  } as unknown as Response;
}

const fetchMock = jest.fn();

describe("frappeClient", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  describe("verifyVunaPosSite", () => {
    it("accepts a responding VunaPOS site", async () => {
      fetchMock.mockResolvedValue(
        mockResponse({ json: { message: { ok: true } } }),
      );

      await expect(
        verifyVunaPosSite("https://vuna.example.com"),
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        "https://vuna.example.com/api/method/vunapos.api.pos.ping",
        {
          headers: { Accept: "application/json" },
          method: "GET",
        },
      );
    });

    it.each([
      [
        mockResponse({ ok: false, status: 404 }),
        "That address did not respond as a VunaPOS site.",
      ],
      [
        mockResponse({ json: { message: { ok: false } } }),
        "That address did not respond as a VunaPOS site.",
      ],
      [
        new Error("offline"),
        "Could not reach that address. Check the URL and your connection.",
      ],
    ])("rejects non-Vuna and unreachable sites", async (response, message) => {
      fetchMock.mockImplementationOnce(() => {
        if (response instanceof Error) throw response;
        return Promise.resolve(response);
      });

      await expect(
        verifyVunaPosSite("https://vuna.example.com"),
      ).rejects.toMatchObject({
        code: "connection",
        message,
      });
    });
  });

  describe("signInToFrappe", () => {
    it("posts trimmed credentials and returns a safely decoded Frappe session ID", async () => {
      fetchMock.mockResolvedValue(
        mockResponse({ setCookies: ["sid=session%2Did; Path=/; HttpOnly"] }),
      );

      await expect(
        signInToFrappe("vuna.example.com", "  cashier@example.com ", "secret"),
      ).resolves.toBe("session-id");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://vuna.example.com/api/method/login",
        {
          body: "usr=cashier%40example.com&pwd=secret",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          method: "POST",
        },
      );
    });

    it("extracts a session from multiple Set-Cookie values and rejects unsafe values", async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockResponse({
            setCookies: ["csrf_token=value", "sid=second-session; Path=/"],
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({ setCookies: ["sid=unsafe%0Avalue; Path=/"] }),
        );

      await expect(
        signInToFrappe("https://vuna.example.com", "cashier", "secret"),
      ).resolves.toBe("second-session");
      await expect(
        signInToFrappe("https://vuna.example.com", "cashier", "secret"),
      ).rejects.toMatchObject({ code: "login" });
    });

    it("rejects missing sessions, failed logins, and invalid company URLs", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse());
      fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 401 }));

      await expect(
        signInToFrappe("https://vuna.example.com", "cashier", "secret"),
      ).rejects.toMatchObject({ code: "login" });
      await expect(
        signInToFrappe("https://vuna.example.com", "cashier", "secret"),
      ).rejects.toMatchObject({ code: "login" });
      await expect(
        signInToFrappe("https://vuna.example.com/path", "cashier", "secret"),
      ).rejects.toMatchObject({ code: "connection" });
    });

    it("recognises Frappe's password-expired response without treating it as a failed credential check", async () => {
      fetchMock.mockResolvedValue(
        mockResponse({
          json: {
            message: "Password Reset",
            redirect_to:
              "/update-password?key=one-time-key&password_expired=true",
          },
        }),
      );

      await expect(
        signInToFrappe("https://vuna.example.com", "cashier", "secret"),
      ).rejects.toMatchObject({
        code: "login",
        message: "Your password has expired. Set a new password to continue.",
        resetKey: "one-time-key",
      });
    });
  });

  describe("password reset", () => {
    it("requests Frappe's generic reset-email flow", async () => {
      fetchMock.mockResolvedValue(mockResponse());

      await expect(
        requestFrappePasswordReset(
          "https://vuna.example.com",
          " cashier@example.com ",
        ),
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        "https://vuna.example.com/api/method/frappe.core.doctype.user.user.reset_password",
        {
          body: "user=cashier%40example.com",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          method: "POST",
        },
      );
    });

    it("updates a password with Frappe's one-time key and returns its fresh session", async () => {
      fetchMock.mockResolvedValue(
        mockResponse({ setCookies: ["sid=fresh-session; Path=/; HttpOnly"] }),
      );

      await expect(
        updateFrappePassword(
          "https://vuna.example.com",
          "one-time-key",
          "new-secret",
        ),
      ).resolves.toBe("fresh-session");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://vuna.example.com/api/method/frappe.core.doctype.user.user.update_password",
        {
          body: "key=one-time-key&logout_all_sessions=1&new_password=new-secret",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          method: "POST",
        },
      );
    });

    it("surfaces Frappe's expired-link response and never accepts it as a session", async () => {
      fetchMock.mockResolvedValue(
        mockResponse({
          json: { message: "This password reset link has expired." },
          ok: false,
          status: 410,
        }),
      );

      await expect(
        updateFrappePassword(
          "https://vuna.example.com",
          "expired-key",
          "new-secret",
        ),
      ).rejects.toMatchObject({
        code: "login",
        message: "This password reset link has expired.",
      });
    });
  });

  describe("validateFrappeSession", () => {
    it.each([
      [200, "valid"],
      [401, "expired"],
      [403, "expired"],
      [500, "unavailable"],
    ] as const)(
      "maps session validation status %s to %s",
      async (status, expected) => {
        fetchMock.mockResolvedValue(
          mockResponse({ ok: status === 200, status }),
        );

        await expect(
          validateFrappeSession("https://vuna.example.com", "session id"),
        ).resolves.toBe(expected);
        expect(fetchMock).toHaveBeenLastCalledWith(
          "https://vuna.example.com/api/method/vunapos.api.auth.get_csrf_token",
          {
            headers: { Accept: "application/json", Cookie: "sid=session%20id" },
            method: "GET",
          },
        );
      },
    );

    it("keeps the saved session when validation cannot reach the site", async () => {
      fetchMock.mockRejectedValue(new Error("offline"));

      await expect(
        validateFrappeSession("https://vuna.example.com", "sid"),
      ).resolves.toBe("unavailable");
    });
  });

  describe("getVunaMethod", () => {
    it("builds a safe query and returns the Vuna payload data", async () => {
      fetchMock.mockResolvedValue(
        mockResponse({
          json: { message: { data: { invoices: [] }, ok: true } },
        }),
      );

      await expect(
        getVunaMethod<{ invoices: unknown[] }>(
          "https://vuna.example.com",
          "session id",
          "vunapos.api.sales.get_invoice_history",
          {
            blank: "",
            current_shift: true,
            ignored: undefined,
            start: 25,
          },
        ),
      ).resolves.toEqual({ invoices: [] });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://vuna.example.com/api/method/vunapos.api.sales.get_invoice_history?current_shift=true&start=25",
        expect.objectContaining({
          headers: expect.objectContaining({ Cookie: "sid=session%20id" }),
          method: "GET",
        }),
      );
    });

    it("distinguishes expired sessions, API envelopes, and connection failures", async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 401 }))
        .mockResolvedValueOnce(
          mockResponse({
            json: {
              message: {
                errors: [{ message: "No active POS shift." }],
                ok: false,
              },
            },
          }),
        )
        .mockRejectedValueOnce(new Error("offline"));

      await expect(
        getVunaMethod("https://vuna.example.com", "sid", "method"),
      ).rejects.toMatchObject({ code: "session" });
      await expect(
        getVunaMethod("https://vuna.example.com", "sid", "method"),
      ).rejects.toMatchObject({ code: "api", message: "No active POS shift." });
      await expect(
        getVunaMethod("https://vuna.example.com", "sid", "method"),
      ).rejects.toMatchObject({ code: "connection" });
    });

    it("uses a status-based API error when a proxy returns non-JSON", async () => {
      const response = mockResponse({ ok: false, status: 502 });
      (response.json as jest.Mock).mockRejectedValue(
        new Error("HTML proxy response"),
      );
      fetchMock.mockResolvedValue(response);

      await expect(
        getVunaMethod("https://vuna.example.com", "sid", "method"),
      ).rejects.toMatchObject({
        code: "api",
        message: "The server could not complete this request (502).",
      });
    });

    it("preserves an aborted request so callers can ignore it safely", async () => {
      const aborted = new DOMException(
        "The operation was aborted.",
        "AbortError",
      );
      fetchMock.mockRejectedValue(aborted);

      await expect(
        getVunaMethod("https://vuna.example.com", "sid", "method"),
      ).rejects.toBe(aborted);
    });
  });

  describe("postVunaMethod", () => {
    it("gets a CSRF token then posts the authenticated Vuna request", async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockResponse({
            json: { message: { data: { csrf_token: "csrf-1" }, ok: true } },
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            json: { message: { data: { name: "ACC-PAY-0001" }, ok: true } },
          }),
        );

      await expect(
        postVunaMethod<{ name: string }>(
          "https://vuna.example.com",
          "session id",
          "vunapos.api.payment.receive_customer_payment",
          {
            amount: 150,
            customer: "CUST-001",
          },
        ),
      ).resolves.toEqual({ name: "ACC-PAY-0001" });

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "https://vuna.example.com/api/method/vunapos.api.auth.get_csrf_token",
        expect.objectContaining({ method: "GET" }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://vuna.example.com/api/method/vunapos.api.payment.receive_customer_payment",
        {
          body: "amount=150&customer=CUST-001",
          headers: {
            Accept: "application/json",
            Cookie: "sid=session%20id",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "X-Frappe-CSRF-Token": "csrf-1",
          },
          method: "POST",
          signal: undefined,
        },
      );
    });
  });

  describe("postVunaJsonMethod", () => {
    it("posts a JSON body while retaining the VunaPOS response envelope", async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockResponse({
            json: { message: { data: { csrf_token: "csrf-1" }, ok: true } },
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            json: { message: { data: { name: "POS-CLOSE-0001" }, ok: true } },
          }),
        );

      await expect(
        postVunaJsonMethod<{ name: string }>(
          "https://vuna.example.com",
          "session id",
          "vunapos.api.pos_closing.close_session",
          {
            closing_balances: [
              { closing_amount: 100, mode_of_payment: "Cash" },
            ],
            pos_profile: "POS-001",
          },
        ),
      ).resolves.toEqual({ name: "POS-CLOSE-0001" });

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://vuna.example.com/api/method/vunapos.api.pos_closing.close_session",
        expect.objectContaining({
          body: JSON.stringify({
            closing_balances: [
              { closing_amount: 100, mode_of_payment: "Cash" },
            ],
            pos_profile: "POS-001",
          }),
          headers: expect.objectContaining({
            "Content-Type": "application/json; charset=utf-8",
          }),
          method: "POST",
        }),
      );
    });
  });

  describe("postFrappeJsonMethod", () => {
    it("matches the SPA JSON transport for Frappe methods with raw message payloads", async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockResponse({
            json: { message: { data: { csrf_token: "csrf-1" }, ok: true } },
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            json: { message: { name: "POS-OPEN-0001", success: true } },
          }),
        );

      await expect(
        postFrappeJsonMethod<{ name: string; success: boolean }>(
          "https://vuna.example.com",
          "session id",
          "vunapos.api.pos_entry.create_opening_entry",
          {
            opening_balance: [{ mode_of_payment: "Cash", opening_amount: 100 }],
            pos_profile: "POS-001",
          },
        ),
      ).resolves.toEqual({ name: "POS-OPEN-0001", success: true });

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://vuna.example.com/api/method/vunapos.api.pos_entry.create_opening_entry",
        {
          body: JSON.stringify({
            opening_balance: [{ mode_of_payment: "Cash", opening_amount: 100 }],
            pos_profile: "POS-001",
          }),
          headers: {
            Accept: "application/json",
            Cookie: "sid=session%20id",
            "Content-Type": "application/json; charset=utf-8",
            "X-Frappe-CSRF-Token": "csrf-1",
          },
          method: "POST",
          signal: undefined,
        },
      );
    });

    it("surfaces Frappe validation messages from failed JSON requests", async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockResponse({
            json: { message: { data: { csrf_token: "csrf-1" }, ok: true } },
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            json: {
              _server_messages: JSON.stringify([
                JSON.stringify({
                  message:
                    "Cashier <strong>cashier@example.com</strong> already has an open POS shift.",
                }),
              ]),
              exc_type: "ValidationError",
            },
            ok: false,
            status: 417,
          }),
        );

      await expect(
        postFrappeJsonMethod(
          "https://vuna.example.com",
          "session id",
          "vunapos.api.pos_entry.create_opening_entry",
          {},
        ),
      ).rejects.toMatchObject({
        code: "api",
        message: "Cashier cashier@example.com already has an open POS shift.",
        status: 417,
      });
    });

    it("falls back to the server exception when no structured message exists", async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockResponse({
            json: { message: { data: { csrf_token: "csrf-1" }, ok: true } },
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            json: {
              exception: "frappe.exceptions.ValidationError: Invalid balance",
            },
            ok: false,
            status: 417,
          }),
        );

      await expect(
        postFrappeJsonMethod(
          "https://vuna.example.com",
          "session id",
          "vunapos.api.pos_entry.create_opening_entry",
          {},
        ),
      ).rejects.toMatchObject({
        message: "Invalid balance",
        status: 417,
      });
    });
  });
});
