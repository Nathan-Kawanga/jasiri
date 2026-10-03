// Full code chain in three browsers at once (barber, service staff, cashier) plus a public booking.
// Needs seed data and a running app: node tests/e2e-flow.mjs [screenshotDir]
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.argv[2];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/flow_${name}.png`, fullPage: true });

async function signIn(id, pin) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="identifier"]', id);
  await page.fill('input[name="pin"]', pin);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`);
  return page;
}

const brian = await signIn("0711000002", "123456");
const staffPages = { "Mary Wanjiru": await signIn("0722000001", "123456"), "Grace Achieng": await signIn("0722000002", "123456") };
const cashier = await signIn("cashier@kinyozibora.test", "222222");

// Service staff start their day (on duty) and wait on their queues; the cashier waits on the cashier screen.
for (const p of Object.values(staffPages)) {
  await p.goto(`${BASE}/queue`);
  const onDuty = p.getByRole("button", { name: "Start my day (on duty)" });
  if (await onDuty.isVisible()) await onDuty.click();
  await p.getByRole("button", { name: "Go off duty" }).waitFor();
}
await cashier.goto(`${BASE}/cashier`);

// Barber: returning client, amount, make code, client confirms.
await brian.goto(`${BASE}/code/new`);
await brian.getByRole("button", { name: "Returning client" }).click();
await brian.locator("button.min-h-14").first().click();
await brian.fill('input[inputmode="numeric"]', "300");
await shot(brian, "1_amount");
await brian.getByRole("button", { name: "Make code" }).dblclick(); // double tap must still make one code
await brian.getByRole("button", { name: "Confirm my code" }).waitFor();
const code = (await brian.getByTestId("code").textContent()).trim();
await shot(brian, "2_show_code");
await brian.getByRole("button", { name: "Confirm my code" }).click();
await brian.getByText("Send the client to").waitFor();
const sentTo = await brian.getByTestId("sent-to").textContent();
await shot(brian, "3_send_to");
console.log(`Code ${code} sent to ${sentTo}`);
const mary = staffPages[sentTo.trim()];

// Service staff: the code appears without reloading (realtime), client confirms, she adds her service.
await mary.getByText(code).waitFor({ timeout: 15000 });
await mary.getByText(code).click();
await mary.getByRole("button", { name: "Client: tap to confirm" }).click();
await mary.getByPlaceholder("Amount (KES)").fill("100");
await mary.getByPlaceholder("Service (optional, e.g. head wash)").fill("Head wash");
await mary.getByRole("button", { name: "Add", exact: true }).click();
await mary.getByText("KES 100").first().waitFor();
await shot(mary, "4_service");
await mary.getByRole("button", { name: "Done – send to cashier" }).click();

// Cashier: the code shows live with the total, client pays and taps.
await cashier.getByText(code).waitFor({ timeout: 15000 });
await cashier.getByText(code).click();
await cashier.getByText("KES 400").first().waitFor();
await cashier.getByRole("button", { name: /Same as total/ }).click();
await shot(cashier, "5_pay");
await cashier.getByRole("button", { name: /Client: tap to confirm you paid KES 400/ }).click();
await cashier.getByText("Paid: KES 400").waitFor();
await cashier.getByRole("button", { name: "Done" }).click();
await cashier.getByText("Paid today").waitFor();
await shot(cashier, "6_paid_list");

// Barber's earnings show it as cashier-confirmed.
await brian.goto(`${BASE}/earnings`);
const row = brian.locator("div.rounded-xl", { hasText: code });
await row.getByText("Cashier-confirmed").waitFor();
const count = await brian.locator("b.font-mono", { hasText: code }).count();
if (count !== 1) errors.push(`expected one row for ${code}, saw ${count}`);
await shot(brian, "7_earnings");

// Public booking, signed out.
const pub = await (await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true })).newPage();
pub.on("pageerror", (e) => errors.push(e.message));
await pub.goto(`${BASE}/b/brian`);
await pub.locator("button.tabular-nums").first().click();
const phone = `079${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
await pub.fill('input[type="tel"]', phone);
await pub.getByRole("button", { name: "Next" }).click();
await pub.fill('input[autocomplete="given-name"]', "Zawadi");
await pub.locator('input[type="checkbox"]').check();
await pub.getByRole("button", { name: "Book" }).click();
await pub.getByText("You are booked").waitFor();
const masked = await pub.getByText(new RegExp(`07XX XXX ${phone.slice(-3)}`)).textContent();
if ((await pub.content()).includes("Zawadi")) errors.push("public confirmation shows the client name");
await shot(pub, "8_booked");
await pub.getByText("Cancel my booking").click();
pub.once("dialog", (d) => d.accept());
await pub.getByRole("button", { name: "Cancel my booking" }).click();
await pub.getByText("Your booking is cancelled.").waitFor();
console.log(`Booked and cancelled (${masked.trim()})`);

await browser.close();
console.log(errors.length ? `Errors:\n${errors.join("\n")}` : "Flow passed.");
process.exit(errors.length ? 1 : 0);
