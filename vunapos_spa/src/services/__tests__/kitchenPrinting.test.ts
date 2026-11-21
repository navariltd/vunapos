import { describe, it, expect, vi } from "vitest";
import { deliverKitchenJob } from "../kitchenPrinting";
function setup() {
  const api = {claim: vi.fn().mockResolvedValue({name:"job",token:"secret",printer:"Kitchen"}),
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
