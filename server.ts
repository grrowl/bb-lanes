import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./shared/rpc";
import { registerCli } from "./server/cli";
import { LanesService } from "./server/service";

export { rpcContract } from "./shared/rpc";

export default function plugin(bb: BbPluginApi) {
  const lanes = new LanesService(bb);
  bb.rpc.register(rpcContract, {
    lanes_window: async ({ since, threadIds }) => lanes.storage.window(since, lanes.indexing, threadIds),
    lanes_block_detail: ({ threadId, blockId }) => lanes.detail(threadId, blockId),
    lanes_decide: ({ threadId, interactionId, decision }) => lanes.decide(threadId, interactionId, decision),
  });
  registerCli(bb, lanes);
  bb.onDispose(() => lanes.dispose());
  bb.background.service("lanes-indexer", { start: signal => lanes.start(signal) });
}
