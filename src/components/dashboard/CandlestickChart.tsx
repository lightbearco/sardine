import { useEffect, useRef } from "react";
import {
	ColorType,
	createChart,
	type CandlestickData,
	type HistogramData,
	type IChartApi,
	type ISeriesApi,
	type Time,
} from "lightweight-charts";
import { useMarketData } from "#/hooks/useMarketData";
import { useSymbolSelection } from "#/hooks/useSymbolSelection";

const TERMINAL_CHART_COLORS = {
	background: "#0d1117",
	text: "#8b949e",
	border: "#30363d",
	grid: "#1c2128",
	green: "#3fb950",
	red: "#f85149",
} as const;

function toCandleData(
	bars: ReturnType<typeof useMarketData>["bars"],
): CandlestickData<Time>[] {
	return bars.map((bar) => ({
		time: bar.tick as Time,
		open: Number(bar.open),
		high: Number(bar.high),
		low: Number(bar.low),
		close: Number(bar.close),
	}));
}

function toVolumeData(
	bars: ReturnType<typeof useMarketData>["bars"],
	colors: { green: string; red: string },
): HistogramData<Time>[] {
	return bars.map((bar) => {
		const open = Number(bar.open);
		const close = Number(bar.close);
		return {
			time: bar.tick as Time,
			value: bar.volume,
			color: close >= open ? colors.green : colors.red,
		};
	});
}

export function CandlestickChart() {
	const { symbol } = useSymbolSelection();
	const { bars, isConnected } = useMarketData(symbol);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
	const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
	const colorsRef = useRef(TERMINAL_CHART_COLORS);
	const prevSymbolRef = useRef(symbol);
	const prevLengthRef = useRef(0);

	useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		const colors = TERMINAL_CHART_COLORS;
		colorsRef.current = colors;

		const chart = createChart(containerRef.current, {
			autoSize: true,
			layout: {
				background: { type: ColorType.Solid, color: colors.background },
				textColor: colors.text,
			},
			grid: {
				vertLines: { color: colors.grid },
				horzLines: { color: colors.grid },
			},
			rightPriceScale: {
				borderColor: colors.border,
			},
			timeScale: {
				borderColor: colors.border,
				timeVisible: true,
				secondsVisible: false,
			},
			crosshair: {
				vertLine: { color: colors.border },
				horzLine: { color: colors.border },
			},
		});

		const candleSeries = chart.addCandlestickSeries({
			upColor: colors.green,
			downColor: colors.red,
			borderVisible: false,
			wickUpColor: colors.green,
			wickDownColor: colors.red,
		});

		const volumeSeries = chart.addHistogramSeries({
			priceScaleId: "",
			priceFormat: { type: "volume" },
		});
		volumeSeries.priceScale().applyOptions({
			scaleMargins: {
				top: 0.8,
				bottom: 0,
			},
		});

		chartRef.current = chart;
		candleSeriesRef.current = candleSeries;
		volumeSeriesRef.current = volumeSeries;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) {
				chart.resize(entry.contentRect.width, entry.contentRect.height);
			}
		});
		observer.observe(containerRef.current);

		return () => {
			observer.disconnect();
			chart.remove();
			chartRef.current = null;
			candleSeriesRef.current = null;
			volumeSeriesRef.current = null;
		};
	}, []);

	useEffect(() => {
		const candleSeries = candleSeriesRef.current;
		const volumeSeries = volumeSeriesRef.current;
		const chart = chartRef.current;
		if (!candleSeries || !volumeSeries || !chart) {
			return;
		}

		if (symbol !== prevSymbolRef.current) {
			candleSeries.setData(toCandleData(bars));
			volumeSeries.setData(toVolumeData(bars, colorsRef.current));
			prevSymbolRef.current = symbol;
			prevLengthRef.current = bars.length;
			chart.timeScale().fitContent();
			return;
		}

		if (bars.length === 0) {
			candleSeries.setData([]);
			volumeSeries.setData([]);
			prevLengthRef.current = 0;
			return;
		}

		if (prevLengthRef.current === 0 || bars.length < prevLengthRef.current) {
			candleSeries.setData(toCandleData(bars));
			volumeSeries.setData(toVolumeData(bars, colorsRef.current));
			chart.timeScale().fitContent();
		} else {
			const lastBar = bars[bars.length - 1];
			if (lastBar) {
				candleSeries.update({
					time: lastBar.tick as Time,
					open: Number(lastBar.open),
					high: Number(lastBar.high),
					low: Number(lastBar.low),
					close: Number(lastBar.close),
				});
				volumeSeries.update({
					time: lastBar.tick as Time,
					value: lastBar.volume,
					color:
						Number(lastBar.close) >= Number(lastBar.open)
							? colorsRef.current.green
							: colorsRef.current.red,
				});
			}
		}

		prevLengthRef.current = bars.length;
	}, [bars, symbol]);

	const last = bars[bars.length - 1];
	const open = last ? Number(last.open) : null;
	const close = last ? Number(last.close) : null;
	const changePct = open && close && open > 0 ? ((close - open) / open) * 100 : null;
	const changePositive = changePct !== null && changePct >= 0;

	return (
		<section className="flex h-full min-h-0 flex-col rounded-xl border border-(--terminal-border) bg-(--terminal-surface)">
			<div className="flex items-center gap-3 border-b border-(--terminal-border) px-3 py-2 shrink-0">
				<span className="text-xs font-semibold text-(--terminal-text)">{symbol}</span>
				{last && (
					<>
						<span className="font-mono text-sm font-bold text-(--terminal-text)">{close?.toFixed(2)}</span>
						{changePct !== null && (
							<span className="text-xs font-semibold tabular-nums" style={{ color: changePositive ? "var(--terminal-green)" : "var(--terminal-red)" }}>
								{changePositive ? "+" : ""}{changePct.toFixed(2)}%
							</span>
						)}
						<div className="flex items-center gap-3 text-[10px] text-(--terminal-text-muted) ml-1">
							<span>O <span className="text-(--terminal-text)">{Number(last.open).toFixed(2)}</span></span>
							<span>H <span style={{ color: "var(--terminal-green)" }}>{Number(last.high).toFixed(2)}</span></span>
							<span>L <span style={{ color: "var(--terminal-red)" }}>{Number(last.low).toFixed(2)}</span></span>
							<span>V <span className="text-(--terminal-text)">{last.volume.toLocaleString()}</span></span>
						</div>
					</>
				)}
				<span className="ml-auto text-[10px] text-(--terminal-text-muted)">{isConnected ? "Live" : "Waiting"}</span>
			</div>
			<div ref={containerRef} className="min-h-0 flex-1" />
		</section>
	);
}
