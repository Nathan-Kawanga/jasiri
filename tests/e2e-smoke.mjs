// Browser smoke test at phone size: signs in as each demo role and opens every screen.
// Usage: npm run build && npm start (in another shell), then: node tests/e2e-smoke.mjs [screenshotDir]
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.argv[2];
const users = {
  juma: ["0711000001", "123456", ["/", "/code/new", "/day", "/clients", "/earnings", "/share", "/availability", "/shop/manage",
    "/shop/summary", "/shop/payout", "/shop/flags", "/shop/usage", "/shop/problems", "/shop/audit", "/account", "/earnings?p=month"]],
  mary: ["0722000001", "123456", ["/", "/queue", "/earnings"]],
  grace: ["0722000002", "123456", ["/", "/queue", "/cashier"]],
  cashier: ["cashier@kinyozibora.test", "222222", ["/", "/cashier", "/shop/payout", "/shop/summary"]],
  admin: ["0700000001", "111111", ["/", "/admin", "/admin/users", "/admin/shops", "/admin/clients", "/admin/settings", "/shop/join", "/shop/new"]],
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const problems = [];

async function session(name) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${name} console: ${m.text()}`); });
  const [id, pin] = users[name];
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="identifier"]', id);
  await page.fill('input[name="pin"]', pin);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`);
  return { ctx, page };
}

async function visit(page, name, path) {
  const res = await page.goto(BASE + path);
  const status = res?.status();
  const body = await page.textContent("body");
  if (!status || status >= 400 || /Application error|Unhandled Runtime Error|server-side exception/i.test(body ?? "")) {
    problems.push(`${name} ${path} -> ${status}`);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) problems.push(`${name} ${path} scrolls sideways at 360px`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}${path.replace(/[/?=]/g, "_") || "_home"}.png`, fullPage: true });
}

for (const name of Object.keys(users)) {
  const { ctx, page } = await session(name);
  for (const path of users[name][2]) await visit(page, name, path);
  await ctx.close();
}

// Public booking page, signed out.
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`public pageerror: ${e.message}`));
  await visit(page, "public", "/b/brian");
  await visit(page, "public", "/signup");
  await visit(page, "public", "/guide/barber");
  await page.goto(BASE + "/shop/join?code=KB2345");
  if (!page.url().includes("next=%2Fshop%2Fjoin%3Fcode%3DKB2345")) problems.push("invite link lost the join code: " + page.url());
  await ctx.close();
}

await browser.close();
console.log(problems.length ? problems.join("\n") : "All screens loaded without errors.");
process.exit(problems.length ? 1 : 0);
