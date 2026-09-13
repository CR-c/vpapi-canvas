/**
 * 品牌与外部链接集中配置：换品牌、换域名只改这里。
 *
 * 本 fork 只服务 vpapi 网关，网关地址与站点链接都在此定义，业务代码不要再硬编码。
 */
export const GATEWAY_URL = "https://api.zkki.net";

/** vpapi 用户站（登录、取 Key、充值）。 */
export const VPAPI_SITE_URL = "https://vp.zkki.net";

/** 本画布站点的公开地址，用于分享、外链回跳。 */
export const CANVAS_SITE_URL = "https://ic.735678.xyz";

export const BRAND = {
    name: "vpapi 画布",
    nameEn: "vpapi Canvas",
    title: "vpapi 画布",
    titleEn: "vpapi Canvas",
    description: "用 vpapi 的图片、视频与文本模型做无限画布创作",
    descriptionEn: "Create on an infinite canvas with vpapi image, video and text models",
} as const;

export const LINKS = {
    /** 创建 / 管理 API Key。 */
    keys: `${VPAPI_SITE_URL}/keys`,
    /** 充值。 */
    wallet: `${VPAPI_SITE_URL}/wallet`,
    /** vpapi 使用文档。 */
    docs: `${VPAPI_SITE_URL}/docs`,
    /** vpapi 模型与价格。 */
    pricing: `${VPAPI_SITE_URL}/pricing`,
    /** 本 fork 仓库。 */
    repo: "https://github.com/CR-c/vpapi-canvas",
    /** fork 仓库的 raw 地址，用于版本检查（VERSION / CHANGELOG.md）。 */
    repoRaw: "https://raw.githubusercontent.com/CR-c/vpapi-canvas/main",
} as const;
