import { spawnSync } from "node:child_process";
import type { KeyringProvider } from "../types.js";

export function makeKeyring(platform: string = process.platform): KeyringProvider {
  if (platform === "darwin") return macosKeyring();
  if (platform === "linux") return linuxKeyring();
  return windowsStub();
}

function macosKeyring(): KeyringProvider {
  return {
    async get(service, account) {
      const r = spawnSync("security", [
        "find-generic-password",
        "-s", service,
        "-a", account,
        "-w",
      ]);
      if (r.status !== 0) return null;
      return r.stdout.toString().trim() || null;
    },

    async set(service, account, secret) {
      const r = spawnSync("security", [
        "add-generic-password",
        "-s", service,
        "-a", account,
        "-w", secret,
        "-U",
      ]);
      if (r.status !== 0) {
        throw new Error(`keyring set failed: ${r.stderr.toString().trim()}`);
      }
    },

    async delete(service, account) {
      spawnSync("security", [
        "delete-generic-password",
        "-s", service,
        "-a", account,
      ]);
    },
  };
}

function linuxKeyring(): KeyringProvider {
  return {
    async get(service, account) {
      const r = spawnSync("secret-tool", ["lookup", "service", service, "account", account]);
      if (r.status !== 0) return null;
      return r.stdout.toString().trim() || null;
    },

    async set(service, account, secret) {
      const r = spawnSync("secret-tool", [
        "store", "--label", service,
        "service", service,
        "account", account,
      ], { input: secret });
      if (r.status !== 0) {
        throw new Error(`keyring set failed: ${r.stderr.toString().trim()}`);
      }
    },

    async delete(service, account) {
      spawnSync("secret-tool", ["clear", "service", service, "account", account]);
    },
  };
}

function windowsStub(): KeyringProvider {
  return {
    async get() { return null; },
    async set() { throw new Error("Keyring not supported on Windows"); },
    async delete() { /* no-op */ },
  };
}
