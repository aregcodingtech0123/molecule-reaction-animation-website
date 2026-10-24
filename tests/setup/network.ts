import { afterEach } from "vitest";
import { installNetworkGuard, resetNetworkStubs } from "../../scripts/test/network-guard.mjs";

installNetworkGuard();

afterEach(() => {
  resetNetworkStubs();
});
