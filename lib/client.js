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
		// Consumes the slot registry only. The balance itself is served by the
		// host half, so the API key never enters the browser.
		const inject = ["slots"];

		/** Host route registered by lib/index.js. */
		const ENDPOINT = "/api/dsh-api-balance";

		/** Automatic refresh interval while the page stays open. */
		const REFRESH_MS = 300000;

		/**
		 * Render a currency amount using its symbol.
		 * @param currency - ISO currency code from the balance endpoint.
		 * @returns The symbol, or a code prefix for unknown currencies.
		 */
		function symbolOf(currency) {
			if (currency === "CNY") return "\u00a5";
			if (currency === "USD") return "$";
			return currency ? currency + " " : "";
		}

		/**
		 * Fetch the balance once. The custom header keeps cross-site readers out.
		 * @param force - Bypass the host-side cache.
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
		 * Sidebar footer row showing the account balance.
		 * @param props - Slot render context; `wide` reports an expanded sidebar.
		 */
		function BalanceRow(props) {
			const wide = props.wide !== false;
			const [state, setState] = React.useState({ status: "loading", data: null, error: null });

			const refresh = React.useCallback(async (force) => {
				const payload = await load(force);
				setState((prev) => payload.ok
					? { status: "ready", data: payload, error: null }
					// Keep the last good amount so a transient failure does not
					// blank the balance the user was reading.
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
			const unit = data !== null ? symbolOf(data.currency) : "";
			const title = state.error !== null
				? "Balance query failed: " + state.error
				: data !== null
					? "Total " + unit + data.totalBalance
						+ "\nGranted " + unit + data.grantedBalance
						+ "\nTopped up " + unit + data.toppedUpBalance
					: "Querying balance";

			const text = data !== null
				? "Balance " + unit + data.totalBalance
				: state.status === "loading" ? "Balance ..." : "Balance --";

			return React.createElement(
				"button",
				{
					type: "button",
					title: title + "\n(click to refresh)",
					onClick: () => { void refresh(true); },
					style: {
						display: "block",
						width: "100%",
						boxSizing: "border-box",
						padding: wide ? "6px 10px" : "6px 0",
						margin: 0,
						border: "none",
						borderRadius: "6px",
						background: "transparent",
						color: state.status === "error" ? "#e06c75" : "inherit",
						font: "inherit",
						fontSize: wide ? "12px" : "11px",
						textAlign: wide ? "left" : "center",
						cursor: "pointer",
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
						opacity: 0.85,
					},
				},
				wide ? text : text.replace(/^Balance\s*/, ""),
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
