import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
test("real browser analysis handles breaking, additive, and unknown constructs", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator("#breaking-count")).toHaveText("4");
  await expect(page.locator("#review-count")).toHaveText("0");
  await page
    .getByRole("button", { name: "Additive release", exact: true })
    .click();
  await expect(page.locator("#breaking-count")).toHaveText("0");
  await expect(page.locator("#info-count")).toHaveText("2");
  await page.getByRole("button", { name: "Needs review", exact: true }).click();
  await expect(page.locator("#review-count")).not.toHaveText("0");
  await expect(page.locator("#findings")).toContainText("oneOf");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
test("editing invalidates old reports and parser errors are actionable", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator("#breaking-count")).toHaveText("4");
  await page
    .getByRole("textbox", { name: "Candidate", exact: true })
    .fill("{invalid");
  await expect(
    page.getByRole("button", { name: "Download JSON" }),
  ).toBeDisabled();
  await expect(page.locator("#findings article")).toHaveCount(0);
  await page.getByRole("button", { name: "Compare contracts" }).click();
  await expect(page.getByRole("alert")).toContainText("Candidate");
  await page
    .getByRole("button", { name: "Breaking release", exact: true })
    .click();
  await expect(page.locator("#breaking-count")).toHaveText("4");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download HTML" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("contract-report.html");
});
