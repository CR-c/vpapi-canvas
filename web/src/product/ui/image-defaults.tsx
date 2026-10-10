import { Form, Select } from "antd";
import { useTranslation } from "react-i18next";

import { imageAspectOptions, imageQualityOptions } from "@/components/image-settings-panel";
import { resolveImageSize } from "@/services/api/image";
import { useConfigStore } from "@/stores/use-config-store";

const RATIO_VALUES = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];
const FOLLOW_QUALITY = "follow";
const RESOLUTION_TIERS = [
    { value: "1024", label: "1K", quality: "low" },
    { value: "2048", label: "2K", quality: "medium" },
    { value: "2880", label: "4K", quality: "high" },
];

/**
 * 生图默认质量 / 分辨率 / 画幅。
 *
 * 默认值仍落在既有的生成参数上：质量写 `quality`，「分辨率 + 画幅」换算成 `size`。
 * 分辨率保持「跟随质量」时只写画幅比例，让质量档决定像素；选定分辨率时按生成端同一套公式换算成显式尺寸。
 */
export function ImageDefaults() {
    const { t } = useTranslation();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const defaults = readSizeDefaults(config.size);

    return (
        <>
            <Form.Item label={t("product.imageDefaults.quality")} className="mb-4">
                <Select value={config.quality || "auto"} options={imageQualityOptions} onChange={(value) => updateConfig("quality", value)} />
            </Form.Item>
            <Form.Item label={t("product.imageDefaults.resolution")} className="mb-4">
                <Select
                    value={defaults.tier}
                    disabled={defaults.ratio === "auto"}
                    options={[{ value: FOLLOW_QUALITY, label: t("product.imageDefaults.followQuality") }, ...RESOLUTION_TIERS.map(({ value, label }) => ({ value, label }))]}
                    onChange={(value) => updateConfig("size", composeSize(defaults.ratio, value))}
                />
            </Form.Item>
            <Form.Item label={t("product.imageDefaults.aspect")} className="mb-4">
                <Select
                    value={defaults.ratio}
                    options={[{ value: "auto", label: t("settingsPanels.common.auto") }, ...imageAspectOptions.filter((item) => RATIO_VALUES.includes(item.value))]}
                    onChange={(value) => updateConfig("size", composeSize(value, defaults.tier))}
                />
            </Form.Item>
        </>
    );
}

/** 把配置里存的 size 反推成「画幅 + 分辨率」两个下拉的当前值。 */
function readSizeDefaults(size: string) {
    const value = (size || "").trim();
    if (!value || value.toLowerCase() === "auto") return { ratio: "auto", tier: FOLLOW_QUALITY };
    const dimensions = value.match(/^(\d+)x(\d+)$/i);
    if (dimensions) {
        const width = Math.max(1, Number(dimensions[1]));
        const height = Math.max(1, Number(dimensions[2]));
        return { ratio: closestRatio(width / height), tier: closestTier(Math.sqrt(width * height)) };
    }
    const parts = value.split(":").map(Number);
    if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) return { ratio: closestRatio(parts[0] / parts[1]), tier: FOLLOW_QUALITY };
    return { ratio: "auto", tier: FOLLOW_QUALITY };
}

/** 「跟随质量」保留画幅比例，其余分辨率档与画幅组合成显式尺寸。 */
function composeSize(ratio: string, tier: string) {
    if (ratio === "auto") return "auto";
    const target = RESOLUTION_TIERS.find((item) => item.value === tier);
    return target ? resolveImageSize(target.quality, ratio) : ratio;
}

function closestRatio(value: number) {
    return RATIO_VALUES.reduce((best, item) => (ratioDistance(item, value) < ratioDistance(best, value) ? item : best));
}

function ratioDistance(ratio: string, value: number) {
    const [width, height] = ratio.split(":").map(Number);
    return Math.abs(width / height - value);
}

function closestTier(pixels: number) {
    return RESOLUTION_TIERS.reduce((best, item) => (Math.abs(Number(item.value) - pixels) <= Math.abs(Number(best.value) - pixels) ? item : best)).value;
}
