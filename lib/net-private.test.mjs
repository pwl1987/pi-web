// 纯逻辑单测：SSRF 主机过滤（node --test --experimental-strip-types）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateIp, isPrivateIpv4, isPrivateIpv6, isHostBlocked } from "./net-private.ts";

test("isPrivateIpv4 拒绝常见私有段", () => {
  assert.equal(isPrivateIpv4("10.0.0.1"), true);
  assert.equal(isPrivateIpv4("172.16.5.5"), true);
  assert.equal(isPrivateIpv4("172.32.0.1"), false);
  assert.equal(isPrivateIpv4("192.168.1.1"), true);
  assert.equal(isPrivateIpv4("127.0.0.1"), true);
  assert.equal(isPrivateIpv4("169.254.169.254"), true);
  assert.equal(isPrivateIpv4("100.64.0.1"), true);
  assert.equal(isPrivateIpv4("8.8.8.8"), false);
  // 非合法 IPv4 字面量（如域名）返回 false，交由 DNS 解析判定。
  assert.equal(isPrivateIpv4("not-an-ip"), false);
});

test("isPrivateIpv6 拒绝私有/回环/映射地址", () => {
  assert.equal(isPrivateIpv6("::1"), true);
  assert.equal(isPrivateIpv6("::"), true);
  assert.equal(isPrivateIpv6("fe80::1"), true);
  assert.equal(isPrivateIpv6("fc00::1"), true);
  assert.equal(isPrivateIpv6("fd00::1"), true);
  assert.equal(isPrivateIpv6("::ffff:169.254.169.254"), true);
  assert.equal(isPrivateIpv6("2001:4860:4860::8888"), false);
});

test("isPrivateIp 按字面量分发", () => {
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("1.1.1.1"), false);
});

test("isHostBlocked 用注入解析器判定", async () => {
  const publicResolve = async () => [{ address: "93.184.216.34", family: 4 }];
  const privateResolve = async () => [{ address: "10.0.0.5", family: 4 }];
  const failResolve = async () => {
    throw new Error("dns");
  };
  assert.equal(await isHostBlocked("example.com", publicResolve), false);
  assert.equal(await isHostBlocked("example.com", privateResolve), true);
  // DNS 失败闭环：视为被禁止，不泄漏错误也不放行。
  assert.equal(await isHostBlocked("example.com", failResolve), true);
  // IP 字面量直接判定，不触发解析。
  assert.equal(await isHostBlocked("169.254.169.254"), true);
  assert.equal(await isHostBlocked("8.8.8.8"), false);
});
