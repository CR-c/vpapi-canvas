/** 网关终态优先于结果链接；只有无状态的同步结果可以凭链接判断完成。 */
export function gatewayVideoState(status: string | undefined, resultUrl: string): "pending" | "completed" | "failed" {
    if (status === "failed" || status === "cancelled" || status === "canceled" || status === "expired") return "failed";
    if (status === "completed" || (!status && resultUrl)) return "completed";
    return "pending";
}

/** 图片任务既可能返回 JSON 结果，也可能直接返回原生渠道的图片二进制。 */
export async function decodeGatewayImageResponse(body: Blob): Promise<{ image: Blob; task?: never } | { image?: never; task: Record<string, unknown> }> {
    if (body.type.startsWith("image/")) return { image: body };
    const task: unknown = JSON.parse(await body.text());
    if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error("Invalid image task response");
    return { task: task as Record<string, unknown> };
}

/** 只发送模型明确公布支持的选项，保留用户显式关闭的 false。 */
export function gatewayVideoOptions(generateAudio: string, watermark: string, capabilities?: { supportsGenerateAudio?: boolean; supportsWatermark?: boolean }) {
    return {
        ...(capabilities?.supportsGenerateAudio ? { generate_audio: generateAudio ? generateAudio === "true" : true } : {}),
        ...(capabilities?.supportsWatermark ? { watermark: watermark === "true" } : {}),
    };
}
