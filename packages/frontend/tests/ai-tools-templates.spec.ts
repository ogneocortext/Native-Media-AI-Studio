import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { navigateWithWait, cleanupRoutes, setupConsoleErrorCapture } from "./helpers";

const TEMPLATE_LABELS = [
  "Video Concept",
  "Scene Description",
  "Color Palette",
  "Transition Ideas",
  "Project Status",
  "Visualization",
];

// Fast local tool-capable model. gemma4:e2b-it-qat produced strong responses
// in probing (see diag2); llama3.2:3b is faster but less reliable at tool use.
const PINNED_MODEL = /^gemma4:e2b-it-qat/;

interface TemplateResult {
  template: string;
  model: string;
  ok: boolean;
  responseLength: number;
  ms: number;
  error?: string;
  preview: string;
  visualizationRendered: boolean;
  consoleErrors: string[];
}

test.describe("AI Tools — each template end-to-end (real browser)", () => {
  test("click every template, send, and measure the result", async ({
    browser,
  }) => {
    const results: TemplateResult[] = [];

    for (const label of TEMPLATE_LABELS) {
      // Fresh context per template so conversation state / bfcache cannot leak
      // between templates and each measurement is independent.
      const ctx = await browser!.newContext();
      const p = await ctx.newPage();
      const consoleErrors = setupConsoleErrorCapture(p);

      const result: TemplateResult = {
        template: label,
        model: "gemma4:e2b-it-qat",
        ok: false,
        responseLength: 0,
        ms: 0,
        preview: "",
        visualizationRendered: false,
        consoleErrors: [],
      };

      const t0 = Date.now();
      try {
        await cleanupRoutes(p);
        await navigateWithWait(p, "/analyze/ai");

        // --- select a deterministic local tool-capable model ---------------
        const showAll = p.getByRole("button", { name: /Show all/ });
        if ((await showAll.count()) > 0) await showAll.first().click();
        await p.getByRole("button", { name: PINNED_MODEL }).first().click();

        const promptBox = p.locator(
          'textarea[placeholder*="Ask for video concepts"]',
        );
        const sendBtn = p.getByRole("button", { name: /^Send$/ });
        const generatingBtn = p.getByRole("button", { name: /^Generating…$/ });

        // --- click the template (exact name to avoid tool-registry clones) --
        await p
          .getByRole("button", { name: label, exact: true })
          .click({ timeout: 10000 });
        const promptValue = await promptBox.inputValue();
        if (!promptValue) {
          throw new Error(`template "${label}" did not fill the prompt`);
        }
        await expect(sendBtn).toBeEnabled({ timeout: 5000 });

        // --- send ----------------------------------------------------------
        await sendBtn.click();

        // --- wait for streaming to finish ----------------------------------
        // Local model cold-start + generation on this hardware can take ~2 min;
        // allow 5 min per template so a cold start isn't mistaken for a defect.
        await expect(generatingBtn).toBeHidden({ timeout: 300000 });

        // --- read the assistant response -----------------------------------
        const blocks = p.locator(
          "div.bg-gray-700.border.border-gray-600 div.whitespace-pre-wrap",
        );
        const content = ((await blocks.last().textContent()) ?? "").trim();

        // --- visualization render check (Visualization template only) -----
        // A tool-only turn (model calls generate_visualization, says nothing)
        // yields empty spoken text but a rendered canvas — that is success.
        if (label === "Visualization") {
          try {
            result.visualizationRendered = (await p.locator("canvas").count()) > 0;
          } catch {
            /* canvas probe failed; leave visualizationRendered false */
          }
          if (result.visualizationRendered) {
            result.ok = true;
            result.responseLength = content.length;
            result.preview = content.length
              ? content.slice(0, 160).replace(/\s+/g, " ")
              : "visualization rendered via tool (no spoken text)";
          } else {
            throw new Error("visualization tool did not render a canvas");
          }
        } else {
          if (!content) {
            throw new Error("assistant response was empty");
          }
          result.ok = true;
          result.responseLength = content.length;
          result.preview = content.slice(0, 160).replace(/\s+/g, " ");
        }
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
      } finally {
        result.ms = Date.now() - t0;
        result.consoleErrors = [...consoleErrors];
        results.push(result);
        await ctx.close().catch(() => {});
      }
    }

    const outDir = path.join(
      process.cwd(),
      "packages",
      "frontend",
      "tests",
    );
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "ai-template-results.json"),
      JSON.stringify(
        {
          model: "gemma4:e2b-it-qat",
          results,
          summary: {
            total: results.length,
            passed: results.filter((r) => r.ok).length,
            failed: results.filter((r) => !r.ok).length,
            avgMs:
              results.reduce((a, b) => a + b.ms, 0) /
              Math.max(results.length, 1),
          },
        },
        null,
        2,
      ),
    );

    // eslint-disable-next-line no-console
    console.log(
      `\nAI TEMPLATE RESULTS (gemma4:e2b-it-qat):\n${results
        .map(
          (r) =>
            `  ${r.ok ? "PASS" : "FAIL"}  ${r.template.padEnd(
              20,
            )} ${r.ms}ms len=${r.responseLength} viz=${r.visualizationRendered} ${
              r.error ? "ERR:" + r.error : ""
            } | ${r.preview}`,
        )
        .join("\n")}\n`,
    );

    const failures = results.filter((r) => !r.ok);
    expect(failures).toEqual([]);
  });
});
