import { describe, it, expect, vi } from "vitest";
import { createKitchenStationDrainer, deliverKitchenJob } from "../kitchenPrinting";
function setup() {
  const api = {claim: vi.fn().mockResolvedValue({name:"job",token:"secret",printer:"Kitchen"}),
    release: vi.fn().mockResolvedValue(null),
    dispatch: vi.fn().mockResolvedValue({html:"ticket"}), acknowledge: vi.fn().mockResolvedValue(null)};
  const print = vi.fn().mockResolvedValue(null);
  const prepare = vi.fn().mockResolvedValue(print);
  return {api, print, prepare};
}
describe("kitchen delivery", () => {
  it("prints once and acknowledges only after the spooler resolves", async () => {
    const {api,print,prepare} = setup();
    await deliverKitchenJob(api,()=>true,prepare);
    expect(print).toHaveBeenCalledExactlyOnceWith("ticket");
    expect(api.acknowledge).toHaveBeenCalledExactlyOnceWith({name:"job",token:"secret"},true);
  });
  it("does not dispatch after stop or an unavailable printer", async () => {
    const {api,print,prepare} = setup();
    await deliverKitchenJob(api,()=>false,prepare);
    expect(api.dispatch).not.toHaveBeenCalled(); expect(print).not.toHaveBeenCalled();
    prepare.mockRejectedValueOnce(new Error("offline"));
    await expect(deliverKitchenJob(api,()=>true,prepare)).rejects.toThrow("offline");
    expect(api.dispatch).not.toHaveBeenCalled();
  });
  it("marks a lost spooler response uncertain and never automatically sends twice", async () => {
    const {api,print,prepare} = setup(); print.mockRejectedValueOnce(new Error("connection lost"));
    await expect(deliverKitchenJob(api,()=>true,prepare)).rejects.toThrow("connection lost");
    expect(print).toHaveBeenCalledTimes(1);
    expect(api.acknowledge).toHaveBeenCalledWith({name:"job",token:"secret"},false,"connection lost");
  });
  it("does not print when server rendering fails", async () => {
    const {api,print,prepare} = setup(); api.dispatch.mockResolvedValueOnce({error:"invalid ticket"});
    await expect(deliverKitchenJob(api,()=>true,prepare)).rejects.toThrow("invalid ticket");
    expect(print).not.toHaveBeenCalled();
  });
  it("does not reprint if acknowledgement fails after successful printing", async () => {
    const {api,print,prepare} = setup(); api.acknowledge.mockRejectedValue(new Error("network down"));
    await expect(deliverKitchenJob(api,()=>true,prepare)).rejects.toThrow("network down");
    expect(print).toHaveBeenCalledTimes(1);
  });
});

it("escapes printer and station labels before embedding them in a test slip", async () => {
  const { escapePrintText } = await import("../kitchenPrinting");
  expect(escapePrintText('<img src=x onerror="alert(1)">&')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;');
});


describe("station failure isolation", () => {
  it("continues healthy stations when another station throws", async () => {
    const healthy = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const deliver = vi.fn(async (station: string) => {
      if (station === "drinks") throw new Error("offline");
      return healthy();
    });
    const result = vi.fn();

    const drain = createKitchenStationDrainer(
      ["drinks", "grill"], deliver, result, () => 0,
    );

    await drain(() => true);

    expect(healthy).toHaveBeenCalledTimes(2);
    expect(result).toHaveBeenCalledWith("drinks", "offline");
    expect(result).toHaveBeenCalledWith("grill", null);
    expect(deliver.mock.calls.filter(([name]) => name === "drinks")).toHaveLength(1);
  });

  it("allows a station to be checked again after its cooldown", async () => {
    let time = 0;
    const deliver = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const result = vi.fn();

    const drain = createKitchenStationDrainer(
      ["drinks"], deliver, result, () => time,
    );

    await drain(() => true);
    time = 14999;
    await drain(() => true);

    expect(deliver).toHaveBeenCalledTimes(1);

    time = 15000;
    await drain(() => true);

    expect(result).toHaveBeenLastCalledWith("drinks", null);
  });

  it("bounds delivery work and rotates fairly across stations", async () => {
    const deliver = vi.fn().mockResolvedValue(true);

    const drain = createKitchenStationDrainer(
      ["grill", "drinks"], deliver, vi.fn(),
    );

    await drain(() => true);

    expect(deliver).toHaveBeenCalledTimes(50);
    expect(deliver.mock.calls.filter(([name]) => name === "grill")).toHaveLength(25);
    expect(deliver.mock.calls.filter(([name]) => name === "drinks")).toHaveLength(25);
  });

  it("does not claim more work after the worker stops", async () => {
    let active = true;
    const deliver = vi.fn(async () => {
      active = false;
      return true;
    });

    const drain = createKitchenStationDrainer(
      ["grill", "drinks"], deliver, vi.fn(),
    );

    await drain(() => active);

    expect(deliver).toHaveBeenCalledTimes(1);
  });
});


describe("safe claim release", () => {
  it("releases a claim when the worker stops before dispatch", async () => {
    const {api, print, prepare} = setup();

    await deliverKitchenJob(api, () => false, prepare);

    expect(api.release).toHaveBeenCalledExactlyOnceWith({
      name: "job", token: "secret",
    });
    expect(api.dispatch).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
  });

  it("releases a claim when printer preparation fails", async () => {
    const {api, prepare} = setup();
    prepare.mockRejectedValueOnce(new Error("offline"));

    await expect(deliverKitchenJob(api, () => true, prepare))
      .rejects.toThrow("offline");

    expect(api.release).toHaveBeenCalledTimes(1);
    expect(api.dispatch).not.toHaveBeenCalled();
  });

  it("preserves the original error if claim release also fails", async () => {
    const {api, prepare} = setup();
    prepare.mockRejectedValueOnce(new Error("offline"));
    api.release.mockRejectedValueOnce(new Error("network failure"));

    await expect(deliverKitchenJob(api, () => true, prepare))
      .rejects.toThrow("offline");

    expect(api.dispatch).not.toHaveBeenCalled();
  });

  it("never releases a claim after dispatch has been attempted", async () => {
    const {api, print, prepare} = setup();
    api.dispatch.mockRejectedValueOnce(new Error("response lost"));

    await expect(deliverKitchenJob(api, () => true, prepare))
      .rejects.toThrow("response lost");

    expect(api.release).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
    expect(api.acknowledge).toHaveBeenCalledWith(
      {name: "job", token: "secret"},
      false,
      "response lost",
    );
  });
});
