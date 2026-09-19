import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeGatewayImageResponse, gatewayVideoOptions, gatewayVideoState } from "./media-contract";

test("failed and pending video tasks must not become completed because they expose a URL", () => {
    assert.equal(gatewayVideoState("failed", "https://example.test/result.mp4"), "failed");
    assert.equal(gatewayVideoState("cancelled", "https://example.test/result.mp4"), "failed");
    assert.equal(gatewayVideoState("expired", ""), "failed");
    assert.equal(gatewayVideoState("in_progress", "https://example.test/result.mp4"), "pending");
    assert.equal(gatewayVideoState("queued", "https://example.test/result.mp4"), "pending");
    assert.equal(gatewayVideoState("completed", ""), "completed");
    assert.equal(gatewayVideoState(undefined, "https://example.test/result.mp4"), "completed");
    assert.equal(gatewayVideoState(undefined, ""), "pending");
});

test("image polling distinguishes native image bytes from JSON jobs and errors", async () => {
    const image = new Blob(["image bytes"], { type: "image/png" });
    assert.deepEqual(await decodeGatewayImageResponse(image), { image });
    assert.deepEqual(await decodeGatewayImageResponse(new Blob(['{"status":"completed","data":[{"b64_json":"abc"}]}'], { type: "application/json" })), { task: { status: "completed", data: [{ b64_json: "abc" }] } });
    assert.deepEqual(await decodeGatewayImageResponse(new Blob(['{"code":"image_not_ready"}'], { type: "application/json" })), { task: { code: "image_not_ready" } });
    await assert.rejects(decodeGatewayImageResponse(new Blob(["<html>Bad Gateway</html>"], { type: "text/html" })));
});

test("published video options preserve explicit false and omit unsupported fields", () => {
    assert.deepEqual(gatewayVideoOptions("false", "false", { supportsGenerateAudio: true, supportsWatermark: true }), { generate_audio: false, watermark: false });
    assert.deepEqual(gatewayVideoOptions("true", "true", { supportsGenerateAudio: true }), { generate_audio: true });
    assert.deepEqual(gatewayVideoOptions("true", "true"), {});
    assert.deepEqual(gatewayVideoOptions("", "", { supportsGenerateAudio: true, supportsWatermark: true }), { generate_audio: true, watermark: false });
});
