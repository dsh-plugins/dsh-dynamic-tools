window.__ModuleLoader__.load({
	id: "@dsh-plugin/dsh-dynamic-tools",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _dsh_plugin_dsh_loader_client = require("@dsh-plugin/dsh-loader/client");
		Object.freeze([
			"gpt*",
			"o1*",
			"o3*",
			"o4*",
			"chatgpt*",
			"codex*"
		]);
		/** Everything a pattern-match treats literally, apart from `*`. */
		const REGEX_SPECIALS = /[.+?^${}()|[\]\\]/g;
		/**
		* Match one identifier against a `*` wildcard pattern, ignoring case.
		*
		* The `*` is the only metacharacter; every other character is literal, so a
		* model id containing `.` or `-` matches only itself. The pattern is anchored,
		* so `gpt*` does not match `x-gpt-6`.
		*
		* @param pattern - glob-like pattern from configuration.
		* @param value - model id or provider route to test.
		* @returns whether the whole value matches the whole pattern.
		*/
		function patternMatches(pattern, value) {
			const source = pattern.replace(REGEX_SPECIALS, "\\$&").split("*").join(".*");
			return new RegExp(`^${source}$`, "i").test(value);
		}
		function matchesAny(patterns, value) {
			return patterns.length === 0 || patterns.some((pattern) => patternMatches(pattern, value));
		}
		/** 模型卡片与执行器共用优先级，避免界面状态和实际请求策略不一致。 */
		function responsesEnabled(selection, settings) {
			return (settings.overrides?.findLast((item) => item.provider === selection.provider && item.model === selection.model))?.enabled ?? settings.routes.some((route) => route.provider === selection.provider && matchesAny(route.models, selection.model));
		}
		/** 替换单个模型的选择，不展开通配规则，也不改动其它 provider 的同名模型。 */
		function setResponsesOverride(settings, selection) {
			return {
				...settings,
				overrides: [...(settings.overrides ?? []).filter((item) => item.provider !== selection.provider || item.model !== selection.model), selection]
			};
		}
		//#endregion
		//#region src/client/model-cards.ts
		const modelLabels = ["模型 ID ", "Model ID "];
		const capacityLabels = [
			"上下文窗口 ",
			"Context window ",
			"最大输出 token ",
			"Max output tokens "
		];
		const cancelLabels = /* @__PURE__ */ new Set([
			"取消",
			"Cancel",
			"Cancelar",
			"Annuler",
			"Abbrechen",
			"Отмена"
		]);
		const saveLabels = /* @__PURE__ */ new Set([
			"保存",
			"Apply",
			"Save",
			"Aplicar",
			"Appliquer",
			"Anwenden",
			"Применить",
			"创建提供商",
			"Create provider",
			"Crear proveedor",
			"Créer un fournisseur",
			"Anbieter erstellen",
			"Создать поставщика",
			"Criar provedor"
		]);
		function editorOf(input) {
			for (let editor = input.parentElement; editor && editor !== input.ownerDocument.body; editor = editor.parentElement) {
				const buttons = editor.lastElementChild?.children;
				if (buttons?.length !== 2) continue;
				const [cancel, save] = Array.from(buttons);
				if (cancel?.tagName === "BUTTON" && save?.tagName === "BUTTON" && cancelLabels.has(cancel.textContent?.trim() ?? "")) {
					if (saveLabels.has(save.textContent?.trim() ?? "") || cancel.disabled) {
						for (let section = editor.parentElement; section && section !== input.ownerDocument.body; section = section.parentElement) if (section.querySelector(":scope > h2")) return {
							editor,
							section,
							save,
							cancel
						};
					}
				}
			}
		}
		/** 宿主只在提交成功后展示此通知；仅关闭或重建 DOM 不构成成功证据。 */
		function savedProvider(section, provider, previous) {
			for (const notice of section.querySelectorAll(":scope > p[role=\"status\"][aria-live=\"polite\"]")) {
				if (previous.has(notice)) continue;
				const text = notice.textContent?.trim() ?? "";
				const identity = (/^(?:已保存 |Saved |Guardado |Gespeichert |Сохранено |Salvo )(.+)[。.\s]$/.exec(text) ?? /^(.+) enregistré\.$/.exec(text))?.[1];
				if (identity === provider || identity?.endsWith(` (${provider})`)) return true;
			}
			return false;
		}
		function providerOf(editor, providers) {
			const route = editor.querySelector("input[aria-label=\"Provider ID\"]");
			if (route) return route.value.trim() || void 0;
			const card = editor.closest("li") ?? editor;
			const labels = new Set([...card.querySelectorAll("span")].map((span) => span.textContent?.trim()));
			const routes = providers.filter((provider) => labels.has(provider.provider));
			if (routes.length === 1) return routes[0].provider;
			if (routes.length > 1) return;
			const names = providers.filter((provider) => labels.has(provider.displayName));
			return names.length === 1 ? names[0].provider : void 0;
		}
		/** 通过可访问标签、稳定行标识和提交栏解析模型，避免读取 React 私有状态。 */
		function modelRows(document, providers) {
			const rows = [];
			for (const input of document.querySelectorAll("input[aria-label]")) {
				if (!modelLabels.some((prefix) => input.getAttribute("aria-label")?.startsWith(prefix))) continue;
				const entry = input.closest("[data-row-key]");
				const identity = editorOf(input);
				if (!entry?.dataset.rowKey || !identity) continue;
				const panel = [...entry.querySelectorAll("input[aria-label]")].find((field) => capacityLabels.some((prefix) => field.getAttribute("aria-label")?.startsWith(prefix)))?.parentElement?.parentElement ?? void 0;
				rows.push({
					...identity,
					key: entry.dataset.rowKey,
					input,
					panel,
					provider: providerOf(identity.editor, providers),
					model: input.value.trim()
				});
			}
			return rows;
		}
		//#endregion
		//#region src/client/submission.ts
		/** 提交结果同时依据编辑器生命周期和宿主成功通知，拒绝将卸载当作保存成功。 */
		function submissionOutcome(state) {
			if (!state.sectionConnected || !state.sameLocation) return "discard";
			if (state.editorConnected) return state.busy ? "wait" : "discard";
			return state.confirmed ? "save" : "wait";
		}
		//#endregion
		//#region src/client/index.ts
		const name = "@dsh-plugin/dsh-dynamic-tools";
		const inject = ["dshLoaderUi", "connection"];
		/** 勾选只修改草稿；宿主保存成功关闭编辑器后，才提交独立的路由配置。 */
		function apply(ctx) {
			ctx.effect(() => {
				const lifetime = new AbortController();
				const client = (0, _dsh_plugin_dsh_loader_client.createConfigClient)((url, init) => fetch(url, {
					...init,
					signal: lifetime.signal
				}), (url) => new EventSource(url));
				const controls = /* @__PURE__ */ new Map();
				const drafts = /* @__PURE__ */ new Map();
				let providers = [];
				let view;
				let disposed = false;
				let readError = "";
				let directoryError = "";
				let refreshing = false;
				let writeQueue = Promise.resolve();
				const notices = /* @__PURE__ */ new Set();
				const settings = (current) => current.value.responses;
				const accept = (next) => {
					if (!disposed && (!view || next.revision >= view.revision)) view = next;
				};
				const readConfig = async () => {
					try {
						accept(await client.read("dsh-dynamic-tools"));
						readError = "";
					} catch (failure) {
						readError = `读取原生工具路由失败：${String(failure)}`;
					}
					if (!disposed) sweep();
				};
				const refreshDirectory = async () => {
					if (refreshing || disposed) return;
					refreshing = true;
					try {
						const response = await ctx.connection.api.llm.providers({});
						if (!response.result.ok) throw new Error(response.result.error.message);
						providers = response.result.value.providers;
						directoryError = "";
					} catch (failure) {
						directoryError = `读取提供方失败：${String(failure)}`;
					} finally {
						refreshing = false;
						if (!disposed) sweep();
					}
				};
				const persist = (values, section) => {
					if (!values.length || disposed) return;
					const notice = document.createElement("div");
					Object.assign(notice.style, {
						padding: "12px",
						border: "1px solid var(--dsw-alias-border-l2)",
						borderRadius: "8px",
						color: "var(--dsw-alias-label-primary)",
						display: "flex",
						flexDirection: "column",
						gap: "8px",
						overflowWrap: "anywhere"
					});
					notice.setAttribute("role", "status");
					notices.add(notice);
					section.prepend(notice);
					const remove = () => {
						notice.remove();
						notices.delete(notice);
					};
					const run = () => {
						notice.textContent = "正在保存原生工具路由…";
						writeQueue = writeQueue.then(async () => {
							if (disposed) return;
							try {
								const current = await client.read("dsh-dynamic-tools");
								if (disposed) return;
								const responses = values.reduce((value, choice) => setResponsesOverride(value, choice), settings(current));
								accept(await client.update("dsh-dynamic-tools", { responses }, current.revision, lifetime.signal));
								remove();
							} catch (failure) {
								if (disposed) return;
								notice.setAttribute("role", "alert");
								notice.textContent = `提供方已保存，原生工具路由保存失败：${String(failure)}`;
								const retry = document.createElement("button");
								retry.type = "button";
								retry.textContent = "重试保存原生工具路由";
								retry.addEventListener("click", run);
								const dismiss = document.createElement("button");
								dismiss.type = "button";
								dismiss.textContent = "放弃本次路由修改";
								dismiss.addEventListener("click", remove);
								notice.append(retry, dismiss);
							}
							if (!disposed) sweep();
						});
					};
					run();
				};
				const mount = (row, draft) => {
					const block = document.createElement("div");
					block.dataset.dshNativeTools = "";
					Object.assign(block.style, {
						borderTop: "1px solid var(--dsw-alias-border-l2)",
						gridColumn: "1 / -1",
						marginTop: "8px",
						padding: "8px 4px 2px",
						display: "flex",
						flexDirection: "column",
						gap: "4px"
					});
					const label = document.createElement("label");
					Object.assign(label.style, {
						display: "flex",
						alignItems: "center",
						gap: "8px",
						minHeight: "36px"
					});
					const checkbox = document.createElement("input");
					checkbox.type = "checkbox";
					Object.assign(checkbox.style, {
						height: "16px",
						width: "16px",
						margin: "0"
					});
					const title = document.createElement("span");
					title.textContent = "启用原生工具路由";
					label.append(checkbox, title);
					const hint = document.createElement("span");
					Object.assign(hint.style, {
						color: "var(--dsw-alias-label-tertiary)",
						fontSize: "12px",
						lineHeight: "18px"
					});
					block.append(label, hint);
					row.panel.append(block);
					checkbox.addEventListener("change", () => {
						draft.choices.set(row.key, checkbox.checked);
						sweep();
					});
					return {
						block,
						checkbox,
						hint
					};
				};
				const sweep = () => {
					if (disposed) return;
					const rows = modelRows(document, providers);
					for (const [editor, draft] of drafts) {
						const submission = draft.submission;
						if (submission) {
							const replaced = !editor.isConnected && rows.some((row) => row.section === draft.section && !submission.editors.has(row.editor));
							const outcome = submissionOutcome({
								editorConnected: editor.isConnected,
								busy: draft.cancel.disabled,
								sectionConnected: draft.section.isConnected && !replaced,
								sameLocation: submission.location === location.href,
								confirmed: submission.values.length > 0 && savedProvider(draft.section, submission.values[0].provider, submission.previous)
							});
							if (outcome !== "wait") {
								draft.submission = void 0;
								if (outcome === "save") persist(submission.values, draft.section);
							}
						}
						if (!editor.isConnected && !draft.submission) drafts.delete(editor);
					}
					const inputs = new Set(rows.filter((row) => row.panel).map((row) => row.input));
					for (const [input, control] of controls) if (!inputs.has(input) || !control.block.isConnected) {
						control.block.remove();
						controls.delete(input);
					}
					for (const row of rows) {
						let draft = drafts.get(row.editor);
						if (!draft) {
							draft = {
								editor: row.editor,
								section: row.section,
								save: row.save,
								cancel: row.cancel,
								choices: /* @__PURE__ */ new Map()
							};
							drafts.set(row.editor, draft);
							refreshDirectory();
						}
						if (!row.panel) continue;
						let control = controls.get(row.input);
						if (!control) {
							control = mount(row, draft);
							controls.set(row.input, control);
						}
						control.checkbox.checked = draft.choices.get(row.key) ?? (!!view && !!row.provider && responsesEnabled({
							provider: row.provider,
							model: row.model
						}, settings(view)));
						const registered = providers.some((provider) => provider.provider === row.provider);
						const disabled = !view || !registered || !row.model || row.input.disabled;
						if (control.checkbox.disabled !== disabled) control.checkbox.disabled = disabled;
						const message = readError || directoryError || (!view ? "正在读取配置…" : !registered ? "请先保存提供方，再启用原生工具路由。" : !row.model ? "请填写有效的模型 ID。" : draft.choices.has(row.key) ? "尚未保存，将随提供方的“保存”提交。" : "随提供方保存，从下一步生效。需要支持原生工具追加的 Responses 接口。");
						if (control.hint.textContent !== message) control.hint.textContent = message;
					}
				};
				const onClick = (event) => {
					if (!(event.target instanceof Element)) return;
					const button = event.target.closest("button");
					for (const draft of drafts.values()) if (button === draft.save && !draft.save.disabled) {
						const rows = modelRows(document, providers);
						const values = rows.filter((row) => row.editor === draft.editor && row.provider && row.model && draft.choices.has(row.key)).map((row) => ({
							provider: row.provider,
							model: row.model,
							enabled: draft.choices.get(row.key)
						}));
						draft.submission = values.length ? {
							values,
							location: location.href,
							previous: new Set(draft.section.querySelectorAll(":scope > p[role=\"status\"][aria-live=\"polite\"]")),
							editors: new Set(rows.map((row) => row.editor))
						} : void 0;
					} else if (button === draft.cancel || button && !draft.editor.contains(button) && draft.editor.closest("li")?.contains(button)) {
						draft.submission = void 0;
						draft.choices.clear();
					}
				};
				const onInput = (event) => {
					if (event.target instanceof HTMLInputElement && /^(模型 ID |Model ID |Provider ID$)/.test(event.target.getAttribute("aria-label") ?? "")) sweep();
				};
				const refresh = () => {
					readConfig();
					refreshDirectory();
				};
				const stopObserving = ctx.dshLoaderUi.onDomSettled(sweep);
				const unsubscribe = client.subscribe(() => {
					readConfig();
				});
				document.addEventListener("click", onClick, true);
				document.addEventListener("input", onInput, true);
				window.addEventListener("focus", refresh);
				refresh();
				return () => {
					disposed = true;
					lifetime.abort();
					stopObserving();
					unsubscribe();
					client.dispose();
					document.removeEventListener("click", onClick, true);
					document.removeEventListener("input", onInput, true);
					window.removeEventListener("focus", refresh);
					for (const control of controls.values()) control.block.remove();
					for (const notice of notices) notice.remove();
					controls.clear();
					drafts.clear();
					notices.clear();
				};
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map