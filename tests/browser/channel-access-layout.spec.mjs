import { test, expect } from "./fixture.mjs";
import { openPage } from "./navigation.mjs";

test.use({
  productionBroker: true,
  channelLifecycle: true,
  lifecycleRole: "owner",
  sessionMembers: {
    "11111111-1111-4111-8111-111111111111": ["a".repeat(64)],
  },
  historyCounts: { alpha: 1, beta: 1 },
});

// Browser-only: nested scrolling, text reflow and clipping need the real dialog
// and CSS layout engine. Role/recovery matrices stay in component/session tests.
test("general access stays visible outside member scrolling with enlarged text", async ({
  page,
  app,
}, testInfo) => {
  // Read a signed View only policy without publishing a metadata change.
  await page.route("**/query", async (route) => {
    const response = await route.fetch();
    const events = await response.json();
    await route.fulfill({
      response,
      json: events.map((event) =>
        event.kind === 39000 &&
        event.tags.some(
          ([key, id]) =>
            key === "d" && id === "11111111-1111-4111-8111-111111111111",
        )
          ? app.signRelay({
              kind: event.kind,
              created_at: event.created_at,
              content: event.content,
              tags: [
                ...event.tags.filter(([key]) => key !== "join_role"),
                ["join_role", "guest"],
              ],
            })
          : event,
      ),
    });
  });
  await page.goto(app.origin);
  await openPage(page, "Messages");
  await page
    .getByRole("navigation", { name: "Subscribed channels" })
    .getByRole("button", { name: "Lifecycle channel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Manage members", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Manage members",
    exact: true,
  });
  const general = dialog.getByRole("region", {
    name: "General access",
    exact: true,
  });
  const list = dialog.getByRole("region", { name: "Member list", exact: true });
  const audience = general.getByRole("combobox", { name: "General access" });
  await expect(audience).toBeEnabled();
  await expect(audience).toHaveText("View only");
  await expect(audience).toHaveAttribute("data-size", "md");
  expect(await audience.evaluate((node) => !!node.closest("header"))).toBe(
    false,
  );
  await dialog.evaluate(async (node) => {
    await Promise.all(
      node.getAnimations().map((animation) => animation.finished),
    );
  });
  for (const [width, height, scale, theme] of [
    [1440, 950, 1, "light"],
    [1440, 950, 1, "dark"],
    [1440, 950, 2, "dark"],
    [700, 900, 2, "light"],
    [390, 900, 2, "dark"],
    [390, 720, 1, "dark"],
    [390, 720, 1.5, "light"],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      ({ scale, theme }) => {
        document.documentElement.style.setProperty(
          "--buzz-text-scale",
          String(scale),
        );
        document.documentElement.setAttribute("data-color-mode", theme);
      },
      { scale, theme },
    );
    if (width < 480) {
      // The fixed chrome and enlarged controls cannot all fit at this width.
      // Preserve the bounded whole-body fallback and prove keyboard reachability.
      await audience.focus();
      await expect(audience).toBeInViewport({ ratio: 1 });
    } else {
      await expect
        .poll(() =>
          list.evaluate((node) => {
            const layout = node.parentElement;
            const dialog = layout.closest('[role="dialog"]');
            const general = dialog.querySelector(
              '[aria-label="General access"]',
            );
            const control = general.querySelector('[role="combobox"]');
            const header = dialog.querySelector("header");
            const footer = general.closest("footer");
            return {
              verticalOverflow: layout.scrollHeight > layout.clientHeight + 1,
              horizontalOverflow:
                layout.scrollWidth > layout.clientWidth + 1 ||
                control.scrollWidth > control.clientWidth + 1,
              headerOverflow: header.scrollWidth > header.clientWidth + 1,
              accessOutsideFooter:
                general.getBoundingClientRect().bottom >
                footer.getBoundingClientRect().bottom + 1,
            };
          }),
        )
        .toEqual({
          verticalOverflow: false,
          horizontalOverflow: false,
          headerOverflow: false,
          accessOutsideFooter: false,
        });
      const before = await general.boundingBox();
      await list.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      expect((await general.boundingBox()).y).toBe(before.y);
    }
    await expect
      .poll(() =>
        dialog.locator("footer").evaluate((footer) => ({
          horizontal: footer.scrollWidth > footer.clientWidth + 1,
          vertical: footer.scrollHeight > footer.clientHeight + 1,
        })),
      )
      .toEqual({ horizontal: false, vertical: false });
    await expect
      .poll(() =>
        dialog
          .locator("header")
          .evaluate((header) => header.scrollWidth <= header.clientWidth + 1),
      )
      .toBe(true);
    const done = dialog.getByRole("button", { name: "Done", exact: true });
    for (const action of [audience, done]) {
      await action.focus();
      await expect(action).toBeFocused();
      expect(
        await dialog.locator("footer").evaluate((footer) => {
          footer.scrollTop = 100;
          footer.scrollLeft = 100;
          return [footer.scrollTop, footer.scrollLeft];
        }),
      ).toEqual([0, 0]);
    }
    const accessBox = await audience.boundingBox();
    const doneBox = await done.boundingBox();
    const searchBox = await dialog
      .getByRole("searchbox")
      .evaluate((node) =>
        node.closest(".buzz-input-group").getBoundingClientRect().toJSON(),
      );
    await expect(general.getByRole("status")).toHaveCSS(
      "margin-block-start",
      "-1px",
    );
    expect(accessBox.x).toBeCloseTo(searchBox.x, 0);
    const refreshBox = await dialog
      .getByRole("button", { name: "Refresh member data", exact: true })
      .boundingBox();
    expect(refreshBox.x - searchBox.x - searchBox.width).toBeCloseTo(
      8 * scale,
      0,
    );
    expect(refreshBox.y + refreshBox.height / 2).toBeCloseTo(
      searchBox.y + searchBox.height / 2,
      0,
    );
    if (width >= 700 && scale === 1) {
      expect(accessBox.y).toBeCloseTo(doneBox.y, 0);
      expect(accessBox.x + accessBox.width).toBeLessThan(doneBox.x);
      expect(doneBox.y).toBeGreaterThan(searchBox.y);
    }
    const insets = await audience.evaluate((node) => {
      const style = getComputedStyle(node);
      return [style.paddingInlineStart, style.paddingInlineEnd];
    });
    expect(parseFloat(insets[0])).toBe(8 * scale);
    expect(parseFloat(insets[1])).toBe(12 * scale);
    await audience.locator(".buzz-select-leading").click();
    const options = page.getByRole("listbox");
    await expect(options).toBeVisible();
    if (width >= 700 && scale === 1) {
      await expect
        .poll(async () => {
          const popup = await page.locator(".buzz-select-popup").boundingBox();
          const trigger = await audience.boundingBox();
          return Math.abs(popup.x - trigger.x);
        })
        .toBeLessThan(1);
    }
    await expect(options.getByRole("option")).toHaveText([
      /Public/,
      /View only/,
      /Private/,
    ]);
    await expect(options.locator(".buzz-select-separator")).toBeVisible();
    for (const name of ["Public", "View only", "Private"]) {
      const option = options.getByRole("option", { name, exact: true });
      await option.scrollIntoViewIfNeeded();
      await expect(option).toBeInViewport({ ratio: 1 });
    }
    await page.keyboard.press("Escape");
    await expect(audience).toBeFocused();
    await dialog.screenshot({
      path: testInfo.outputPath(
        `access-${width}-${height}-${scale}-${theme}.png`,
      ),
    });
  }
  await audience.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(audience).toBeFocused();
  await audience.click();
  await page.getByRole("option", { name: "Private", exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(audience).toBeFocused();
  const memberActions = dialog.getByRole("button", { name: /^Actions for / });
  await expect(memberActions).toHaveCount(2);
  await memberActions.nth(1).click();
  await page
    .getByRole("menuitemradio", { name: "Viewing only", exact: true })
    .click();
  const roleConfirmation = page.getByRole("dialog", {
    name: "Change access to Viewing only?",
    exact: true,
  });
  await expect(roleConfirmation).toContainText(
    "Change access from Participating to Viewing only.",
  );
  await expect(
    roleConfirmation.getByRole("button", {
      name: "Set to viewing only",
      exact: true,
    }),
  ).toBeVisible();
  await roleConfirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(app.report.lifecyclePublications ?? []).toEqual([]);
  expect(app.report.unexpected).toEqual([]);
});
