/**
 * vpapi 接入按两类 Key 管理：文生（助手 / 文本节点）与媒体（图片 / 视频 / 音频）。
 *
 * 每组可以接多把 Key，组内顺序就是优先级：模型列表按这个顺序展示，同名模型默认落在靠前的 Key。
 * 渠道 id 用「组前缀 + 随机后缀」保持稳定，删除或重排 Key 都不会让已存在的
 * `渠道id::模型名`（节点 metadata、默认模型）失效。
 */
import { nanoid } from "nanoid";
import type { AiConfig, ModelChannel } from "@/stores/use-config-store";

export const KEY_GROUPS = ["text", "media"] as const;

export type KeyGroup = (typeof KEY_GROUPS)[number];

/** 分组对应的渠道 id 前缀；没有任何 Key 时保留一个固定 id 的占位渠道。 */
const GROUP_CHANNEL_PREFIX: Record<KeyGroup, string> = {
    text: "vpapi-text",
    media: "vpapi-media",
};

export const EMPTY_GROUP_CHANNEL_ID = GROUP_CHANNEL_PREFIX.text;

export function createGroupChannelId(group: KeyGroup) {
    return `${GROUP_CHANNEL_PREFIX[group]}-${nanoid(6)}`;
}

/** 渠道 id 属于哪一组；上游渠道与旧槽位 id（vpapi / vpapi-image…）返回 undefined。 */
export function groupOfChannel(id: string): KeyGroup | undefined {
    return KEY_GROUPS.find((group) => id.startsWith(GROUP_CHANNEL_PREFIX[group]));
}

/** 产品渠道按「文生组在前、组内保持数组顺序」排列，数组顺序即优先级。 */
export function sortGroupChannels(channels: ModelChannel[]) {
    return [...channels].sort((a, b) => KEY_GROUPS.indexOf(groupOfChannel(a.id) as KeyGroup) - KEY_GROUPS.indexOf(groupOfChannel(b.id) as KeyGroup));
}

/** 某一组的渠道，按优先级排列。 */
export function channelsOfGroup(config: Pick<AiConfig, "channels">, group: KeyGroup) {
    return config.channels.filter((channel) => groupOfChannel(channel.id) === group);
}

/** 已填了 Key 的渠道，按优先级排列。 */
export function connectedChannels(config: Pick<AiConfig, "channels">) {
    return config.channels.filter((channel) => groupOfChannel(channel.id) && channel.apiKey.trim());
}

/** 是否已经填过任意一把 Key（额度、接入引导与面板状态判断用）。 */
export function hasGatewayKey(config: Pick<AiConfig, "channels">) {
    return connectedChannels(config).length > 0;
}

/** 优先级序号（从 1 开始）；不在同组渠道里时返回 0。 */
export function channelPriority(config: Pick<AiConfig, "channels">, channelId: string) {
    const group = groupOfChannel(channelId);
    if (!group) return 0;
    const index = channelsOfGroup(config, group).findIndex((channel) => channel.id === channelId);
    return index < 0 ? 0 : index + 1;
}

/** 顶层 `apiKey` / `baseUrl` 的镜像渠道：优先第一把非空 Key（文生组优先）。 */
export function primaryGatewayChannel(channels: ModelChannel[]) {
    return channels.find((channel) => groupOfChannel(channel.id) === "text" && channel.apiKey.trim()) || channels.find((channel) => groupOfChannel(channel.id) && channel.apiKey.trim()) || channels[0];
}

/** Key 掩码：设置页与模型选择器的分组标题共用。 */
export function maskApiKey(key: string) {
    const value = key.trim();
    if (!value) return "";
    return value.length <= 8 ? "••••" : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** 渠道名（`modelOptionLabel` 会带上它，用掩码区分同组的多把 Key）。 */
export function groupChannelName(group: KeyGroup, apiKey: string) {
    const mask = maskApiKey(apiKey);
    return mask ? `vpapi · ${mask}` : `vpapi · ${group}`;
}
