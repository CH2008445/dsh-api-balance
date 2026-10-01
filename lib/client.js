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
		// Consumes the slot registry only. The balance and the cost totals are
		// both computed host-side, so the API key never enters the browser.
		const inject = ["slots"];

		/** Host route registered by lib/index.js. */
		const ENDPOINT = "/api/dsh-api-balance";

		/** Refresh interval while the page stays open. */
		const REFRESH_MS = 60000;

		/** Decimals used for a cost that is too small to show whole fen. */
		const COST_DECIMALS = 4;

		/**
		 * Render a currency amount using its symbol.
		 * @param currency - ISO currency code.
		 * @returns The symbol, or a code prefix for unknown currencies.
		 */
		function symbolOf(currency) {
			if (currency === "CNY") return "\u00a5";
			if (currency === "USD") return "$";
			return currency ? currency + " " : "";
		}

		/**
		 * Format a cost for display.
		 *
		 * Small amounts keep four decimals because a single cheap call can cost
		 * well under one fen; once the total reaches a fen, two decimals read
		 * better.
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
		 * Fetch balance and usage once.
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
				document.addEventListener("visibilitychange", onVisible);
				return () => {
					clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisible);
				};
			}, [refresh]);

			const data = state.data;
			const usage = data !== null && data.usage !== null && typeof data.usage === "object" ? data.usage : null;
			const total = usage !== null && usage.total !== null && typeof usage.total === "object" ? usage.total : null;
			const sym = data !== null ? symbolOf(data.currency) : "";
			const usageSym = data !== null ? symbolOf(data.usageCurrency) : "";

			const hasBalance = data !== null && typeof data.totalBalance === "string" && data.totalBalance !== "";
			const costText = total !== null ? formatCost(total.cost) : null;
			const hasCost = costText !== null && total !== null && total.calls > 0;

			// Compose the one-line label. A missing balance still shows cost, and
			// a run with no model calls yet shows only the balance.
			let text;
			if (hasCost) {
				text = (hasBalance ? sym + data.totalBalance + "  \u00b7  " : "")
					+ "run " + usageSym + costText;
			} else if (hasBalance) {
				text = sym + data.totalBalance;
			} else if (state.status === "loading") {
				text = "Balance ...";
			} else {
				text = "Balance --";
			}

			const lines = [];
			if (state.error !== null) lines.push("Balance query failed: " + state.error);
			if (data !== null) {
				if (hasBalance) {
					lines.push("Balance " + sym + data.totalBalance
						+ " (granted " + sym + data.grantedBalance
						+ ", topped up " + sym + data.toppedUpBalance + ")");
				} else {
					lines.push("Balance unavailable");
				}
			}
			if (hasCost) {
				const inTokens = total.input + total.cacheRead + total.cacheWrite;
				lines.push("This run: " + usageSym + costText + " over " + total.calls
					+ (total.calls === 1 ? " call" : " calls"));
				lines.push("Tokens in " + inTokens.toLocaleString()
					+ " (cached " + total.cacheRead.toLocaleString() + ")"
					+ ", out " + total.output.toLocaleString());
				lines.push("Click to refresh");
			} else if (data !== null) {
				lines.push("No model calls this run yet");
			}

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
						color: state.status === "error" && !hasBalance ? "#e06c75" : "inherit",
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
				text,
			);
		}

		/**
		 * Register the balance row in the sidebar footer.
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
