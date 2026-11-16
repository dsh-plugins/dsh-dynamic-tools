import { type DshLoaderUi } from '@dsh-plugin/dsh-loader/client';
import { type ProviderEntry } from './model-cards.ts';
export declare const name = "@dsh-plugin/dsh-dynamic-tools";
export declare const inject: string[];
/** 仅通过 loader 适配的公开目录和独立配置接口读写路由。 */
export interface ClientContext {
    readonly dshLoaderUi: Pick<DshLoaderUi, 'onDomSettled'>;
    readonly connection: {
        api: {
            llm: {
                providers(input: object): Promise<{
                    result: {
                        ok: true;
                        value: {
                            providers: ProviderEntry[];
                        };
                    } | {
                        ok: false;
                        error: {
                            message: string;
                        };
                    };
                }>;
            };
        };
    };
    effect(callback: () => (() => void)): unknown;
}
/** 勾选只修改草稿；宿主保存成功关闭编辑器后，才提交独立的路由配置。 */
export declare function apply(ctx: ClientContext): void;
