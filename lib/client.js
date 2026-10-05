window.__ModuleLoader__.load({
	// The module id MUST equal the package name. The host registers a row for
	// the resolved package name, and the browser module system rejects a
	// factory registered under any other id as a duplicate/unowned entry,
	// which fails the whole boot entry.
	id: "dsh-api-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");

		// ── Plugin body ──────────────────────────────────────────────────────
		// Consumes the slot registry only. The balance, the cost totals, and the
		// price table are computed host-side, so the API key never enters the
		// browser.
		const inject = ["slots"];

		/** Host route registered by lib/index.js. */
		const ENDPOINT = "/api/dsh-api-balance";

		/** Refresh interval while the page stays open. */
		const REFRESH_MS = 60000;

		/** Decimals used for a cost too small to show whole fen. */
		const COST_DECIMALS = 4;

		// ── Localization ─────────────────────────────────────────────────────
		// Copy lives here rather than in the shared locale dictionaries, so the
		// plugin stays installable without a language pack. The active language
		// follows the document, which the locale service keeps in sync.

		const MESSAGES = {
			en: {
				balance: "Balance",
				cost: "Cost",
				loading: "...",
				unavailable: "Balance unavailable",
				thisRun: "This run",
				overCalls: "over {n} call(s)",
				tokensIn: "Tokens in {in} (cached {cached}), out {out}",
				noCalls: "No model calls this run yet",
				clickRefresh: "Click to refresh",
				pricesTitle: "Prices, per 1M tokens",
				priceCacheHit: "cache hit",
				priceCacheMiss: "cache miss",
				priceOutput: "output",
				tierOffPeak: "off-peak",
				tierPeak: "peak",
				tierNow: "now: {tier}",
				peakNote: "Peak is Beijing time, Mon-Fri 09:00-12:00 and 14:00-18:00; other times and weekends cost half.",
			},
			zh: {
				balance: "余额",
				cost: "费用",
				loading: "...",
				unavailable: "余额不可用",
				thisRun: "本次运行",
				overCalls: "共 {n} 次调用",
				tokensIn: "输入 {in}（缓存 {cached}），输出 {out}",
				noCalls: "本次运行还没有模型调用",
				clickRefresh: "点击刷新",
				pricesTitle: "价格（每百万 tokens）",
				priceCacheHit: "缓存命中",
				priceCacheMiss: "缓存未命中",
				priceOutput: "输出",
				tierOffPeak: "空闲时段",
				tierPeak: "高峰时段",
				tierNow: "当前：{tier}",
				peakNote: "高峰为北京时间周一至周五 9:00-12:00、14:00-18:00；其余时段与周末价格减半。",
			},
			ru: {
				balance: "Баланс",
				cost: "Расход",
				loading: "...",
				unavailable: "Баланс недоступен",
				thisRun: "Этот запуск",
				overCalls: "за {n} вызов(ов)",
				tokensIn: "Вход {in} (кеш {cached}), выход {out}",
				noCalls: "В этом запуске ещё не было вызовов модели",
				clickRefresh: "Нажмите, чтобы обновить",
				pricesTitle: "Цены за 1 млн токенов",
				priceCacheHit: "попадание в кеш",
				priceCacheMiss: "промах кеша",
				priceOutput: "вывод",
				tierOffPeak: "непиковый",
				tierPeak: "пиковый",
				tierNow: "сейчас: {tier}",
				peakNote: "Пик — по пекинскому времени, пн-пт 09:00-12:00 и 14:00-18:00; в остальное время и по выходным вдвое дешевле.",
			},
			de: {
				balance: "Guthaben",
				cost: "Kosten",
				loading: "...",
				unavailable: "Guthaben nicht verfügbar",
				thisRun: "Dieser Lauf",
				overCalls: "über {n} Aufruf(e)",
				tokensIn: "Eingabe {in} (Cache {cached}), Ausgabe {out}",
				noCalls: "In diesem Lauf noch keine Modellaufrufe",
				clickRefresh: "Zum Aktualisieren klicken",
				pricesTitle: "Preise pro 1 Mio. Token",
				priceCacheHit: "Cache-Treffer",
				priceCacheMiss: "Cache-Fehlschlag",
				priceOutput: "Ausgabe",
				tierOffPeak: "Nebenzeit",
				tierPeak: "Hauptzeit",
				tierNow: "jetzt: {tier}",
				peakNote: "Hauptzeit ist Pekinger Zeit, Mo-Fr 09:00-12:00 und 14:00-18:00; sonst und am Wochenende halber Preis.",
			},
		};

		/** Languages this plugin ships copy for. */
		const SUPPORTED = ["en", "zh", "ru", "de"];

		/**
		 * Pick a language from a BCP 47 tag.
		 * @param tag - A tag such as `de-AT` or `ru`.
		 * @returns A supported language id, defaulting to English.
		 */
		function pickLanguage(tag) {
			const lower = typeof tag === "string" ? tag.toLowerCase() : "";
			if (lower.length === 0) return "en";
			const primary = lower.split("-")[0];
			return SUPPORTED.indexOf(primary) >= 0 ? primary : "en";
		}

		/**
		 * Read the language the GUI is currently showing.
		 *
		 * The document language is authoritative once the locale service sets it;
		 * otherwise the browser preference decides.
		 *
		 * @returns A supported language id.
		 */
		function activeLanguage() {
			if (typeof document !== "undefined" && document.documentElement
				&& typeof document.documentElement.lang === "string" && document.documentElement.lang.length > 0) {
				return pickLanguage(document.documentElement.lang);
			}
			if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
				return pickLanguage(navigator.language);
			}
			return "en";
		}

		/**
		 * Build a translate function for one language.
		 * @param language - A supported language id.
		 * @returns A `t(key, vars)` lookup with English fallback.
		 */
		function makeT(language) {
			const dict = MESSAGES[language] ?? MESSAGES.en;
			return (key, vars) => {
				let text = dict[key] ?? MESSAGES.en[key] ?? key;
				if (vars) {
					for (const name of Object.keys(vars)) {
						text = text.split("{" + name + "}").join(String(vars[name]));
					}
				}
				return text;
			};
		}

		/** Currency symbols, keyed by ISO code. */
		const SYMBOLS = { CNY: "\u00a5", USD: "$", EUR: "\u20ac", RUB: "\u20bd" };

		/**
		 * Render a currency symbol.
		 * @param currency - ISO currency code.
		 * @returns The symbol, or a code prefix for unknown currencies.
		 */
		function symbolOf(currency) {
			if (typeof currency !== "string" || currency.length === 0) return "";
			return SYMBOLS[currency] ?? currency + " ";
		}

		/**
		 * Format a cost for display.
		 *
		 * Small amounts keep four decimals because one cheap call can cost well
		 * under a fen; once the total reaches a fen, two decimals read better.
		 *
		 * @param value - Cost amount.
		 * @returns The formatted amount, or null when unusable.
		 */
		function formatCost(value) {
			if (typeof value !== "number" || !isFinite(value)) return null;
			if (value <= 0) return "0.00";
			return value < 0.01 ? value.toFixed(COST_DECIMALS) : value.toFixed(2);
		}

		/**
		 * Format a per-million-token price, keeping significant detail.
		 * @param value - Price per 1M tokens.
		 * @returns The formatted price, or null when unusable.
		 */
		function formatPrice(value) {
			if (typeof value !== "number" || !isFinite(value)) return null;
			if (value === 0) return "0";
			return String(value >= 1 ? Number(value.toFixed(2)) : Number(value.toFixed(4)));
		}

		/**
		 * Build the price lines for the tooltip.
		 *
		 * Each model shows its off-peak and peak rates in the order cache hit,
		 * cache miss, output, and the tier in force right now is marked so the
		 * numbers can be read against the cost above.
		 *
		 * @param prices - Price table from the host, or null.
		 * @param t - Translate function.
		 * @returns Lines ready for the tooltip.
		 */
		function priceLines(prices, t) {
			if (prices === null || typeof prices !== "object") return [];
			const ids = Object.keys(prices).filter((id) => !id.startsWith("__"));
			if (ids.length === 0) return [];

			const tierName = (tier) => t(tier === "peak" ? "tierPeak" : "tierOffPeak");
			const current = prices.__tier === "peak" || prices.__tier === "offPeak" ? tierName(prices.__tier) : null;
			const lines = [t("pricesTitle") + (current === null ? "" : "   \u00b7   " + t("tierNow", { tier: current }))];

			for (const id of ids) {
				const entry = prices[id];
				if (entry === null || typeof entry !== "object") continue;
				const sym = symbolOf(entry.currency);
				const rate = (tier) => sym + formatPrice(tier.cacheHit) + " / " + sym + formatPrice(tier.cacheMiss) + " / " + sym + formatPrice(tier.output);
				lines.push("  " + id);
				lines.push("    " + t("tierOffPeak") + ": " + rate(entry.offPeak ?? entry));
				lines.push("    " + t("tierPeak") + ": " + rate(entry.peak ?? entry));
			}
			lines.push("  (" + t("priceCacheHit") + " / " + t("priceCacheMiss") + " / " + t("priceOutput") + ")");
			lines.push(t("peakNote"));
			return lines;
		}

		/**
		 * Fetch balance, usage, and prices once.
		 * @param force - Bypass the host-side balance cache.
		 * @returns The host payload, or a local failure payload.
		 */
		async function load(force) {
			try {
				const response = await fetch(ENDPOINT + (force ? "?force=1" : ""), {
					headers: { "x-dsh-balance": "1" },
					cache: "no-store",
				});
				if (!response.ok) return { ok: false, error: "HTTP " + response.status };
				return await response.json();
			} catch (error) {
				return { ok: false, error: "host unreachable" };
			}
		}

		/**
		 * Sidebar footer row showing the account balance and this run's cost.
		 * @param props - Slot render context; `wide` reports an expanded sidebar.
		 */
		function BalanceRow(props) {
			const wide = props.wide !== false;
			const [state, setState] = React.useState({ status: "loading", data: null, error: null });
			const [language, setLanguage] = React.useState(activeLanguage);

			const refresh = React.useCallback(async (force) => {
				const payload = await load(force);
				setState((prev) => payload.ok
					? { status: "ready", data: payload, error: null }
					// Keep the last good reading so a transient failure does not
					// blank the numbers the user was watching.
					: { status: "error", data: prev.data, error: payload.error });
			}, []);

			React.useEffect(() => {
				void refresh(false);
				const timer = setInterval(() => {
					if (!document.hidden) void refresh(false);
				}, REFRESH_MS);
				const onVisible = () => { if (document.visibilityState === "visible") void refresh(false); };
				// The locale service writes <html lang> on a language switch, so
				// watching that attribute re-renders the copy without polling.
				const observer = typeof MutationObserver === "function" && document.documentElement
					? new MutationObserver(() => setLanguage(activeLanguage()))
					: null;
				if (observer !== null) observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
				document.addEventListener("visibilitychange", onVisible);
				return () => {
					clearInterval(timer);
					if (observer !== null) observer.disconnect();
					document.removeEventListener("visibilitychange", onVisible);
				};
			}, [refresh]);

			const t = makeT(language);
			const data = state.data;
			const usage = data !== null && data.usage !== null && typeof data.usage === "object" ? data.usage : null;
			const total = usage !== null && usage.total !== null && typeof usage.total === "object" ? usage.total : null;
			const sym = data !== null ? symbolOf(data.currency) : "";
			const usageSym = data !== null ? symbolOf(data.usageCurrency) : "";

			const hasBalance = data !== null && typeof data.totalBalance === "string" && data.totalBalance !== "";
			const costText = total !== null ? formatCost(total.cost) : null;
			const hasCost = costText !== null && total !== null && total.calls > 0;
			// The host reports why a read failed; surface it so a failure is
			// diagnosable from the row itself instead of hiding behind a dash.
			const failureReason = state.error !== null
				? state.error
				: (data !== null && data.ok === false && typeof data.error === "string" ? data.error : null);

			// Both figures are always shown side by side and labelled, so the row
			// has a stable width and neither number disappears: a known value shows
			// its amount, an unknown one keeps its placeholder.
			const balanceText = hasBalance ? sym + data.totalBalance : (state.status === "loading" ? t("loading") : "--");
			const costValueText = hasCost ? usageSym + costText : (state.status === "loading" ? t("loading") : "--");

			let text;
			if (data === null && failureReason !== null) {
				text = t("unavailable");
			} else {
				text = t("balance") + " " + balanceText + "   \u00b7   " + t("cost") + " " + costValueText;
			}
			// The collapsed rail has no room for the labels, so it keeps only the
			// two amounts.
			const narrowText = hasBalance || hasCost
				? text.split(t("balance") + " ").join("").split(t("cost") + " ").join("").split("\u00b7").join("/").trim()
				: text;

			const lines = [];
			if (failureReason !== null) lines.push(t("balance") + ": " + failureReason);
			if (data !== null && hasBalance) {
				lines.push(t("balance") + " " + sym + data.totalBalance
					+ "  (" + sym + data.grantedBalance + " + " + sym + data.toppedUpBalance + ")");
			}
			if (hasCost) {
				const inTokens = total.input + total.cacheRead + total.cacheWrite;
				lines.push(t("thisRun") + ": " + usageSym + costText + " " + t("overCalls", { n: total.calls }));
				lines.push(t("tokensIn", {
					in: inTokens.toLocaleString(),
					cached: total.cacheRead.toLocaleString(),
					out: total.output.toLocaleString(),
				}));
			} else if (data !== null) {
				lines.push(t("noCalls"));
			}
			const price = priceLines(data !== null ? data.prices : null, t);
			if (price.length > 0) {
				lines.push("");
				for (const line of price) lines.push(line);
			}
			lines.push("");
			lines.push(t("clickRefresh"));

			return React.createElement(
				"button",
				{
					type: "button",
					title: lines.join("\n"),
					onClick: () => { void refresh(true); },
					style: {
						display: "block",
						width: "100%",
						boxSizing: "border-box",
						padding: wide ? "6px 10px" : "4px 0",
						margin: 0,
						border: "none",
						borderRadius: "6px",
						background: "transparent",
						color: failureReason !== null && !hasBalance ? "#e06c75" : "inherit",
						font: "inherit",
						fontSize: wide ? "12px" : "10px",
						textAlign: "center",
						cursor: "pointer",
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
						opacity: 0.85,
					},
				},
				wide ? text : narrowText,
			);
		}

		/**
		 * Register the balance row in the sidebar footer.
		 *
		 * The GUI language is read from the document, so the locale service is
		 * not a dependency; requiring it would block activation on a host that
		 * does not provide it.
		 *
		 * @param ctx - Client plugin context.
		 */
		function apply(ctx) {
			const slots = ctx.slots;
			if (slots === undefined) return;
			// `sidebar.footer.action` is declared by ui-sidebar. When that plugin
			// is absent the injection simply never fires instead of throwing.
			slots.inject("sidebar.footer.action", () => slots.register(
				{ name: "sidebar.footer.action", id: "dsh-api-balance", order: 10 },
				BalanceRow,
			));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
