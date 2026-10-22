import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "../../open-sse/services/contextManager.ts";
import { estimateFinalInputTokens } from "../../open-sse/handlers/chatCore/contextEstimation.ts";

// A 451 KB video sent inline as a data URI was measured as ~154k prompt tokens (base64 counted
// as text) and rejected against a 128k window, while the upstream model counted ~550. Inline
// video/audio payloads must be priced like the image/document payloads already are (#8368/#10840).

const LIMIT = 128_000;

function base64Payload(approxBytes: number): string {
  return Buffer.alloc(approxBytes, 65).toString("base64");
}

const VIDEO_B64 = base64Payload(451_000);
const VIDEO_DATA_URL = `data:video/mp4;base64,${VIDEO_B64}`;
const AUDIO_B64 = base64Payload(451_000);

const MEDIA_SHAPES: Array<[string, Record<string, unknown>]> = [
  ["video_url object", { type: "video_url", video_url: { url: VIDEO_DATA_URL } }],
  ["video_url string", { type: "video_url", video_url: VIDEO_DATA_URL }],
  ["input_video", { type: "input_video", video_url: VIDEO_DATA_URL }],
  ["input_audio", { type: "input_audio", input_audio: { data: AUDIO_B64, format: "wav" } }],
  [
    "audio_url data uri",
    { type: "audio_url", audio_url: { url: `data:audio/wav;base64,${AUDIO_B64}` } },
  ],
];

test("inline video/audio payloads are not measured as prompt text", () => {
  for (const [name, block] of MEDIA_SHAPES) {
    const tokens = estimateTokens({
      messages: [{ role: "user", content: [{ type: "text", text: "describe" }, block] }],
    });
    assert.ok(tokens < 10_000, `${name}: expected a bounded media estimate, got ${tokens}`);
  }
});

test("a ~600 KB video data URI stays under a 128k window through the final-input estimator", () => {
  const tokens = estimateFinalInputTokens({
    model: "m",
    messages: [
      {
        role: "user",
        content: [
          { type: "video_url", video_url: { url: VIDEO_DATA_URL } },
          { type: "text", text: "Describe lo que ves." },
        ],
      },
    ],
  });
  assert.ok(tokens < LIMIT, `got ${tokens}, would be rejected against ${LIMIT}`);
});

test("video estimate is the same for every wire shape of the same video", () => {
  const video = MEDIA_SHAPES.filter(([n]) => n !== "input_audio" && n !== "audio_url data uri");
  const counts = [...new Set(video.map(([, block]) => estimateTokens(block)))];
  assert.equal(counts.length, 1, `shapes disagree: ${counts.join(", ")}`);
});

test("a remote video URL stays on the text path (it is a short string, not a payload)", () => {
  const remote = { type: "video_url", video_url: { url: "https://cdn.example.com/clip.mp4" } };
  const tokens = estimateTokens(remote);
  assert.ok(tokens > 0 && tokens < 100, `got ${tokens}`);
});

test("huge plain text is still rejected-sized: the media carve-out does not weaken the text guard", () => {
  const text = "palabra ".repeat(200_000);
  const tokens = estimateTokens({ messages: [{ role: "user", content: text }] });
  assert.ok(tokens > LIMIT, `got ${tokens}`);
});

test("a base64 blob that is not inline media still counts as text", () => {
  const blob = { type: "text", text: VIDEO_B64 };
  assert.ok(estimateTokens(blob) > LIMIT, "plain text base64 must keep its text cost");
});

test("many video parts add up instead of collapsing to one", () => {
  const one = estimateTokens({ type: "video_url", video_url: { url: VIDEO_DATA_URL } });
  const three = estimateTokens([
    { type: "video_url", video_url: { url: VIDEO_DATA_URL } },
    { type: "video_url", video_url: { url: VIDEO_DATA_URL } },
    { type: "video_url", video_url: { url: VIDEO_DATA_URL } },
  ]);
  assert.ok(three >= one * 3 - 10, `one=${one} three=${three}`);
});
