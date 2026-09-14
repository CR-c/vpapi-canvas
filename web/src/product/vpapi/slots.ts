/**
 * vpapi 按能力分槽位的 API Key。
 *
 * vpapi 的令牌按分组暴露不同模型（有的分组只有生图/视频，有的只有对话），
 * 所以画布允许给每个能力单独填一把 Key；同一把 Key 覆盖多种能力时，填在任意一行即可，
 * 模型仍会按网关公布的能力标签自动归类。
 */
export const KEY_SLOTS = ["text", "image", "video", "audio"] as const;

export type KeySlot = (typeof KEY_SLOTS)[number];

/** 槽位对应的渠道 id；上游用 `渠道id::模型名` 编码模型，天然实现「哪个模型走哪把 Key」。 */
export const SLOT_CHANNEL_ID: Record<KeySlot, string> = {
    text: "vpapi",
    image: "vpapi-image",
    video: "vpapi-video",
    audio: "vpapi-audio",
};

export const SLOT_CHANNEL_IDS = Object.values(SLOT_CHANNEL_ID);

export function isSlotChannelId(id: string) {
    return SLOT_CHANNEL_IDS.includes(id);
}

/** 渠道 id 反查槽位。 */
export function slotOfChannel(id: string): KeySlot | undefined {
    return KEY_SLOTS.find((slot) => SLOT_CHANNEL_ID[slot] === id);
}