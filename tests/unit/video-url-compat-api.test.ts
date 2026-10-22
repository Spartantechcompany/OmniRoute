import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// preserveVideoUrl (#9248) shipped backend-only: the Zod schemas dropped/rejected the key and the
// resolver read a store the dashboard never writes. These tests pin the round trip an operator
// needs: PUT /api/provider-models -> persisted -> getModelPreserveVideoUrl -> translator.

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-video-url-compat-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const modelsDb = await import("../../src/lib/db/models.ts");
const compat = await import("../../src/lib/db/models/compat.ts");
const { getModelPreserveVideoUrl } =
  await import("../../src/lib/db/models/modelPreserveVideoUrl.ts");
const { providerModelMutationSchema } =
  await import("../../src/shared/validation/schemas/provider.ts");
const route = await import("../../src/app/api/provider-models/route.ts");
const { translateRequest } = await import("../../open-sse/translator/index.ts");

const PROVIDER = "openai-compatible-chat-videourl-test";
const MODEL = "qwen-vl-test";

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(resetStorage);
test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function put(body: unknown) {
  return route.PUT(
    new Request("http://localhost/api/provider-models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

test("schema keeps preserveVideoUrl true/false/null instead of dropping it", () => {
  for (const value of [true, false, null]) {
    const parsed = providerModelMutationSchema.safeParse({
      provider: PROVIDER,
      modelId: MODEL,
      preserveVideoUrl: value,
    });
    assert.equal(parsed.success, true, `preserveVideoUrl=${value} must validate`);
    assert.equal(
      (parsed.data as Record<string, unknown>).preserveVideoUrl,
      value,
      `preserveVideoUrl=${value} must survive validation`
    );
  }
});

test("schema accepts preserveVideoUrl inside compatByProtocol", () => {
  const parsed = providerModelMutationSchema.safeParse({
    provider: PROVIDER,
    modelId: MODEL,
    compatByProtocol: { openai: { preserveVideoUrl: true } },
  });
  assert.equal(parsed.success, true);
});

test("schema rejects a non-boolean preserveVideoUrl", () => {
  const parsed = providerModelMutationSchema.safeParse({
    provider: PROVIDER,
    modelId: MODEL,
    preserveVideoUrl: "yes",
  });
  assert.equal(parsed.success, false);
});

test("PUT with only preserveVideoUrl on a model without a custom row enables and clears the flag", async () => {
  const on = await put({ provider: PROVIDER, modelId: MODEL, preserveVideoUrl: true });
  assert.equal(on.status, 200);
  assert.equal(getModelPreserveVideoUrl(PROVIDER, MODEL), true);

  const cleared = await put({ provider: PROVIDER, modelId: MODEL, preserveVideoUrl: null });
  assert.equal(cleared.status, 200);
  assert.equal(getModelPreserveVideoUrl(PROVIDER, MODEL), undefined);
});

test("PUT preserveVideoUrl on an existing custom model row is read by the resolver", async () => {
  await modelsDb.addCustomModel(PROVIDER, MODEL, "Qwen VL test", "manual", "chat-completions", [
    "chat",
  ]);

  const on = await put({ provider: PROVIDER, modelId: MODEL, preserveVideoUrl: true });
  assert.equal(on.status, 200);
  assert.equal(getModelPreserveVideoUrl(PROVIDER, MODEL), true);

  const off = await put({ provider: PROVIDER, modelId: MODEL, preserveVideoUrl: false });
  assert.equal(off.status, 200);
  assert.equal(getModelPreserveVideoUrl(PROVIDER, MODEL), false);

  const cleared = await put({ provider: PROVIDER, modelId: MODEL, preserveVideoUrl: null });
  assert.equal(cleared.status, 200);
  assert.equal(getModelPreserveVideoUrl(PROVIDER, MODEL), undefined);
});

test("a flag written to the compat list still applies when a custom row has no explicit value", async () => {
  await modelsDb.addCustomModel(PROVIDER, MODEL, "Qwen VL test", "manual", "chat-completions", [
    "chat",
  ]);
  compat.mergeModelCompatOverride(PROVIDER, MODEL, { preserveVideoUrl: true });
  assert.equal(getModelPreserveVideoUrl(PROVIDER, MODEL), true);
});

test("an operator-enabled flag reaches the upstream body through translateRequest", async () => {
  await modelsDb.addCustomModel(PROVIDER, MODEL, "Qwen VL test", "manual", "chat-completions", [
    "chat",
  ]);
  await put({ provider: PROVIDER, modelId: MODEL, preserveVideoUrl: true });

  const translated = translateRequest(
    "openai",
    "openai",
    MODEL,
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "video_url", video_url: { url: "https://cdn.example.com/clip.mp4" } },
            { type: "text", text: "describe" },
          ],
        },
      ],
    },
    false,
    null,
    PROVIDER
  ) as { messages: Array<{ content: Array<{ type: string }> }> };

  assert.deepEqual(
    translated.messages[0].content.map((part) => part.type),
    ["video_url", "text"]
  );
});
