import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PosOpeningGate } from "../PosOpeningGate";
import { PosModeSwitch } from "../PosModeSwitch";
import { RestaurantApp } from "../../features/restaurant/RestaurantApp";

const state = vi.hoisted(() => ({
  profile: "Katheri Cooler",
  mode: "Retail",
  session: undefined as undefined | { pos_profile: string; cashier: string; ready: boolean; status: string },
  loading: false,
  error: null as string | null,
}));
vi.mock("../../features/pos/hooks/useBootstrapData", () => ({ useBootstrapData: () => ({ data: { pos_profile: state.profile, pos_mode: state.mode, current_user: "test@navari.co.ke", restaurant_roles: [], can_take_payment: false } }) }));
vi.mock("../../features/pos/hooks/usePosSessionStatus", () => ({ usePosSessionStatus: () => ({ session: state.session, isLoading: state.loading, error: state.error, reload: vi.fn() }) }));
vi.mock("frappe-react-sdk", () => ({ useFrappeGetCall: () => ({}) }));
vi.mock("../../features/pos/components/PosOpeningEntryDialog", () => ({ PosOpeningEntryDialog: ({ posProfile }: { posProfile: string }) => <div>Open shift: {posProfile}</div> }));
vi.mock("../../lib/cacheEngine", () => ({ hydrate: vi.fn() }));

const render = () => renderToStaticMarkup(<PosOpeningGate><div>Selling workspace</div></PosOpeningGate>);

describe("personal profile opening gate", () => {
  it("does not bypass opening when changing Retail to Restaurant with ordinary POS roles", () => {
    for (const [profile, mode] of [["Katheri Cooler", "Retail"], ["Counter 1", "Restaurant"]]) {
      state.profile = profile;
      state.mode = mode;
      state.session = { pos_profile: profile, cashier: "test@navari.co.ke", ready: false, status: "OPENING_REQUIRED" };
      const html = renderToStaticMarkup(<PosModeSwitch
        retail={<PosOpeningGate>Selling workspace</PosOpeningGate>}
        restaurant={<RestaurantApp />}
      />);
      expect(html).toContain(`Open shift: ${profile}`);
      expect(html).not.toContain("Selling workspace");
    }
  });
  it("keeps opening required when switching between profiles with no open session", () => {
    for (const profile of ["Katheri Cooler", "Counter 1", "Katheri Cooler"]) {
      state.profile = profile;
      state.session = { pos_profile: profile, cashier: "test@navari.co.ke", ready: false, status: "OPENING_REQUIRED" };
      const html = render();
      expect(html).toContain(`Open shift: ${profile}`);
      expect(html).not.toContain("Selling workspace");
    }
  });

  it("does not expose selling when a session response is missing", () => {
    state.session = undefined;
    expect(render()).toContain("POS session not verified");
    expect(render()).not.toContain("Selling workspace");
  });

  it("opens the workspace after a verified open session", () => {
    state.session = { pos_profile: state.profile, cashier: "test@navari.co.ke", ready: true, status: "OPEN" };
    expect(render()).toContain("Selling workspace");
  });
});
