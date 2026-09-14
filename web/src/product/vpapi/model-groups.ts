import i18n from "@/i18n";
import { decodeChannelModel, type AiConfig } from "@/stores/use-config-store";

import { channelPriority, groupOfChannel, maskApiKey } from "./slots";

export type ModelPickerGroup = { id: string; label: string; models: string[] };

/**
 * 按渠道（Key）把候选模型分组，供模型选择器渲染「先看到 Key，再选它的模型」。
 * 渠道顺序即优先级；不属于产品渠道的模型（本地模式的裸模型名）归到无标题分组。
 */
export function modelPickerGroups(config: AiConfig, values: string[]): ModelPickerGroup[] {
    const buckets = new Map<string, string[]>();
    for (const value of values) {
        const id = decodeChannelModel(value)?.channelId || "";
        const bucket = buckets.get(id);
        if (bucket) bucket.push(value);
        else buckets.set(id, [value]);
    }
    return [...buckets.entries()]
        .sort(([a], [b]) => channelOrder(config, a) - channelOrder(config, b))
        .map(([id, models]) => ({ id, label: channelPickerLabel(config, id), models }));
}

/** 分组标题：`文生 Key 1 · sk-abc1…9x9z`；不属于产品渠道时返回空串。 */
export function channelPickerLabel(config: AiConfig, channelId: string) {
    const channel = config.channels.find((item) => item.id === channelId);
    const group = channel ? groupOfChannel(channel.id) : undefined;
    if (!channel || !group) return "";
    const head = `${i18n.t(`product.keys.${group}`)} ${channelPriority(config, channel.id)}`;
    const mask = maskApiKey(channel.apiKey);
    return mask ? `${head} · ${mask}` : head;
}

function channelOrder(config: AiConfig, channelId: string) {
    if (!channelId) return Number.MAX_SAFE_INTEGER;
    const index = config.channels.findIndex((channel) => channel.id === channelId);
    return index < 0 ? Number.MAX_SAFE_INTEGER - 1 : index;
}
